const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json());

const db = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

app.get("/", (req, res) => {
  res.send("Venta backend is running");
});

app.get("/api/products", async (req, res) => {
  try {
    const result = await db.query(`
      SELECT p.product_id, p.product_name, p.price,
             i.stock_count, i.max_capacity
      FROM products p
      LEFT JOIN inventory i ON p.product_id = i.product_id
      ORDER BY p.product_id
    `);

    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: "Failed to get products",
    });
  }
});

app.post("/api/transaction", async (req, res) => {
  try {
    const {
      product_id,
      quantity,
      total_amount,
      coin_inserted,
      change_given,
      status
    } = req.body;

    const result = await db.query(
      `INSERT INTO transactions
      (product_id, quantity, total_amount, coin_inserted, change_given, status)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *`,
      [
        product_id,
        quantity,
        total_amount,
        coin_inserted,
        change_given,
        status
      ]
    );

    await db.query(
      `UPDATE inventory
       SET stock_count = stock_count - $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE product_id = $2`,
      [quantity, product_id]
    );

    res.json({
      success: true,
      data: result.rows[0],
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: "Failed to save transaction",
    });
  }
});

app.post("/api/coin-inventory", async (req, res) => {
  try {
    const {
      one_peso,
      five_peso,
      ten_peso,
      twenty_peso
    } = req.body;

    const result = await db.query(
      `UPDATE coin_inventory
       SET one_peso = one_peso + $1,
           five_peso = five_peso + $2,
           ten_peso = ten_peso + $3,
           twenty_peso = twenty_peso + $4,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = 1
       RETURNING *`,
      [
        one_peso,
        five_peso,
        ten_peso,
        twenty_peso
      ]
    );

    res.json({
      success: true,
      data: result.rows[0],
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: "Failed to update coin inventory",
    });
  }
});

app.listen(process.env.PORT, () => {
  console.log(`Server running on port ${process.env.PORT}`);
});

app.get("/api/coin-inventory", async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM coin_inventory WHERE id = 1");
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ message: "Failed to get coin inventory" });
  }
});

app.get("/api/transactions", async (req, res) => {
  try {
    const result = await db.query(`
      SELECT t.transaction_id, p.product_name, t.quantity,
             t.total_amount, t.coin_inserted, t.change_given,
             t.status, t.created_at
      FROM transactions t
      LEFT JOIN products p ON t.product_id = p.product_id
      ORDER BY t.created_at DESC
    `);

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ message: "Failed to get transactions" });
  }
});