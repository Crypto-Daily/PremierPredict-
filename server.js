import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";
import dotenv from "dotenv";
import pg from "pg";
import cors from "cors";
import { v4 as uuidv4 } from "uuid";

dotenv.config();

const app = express();
app.use(cors());
app.use(bodyParser.json());

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const BASE_URL = process.env.BASE_URL;
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;

// ✅ Test route
app.get("/", (req, res) => {
  res.send("PremierPredict Backend is running 🚀");
});

// ✅ Create Payment
app.post("/create-payment", async (req, res) => {
  try {
    const { phone, selections } = req.body;

    if (!phone || !selections) {
      return res.status(400).json({ error: "Phone number and selections required" });
    }

    const ticketId = "PRE" + Math.floor(10000000 + Math.random() * 90000000);
    const reference = uuidv4();
    const amount = 100 * 100; // ₦100 in kobo

    await pool.query(
      `INSERT INTO tickets (ticket_id, password, phone, selections, reference, amount, paid)
       VALUES ($1, $2, $3, $4, $5, $6, FALSE)`,
      [ticketId, "pass123", phone, JSON.stringify(selections), reference, amount]
    );

    const response = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        email: `${phone}@premierpredict.com`,
        amount,
        reference,
        callback_url: `${BASE_URL}/verify-payment?reference=${reference}&ticket=${ticketId}`
      })
    });

    const data = await response.json();

    if (!data.status) {
      return res.status(400).json({ error: "Payment failed to initialize" });
    }

    res.json({ paymentUrl: data.data.authorization_url });
  } catch (err) {
    console.error("Create payment error:", err);
    res.status(500).json({ error: "Server error creating payment" });
  }
});

// ✅ Verify Payment
app.get("/verify-payment", async (req, res) => {
  try {
    const { reference, ticket } = req.query;

    if (!reference || !ticket) {
      return res.status(400).send("Invalid request");
    }

    const response = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json"
      }
    });

    const data = await response.json();

    if (data.status && data.data.status === "success") {
      // ✅ Update ticket to mark as paid
      await pool.query(
        "UPDATE tickets SET paid = TRUE WHERE ticket_id = $1",
        [ticket]
      );

      return res.redirect(
        `https://crypto-daily.github.io/PremierPredict-/success.html?ticket=${ticket}`
      );
    } else {
      return res.redirect(
        "https://crypto-daily.github.io/PremierPredict-/failed.html"
      );
    }
  } catch (err) {
    console.error("Verify payment error:", err);
    res.status(500).send("Server error verifying payment");
  }
});

// ✅ Get all tickets
app.get("/tickets", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM tickets ORDER BY created_at DESC");
    res.json(result.rows);
  } catch (err) {
    console.error("Fetch tickets error:", err);
    res.status(500).json({ error: "Server error fetching tickets" });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tickets (
      id SERIAL PRIMARY KEY,
      ticket_id VARCHAR(50) UNIQUE NOT NULL,
      password VARCHAR(50) NOT NULL,
      phone VARCHAR(20) NOT NULL,
      selections JSONB NOT NULL,
      reference VARCHAR(100) NOT NULL,
      amount INT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      paid BOOLEAN DEFAULT FALSE
    );
  `);
  console.log("✅ Tickets table ready");
});
