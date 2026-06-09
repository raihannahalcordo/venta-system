const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const http = require("http");
const WebSocket = require("ws");

require("dotenv").config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());

const db = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

// =========================
// TIME FORMAT
// =========================
function philippineTime(columnName, aliasName) {
  return `TO_CHAR(${columnName} + INTERVAL '8 hours', 'Mon DD, YYYY, HH12:MI:SS AM') AS ${aliasName}`;
}

// =========================
// WEBSOCKET BROADCAST
// =========================
function broadcast(data) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

app.post("/api/coin-inventory/reset", async (req, res) => {
    try {
        const { machineId } = req.body;

        const result = await db.query(`
            UPDATE coin_inventory
            SET one_peso = 0,
                five_peso = 0,
                ten_peso = 0,
                twenty_peso = 0,
                updated_at = NOW()
            WHERE id = 1
            RETURNING *
        `);

        // optional: broadcast update to frontend instantly
        broadcast({
            type: "coinInventory",
            payload: result.rows[0]
        });

        res.json({ success: true, data: result.rows[0] });

    } catch (err) {
        console.error("RESET COIN ERROR:", err);  
        res.status(500).json({ 
            success: false,
            error: err.message 
        });
    }
});

// =========================
// QUERIES
// =========================
async function getProductInventory() {
  const result = await db.query(`
    SELECT 
      p.product_id,
      p.product_name,
      p.price,
      i.inventory_id,
      i.stock_count,
      i.max_capacity,
      ${philippineTime("i.updated_at", "updated_at")}
    FROM products p
    LEFT JOIN inventory i ON p.product_id = i.product_id
    ORDER BY p.product_id
  `);

  return result.rows;
}

async function getTransactions(page = 1, limit = 13) {
  const offset = (page - 1) * limit;

  const result = await db.query(
    `
    SELECT 
      t.transaction_id,
      t.product_id,
      p.product_name,
      t.quantity,
      t.total_amount,
      t.coin_inserted,
      t.change_given,
      t.status,
      ${philippineTime("t.created_at", "created_at")}
    FROM transactions t
    LEFT JOIN products p ON t.product_id = p.product_id
    ORDER BY t.created_at DESC
    LIMIT $1 OFFSET $2
    `,
    [limit, offset]
  );

  return result.rows;
}

async function getCoinInventory() {
  const result = await db.query(`
    SELECT
      id,
      one_peso,
      five_peso,
      ten_peso,
      twenty_peso,
      ${philippineTime("updated_at", "updated_at")}
    FROM coin_inventory
    WHERE id = 1
  `);

  return result.rows[0];
}

async function getMachineLogs(limit = 13) {
  const result = await db.query(`
    SELECT 
      log_id,
      log_type,
      message,
      ${philippineTime("created_at", "created_at")}
    FROM machine_logs
    ORDER BY created_at DESC
    LIMIT $1
  `, [limit]);

  return result.rows;
}

async function getSummary() {
  const revenueResult = await db.query(`
    SELECT 
      COALESCE(SUM(total_amount), 0) AS total_revenue,
      COUNT(*) AS total_transactions
    FROM transactions
    WHERE LOWER(TRIM(status)) NOT IN ('failed', 'cancelled', 'canceled')
  `);

  const inventoryResult = await db.query(`
    SELECT 
      COALESCE(SUM(stock_count), 0) AS products_remaining,
      COUNT(*) FILTER (WHERE stock_count > 0 AND stock_count <= 2) AS low_stock_items,
      COUNT(*) AS product_types,
      TO_CHAR(MAX(updated_at) AT TIME ZONE 'Asia/Manila', 'Mon DD, YYYY, HH12:MI:SS AM') AS last_inventory_update
    FROM inventory
  `);

  const coinResult = await db.query(`
    SELECT 
      TO_CHAR(updated_at AT TIME ZONE 'Asia/Manila', 'Mon DD, YYYY, HH12:MI:SS AM') AS updated_at
    FROM coin_inventory
    WHERE id = 1
  `);

  const transactionUpdateResult = await db.query(`
    SELECT 
      TO_CHAR(MAX(created_at) AT TIME ZONE 'Asia/Manila', 'Mon DD, YYYY, HH12:MI:SS AM') AS last_transaction_update
    FROM transactions
  `);

  return {
    totalRevenue: Number(revenueResult.rows[0].total_revenue || 0),
    totalTransactions: Number(revenueResult.rows[0].total_transactions || 0),
    productsRemaining: Number(inventoryResult.rows[0].products_remaining || 0),
    lowStockItems: Number(inventoryResult.rows[0].low_stock_items || 0),
    productTypes: Number(inventoryResult.rows[0].product_types || 0),
    machineStatus: "Online",
    lastUpdated:
      transactionUpdateResult.rows[0].last_transaction_update ||
      inventoryResult.rows[0].last_inventory_update ||
      coinResult.rows[0]?.updated_at ||
      null,
  };
}

// =========================
// WEBSOCKET CONNECTION
// =========================
wss.on("connection", async (ws) => {
  console.log("Client connected");

  try {
    ws.send(JSON.stringify({ type: "summary", payload: await getSummary() }));
    ws.send(JSON.stringify({ type: "productInventory", payload: await getProductInventory() }));
    ws.send(JSON.stringify({ type: "coinInventory", payload: await getCoinInventory() }));

    // ⚠️ transactions loaded ONLY ON DEMAND (API)
    ws.send(JSON.stringify({ type: "transactions", payload: null }));

    ws.send(JSON.stringify({ type: "machineLogs", payload: await getMachineLogs() }));
  } catch (err) {
    console.error("WS init error:", err);
  }

  ws.on("close", () => console.log("Client disconnected"));
});

// =========================
// ROUTES
// =========================
app.get("/", (req, res) => {
  res.send("VentaMachine backend is running");
});

app.get("/api/summary", async (req, res) => {
  res.json(await getSummary());
});

app.get("/api/products", async (req, res) => {
  res.json(await getProductInventory());
});

app.get("/api/coin-inventory", async (req, res) => {
  res.json(await getCoinInventory());
});

app.get("/api/transactions", async (req, res) => {
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 13;

  res.json(await getTransactions(page, limit));
});

// =========================
// TRANSACTION (REALTIME EVENT ONLY)
// =========================
app.post("/api/transaction", async (req, res) => {
  const client = await db.connect();

  try {
    const {
      product_id,
      quantity,
      total_amount,
      coin_inserted,
      change_given,
      status,
    } = req.body;

    await client.query("BEGIN");

    const transactionResult = await client.query(`
      INSERT INTO transactions
      (product_id, quantity, total_amount, coin_inserted, change_given, status)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [
      product_id,
      quantity,
      total_amount,
      coin_inserted,
      change_given,
      status || "Success",
    ]);

    await client.query(`
      UPDATE inventory
      SET stock_count = stock_count - $1,
          updated_at = CURRENT_TIMESTAMP
      WHERE product_id = $2
    `, [quantity, product_id]);

    const logResult = await client.query(`
      INSERT INTO machine_logs (log_type, message)
      VALUES ($1, $2)
      RETURNING *
    `, [
      "Transaction",
      `Product ID ${product_id} sold. Qty: ${quantity}. ₱${total_amount}`
    ]);

    await client.query("COMMIT");

    // ⚡ ONLY LIGHTWEIGHT UPDATES
    broadcast({
      type: "summary",
      payload: await getSummary()
    });

    broadcast({
      type: "productInventory",
      payload: await getProductInventory()
    });

    broadcast({
      type: "newLog",
      payload: logResult.rows[0]
    });

    res.json({
      success: true,
      data: transactionResult.rows[0],
    });

  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ success: false });
  } finally {
    client.release();
  }
});

// =========================
// COIN INSERT (FAST EVENT)
// =========================
app.post("/api/coin-insert", async (req, res) => {
  try {
    const { amount } = req.body;

    if (amount == 1) {
      await db.query(`UPDATE coin_inventory SET one_peso = one_peso + 1 WHERE id = 1`);
    } else if (amount == 5) {
      await db.query(`UPDATE coin_inventory SET five_peso = five_peso + 1 WHERE id = 1`);
    } else if (amount == 10) {
      await db.query(`UPDATE coin_inventory SET ten_peso = ten_peso + 1 WHERE id = 1`);
    } else if (amount == 20) {
      await db.query(`UPDATE coin_inventory SET twenty_peso = twenty_peso + 1 WHERE id = 1`);
    }

    const logResult = await db.query(`
      INSERT INTO machine_logs (log_type, message)
      VALUES ($1, $2)
      RETURNING *
    `, [
      "Coin Insert",
      `₱${amount} inserted`
    ]);

    // ⚡ FAST BROADCAST ONLY
    broadcast({
      type: "coinInventory",
      payload: await getCoinInventory()
    });

    broadcast({
      type: "newLog",
      payload: logResult.rows[0]
    });

    res.json({ success: true });

  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// =========================
// RESTOCK
// =========================
app.post("/api/product-inventory/:productId/restock", async (req, res) => {
  try {
    const { productId } = req.params;

    const result = await db.query(`
      UPDATE inventory
      SET stock_count = max_capacity,
          updated_at = CURRENT_TIMESTAMP
      WHERE product_id = $1
      RETURNING *
    `, [productId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    const logResult = await db.query(`
      INSERT INTO machine_logs (log_type, message)
      VALUES ($1, $2)
      RETURNING *
    `, [
      "Restock",
      `Product ID ${productId} restocked to max capacity`
    ]);

    broadcast({
      type: "productInventory",
      payload: await getProductInventory()
    });

    broadcast({
      type: "summary",
      payload: await getSummary()
    });

    broadcast({
      type: "newLog",
      payload: logResult.rows[0]
    });

    res.json({ success: true, data: result.rows[0] });

  } catch (err) {
    console.error("RESTOCK ERROR:", err);
    res.status(500).json({ success: false });
  }
});

app.get("/api/machine-logs", async (req, res) => {
  const limit = Number(req.query.limit) || 13;

  res.json(await getMachineLogs(limit));
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});