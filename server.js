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
    const client = await db.connect();

    try {
        await client.query("BEGIN");

        await client.query(`
            TRUNCATE TABLE coin_inventory
            RESTART IDENTITY
        `);

        const result = await client.query(`
            INSERT INTO coin_inventory (
                one_peso,
                five_peso,
                ten_peso,
                twenty_peso,
                updated_at
            )
            VALUES (0, 0, 0, 0, NOW())
            RETURNING *
        `);

        await client.query("COMMIT");

        broadcast({
            type: "coinInventory",
            payload: result.rows[0]
        });

        res.json({
            success: true,
            data: result.rows[0]
        });

    } catch (err) {

        await client.query("ROLLBACK");

        console.error("RESET COIN ERROR:", err);

        res.status(500).json({
            success: false,
            error: err.message
        });

    } finally {
        client.release();
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
      p.is_active,
      i.inventory_id,
      i.stock_count,
      i.max_capacity,
      i.updated_at
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
      t.created_at
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
      updated_at
    FROM coin_inventory
    ORDER BY updated_at DESC
    LIMIT 1
  `);

  return result.rows[0];
}

async function getMachineLogs(limit = 13) {
  const result = await db.query(`
    SELECT 
      log_id,
      log_type,
      message,
      created_at
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
      MAX(updated_at) AS last_inventory_update
    FROM inventory
  `);

  const coinResult = await db.query(`
    SELECT 
      updated_at
    FROM coin_inventory
    WHERE id = 1
  `);

  const transactionUpdateResult = await db.query(`
    SELECT 
      t.created_at
    FROM transactions t
    ORDER BY t.created_at DESC
    LIMIT 1
  `);

  const lastTransaction =
  transactionUpdateResult.rows[0]?.created_at || null;

const lastInventory =
  inventoryResult.rows[0]?.last_inventory_update || null;

const lastCoin =
  coinResult.rows[0]?.updated_at || null;

  return {
    totalRevenue: Number(revenueResult.rows[0].total_revenue || 0),
    totalTransactions: Number(revenueResult.rows[0].total_transactions || 0),
    productsRemaining: Number(inventoryResult.rows[0].products_remaining || 0),
    lowStockItems: Number(inventoryResult.rows[0].low_stock_items || 0),
    productTypes: Number(inventoryResult.rows[0].product_types || 0),
    machineStatus: "Online",
    lastUpdated: lastTransaction || lastInventory || lastCoin || null,
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
    ws.send(JSON.stringify({ type: "transactions", payload: await getTransactions() }));

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

app.delete("/api/products/:id", async (req, res) => {
    const client = await db.connect();

    try {
        const productId = req.params.id;

        await client.query(`
            UPDATE products
            SET is_active = FALSE
            WHERE product_id = $1
        `, [productId]);

        await client.query(`
            UPDATE inventory
            SET stock_count = 0,
                updated_at = NOW()
            WHERE product_id = $1
        `, [productId]);

        await client.query(`
            INSERT INTO machine_logs (log_type, message)
            VALUES ($1, $2)
        `, [
            "Delete",
            `Product ID ${productId} was removed (soft delete)`
        ]);

        broadcast({
            type: "productInventory",
            payload: await getProductInventory()
        });

        broadcast({
            type: "machineLogs",
            payload: await getMachineLogs()
        });

        broadcast({
            type: "summary",
            payload: await getSummary()
        });

        res.json({ success: true });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false });
    } finally {
        client.release();
    }
});

app.delete("/api/transactions/clear", async (req, res) => {
    const client = await db.connect();

    try {

        await client.query(`
            TRUNCATE TABLE transactions
            RESTART IDENTITY
        `);

        broadcast({
            type: "transactions",
            payload: await getTransactions()
        });

        res.json({
            success: true
        });

    } catch (err) {

        console.error(err);

        res.status(500).json({
            success: false,
            message: "Failed to clear transactions"
        });

    } finally {
        client.release();
    }
});

app.delete("/api/machine-logs/clear", async (req, res) => {
    const client = await db.connect();

    try {

        await client.query(`
            TRUNCATE TABLE machine_logs
            RESTART IDENTITY
        `);

        broadcast({
            type: "machineLogs",
            payload: await getMachineLogs()
        });

        res.json({
            success: true
        });

    } catch (err) {

        console.error("CLEAR LOGS ERROR:", err);

        res.status(500).json({
            success: false
        });

    } finally {
        client.release();
    }
});

app.post("/api/products/:id/reactivate", async (req, res) => {
    const client = await db.connect();

    try {
        const productId = req.params.id;

        await client.query(`
            UPDATE products
            SET is_active = TRUE
            WHERE product_id = $1
        `, [productId]);

        await client.query(`
            INSERT INTO machine_logs (log_type, message)
            VALUES ($1, $2)
        `, [
            "Reactivate",
            `Product ID ${productId} was reactivated`
        ]);

        broadcast({
            type: "productInventory",
            payload: await getProductInventory()
        });

        broadcast({
            type: "machineLogs",
            payload: await getMachineLogs()
        });

        broadcast({
            type: "summary",
            payload: await getSummary()
        });

        res.json({ success: true });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false });
    } finally {
        client.release();
    }
});

app.post("/api/products/:id/reactivate", async (req, res) => {
    const client = await db.connect();

    try {
        const productId = req.params.id;

        await client.query(`
            UPDATE products
            SET is_active = TRUE
            WHERE product_id = $1
        `, [productId]);

        await client.query(`
            UPDATE inventory
            SET updated_at = NOW()
            WHERE product_id = $1
        `, [productId]);

        await client.query(`
            INSERT INTO machine_logs (log_type, message)
            VALUES ($1, $2)
        `, [
            "Reactivate",
            `Product ID ${productId} was reactivated`
        ]);

        broadcast({
            type: "productInventory",
            payload: await getProductInventory()
        });

        broadcast({
            type: "machineLogs",
            payload: await getMachineLogs()
        });

        broadcast({
            type: "summary",
            payload: await getSummary()
        });

        res.json({ success: true });

    } catch (err) {
        console.error("REACTIVATE ERROR:", err);
        res.status(500).json({ success: false });
    } finally {
        client.release();
    }
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
      type: "machineLogs",
      payload: await getMachineLogs()
    });

    broadcast({
      type: "transactions",
      payload: await getTransactions()
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
      type: "machineLogs",
      payload: await getMachineLogs()
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

app.post("/api/products/bulk-update", async (req, res) => {
    console.log("BULK UPDATE BODY:", req.body);
    const client = await db.connect();

    try {
        const { updates } = req.body;

        await client.query("BEGIN");

        for (const item of updates) {
            const productId = item.product_id;

            // BLOCK EDITING OF DEACTIVATED PRODUCTS
            const activeCheck = await client.query(
                `SELECT is_active
                 FROM products
                 WHERE product_id = $1`,
                [productId]
            );

            if (!activeCheck.rows[0]?.is_active) {
                console.log(`Product ${productId} is deactivated. Skipping update.`);
                continue;
            }

            const stock = Number(item.stock_count) || 0;
            const max = Number(item.max_capacity) || 0;
            const price = Number(item.price) || 0;
            const name = item.product_name ?? null;

            // Update inventory
            await client.query(
                `UPDATE inventory
                 SET stock_count = $1,
                     max_capacity = $2,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE product_id = $3`,
                [stock, max, productId]
            );

            // Update product info
            await client.query(
                `UPDATE products
                 SET product_name = COALESCE($1, product_name),
                     price = COALESCE($2, price)
                 WHERE product_id = $3`,
                [name, price, productId]
            );
        }

        await client.query("COMMIT");

        broadcast({
            type: "productInventory",
            payload: await getProductInventory()
        });

        broadcast({
            type: "summary",
            payload: await getSummary()
        });

        res.json({ success: true });

    } catch (err) {
        await client.query("ROLLBACK");

        console.error("BULK UPDATE ERROR:", err);

        res.status(500).json({
            success: false,
            error: err.message
        });

    } finally {
        client.release();
    }
});

app.post("/api/products", async (req, res) => {
    const client = await db.connect();

    try {

        const {
            product_name,
            price,
            stock_count,
            max_capacity
        } = req.body;

        await client.query("BEGIN");

        const productResult = await client.query(`
            INSERT INTO products (
                product_name,
                price
            )
            VALUES ($1, $2)
            RETURNING *
        `, [
            product_name,
            price
        ]);

        const productId = productResult.rows[0].product_id;

        await client.query(`
            INSERT INTO inventory (
                product_id,
                stock_count,
                max_capacity,
                updated_at
            )
            VALUES ($1, $2, $3, NOW())
        `, [
            productId,
            stock_count,
            max_capacity
        ]);

        await client.query("COMMIT");

        broadcast({
            type: "productInventory",
            payload: await getProductInventory()
        });

        broadcast({
            type: "summary",
            payload: await getSummary()
        });

        res.json({ success: true });

    } catch (err) {

        await client.query("ROLLBACK");

        console.error(err);

        res.status(500).json({
            success: false
        });

    } finally {
        client.release();
    }
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
