// server.js
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import fetch from "node-fetch";
import dotenv from "dotenv";
import pkg from "pg";
import { v4 as uuidv4 } from "uuid";

dotenv.config();
const { Pool } = pkg;

const app = express();
app.use(cors());
app.use(bodyParser.json());

// ✅ Connect to PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ✅ Create tickets table if not exists
(async () => {
  const client = await pool.connect();
  await client.query(`
    CREATE TABLE IF NOT EXISTS tickets (
      id SERIAL PRIMARY KEY,
      ticket_id VARCHAR(50) UNIQUE NOT NULL,
      phone VARCHAR(20) NOT NULL,
      selections JSONB NOT NULL,
      reference VARCHAR(100) NOT NULL,
      amount INTEGER NOT NULL,
      paid BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  client.release();
  console.log("✅ Tickets table ready");
})();

// ✅ Create Paystack payment
app.post("/create-payment", async (req, res) => {
  try {
    const { phone, selections } = req.body;

    if (!phone || !selections) {
      return res.status(400).json({ error: "Phone and selections are required" });
    }

    const amount = 10000; // ₦100 in kobo
    const ticketId = uuidv4();

    const response = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: `${phone}@premierpredict.com`,
        amount,
        metadata: { phone, selections, ticketId },
      }),
    });

    const data = await response.json();

    if (!data.status) {
      return res.status(400).json({ error: data.message });
    }

    res.json({
      authorizationUrl: data.data.authorization_url,
      reference: data.data.reference,
      ticketId,
    });
  } catch (err) {
    console.error("Create payment error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ Verify payment after Paystack redirects back
app.get("/verify-payment/:reference", async (req, res) => {
  try {
    const { reference } = req.params;

    const response = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
    });

    const data = await response.json();

    if (!data.status || data.data.status !== "success") {
      return res.redirect("https://crypto-daily.github.io/PremierPredict-Frontend/failed.html");
    }

    const { metadata, amount } = data.data;
    const ticketId = metadata.ticketId;
    const phone = metadata.phone;
    const selections = metadata.selections;

    // ✅ Save ticket into DB
    const client = await pool.connect();
    await client.query(
      `INSERT INTO tickets (ticket_id, phone, selections, reference, amount, paid)
       VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (ticket_id) DO NOTHING`,
      [ticketId, phone, JSON.stringify(selections), reference, amount]
    );
    client.release();

    // ✅ Redirect to success page with ticketId
    res.redirect(`https://crypto-daily.github.io/PremierPredict-Frontend/success.html?ticketId=${ticketId}`);
  } catch (err) {
    console.error("Verify error:", err);
    res.redirect("https://crypto-daily.github.io/PremierPredict-Frontend/failed.html");
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

// ✅ Fetch single ticket by ticketId
app.get("/ticket/:ticketId", async (req, res) => {
  try {
    const { ticketId } = req.params;
    const client = await pool.connect();
    const result = await client.query(
      "SELECT selections FROM tickets WHERE ticket_id = $1",
      [ticketId]
    );
    client.release();

    if (result.rows.length === 0) {
      return res.json({ match: null });
    }

    res.json({ match: result.rows[0].selections });
  } catch (err) {
    console.error(err);
    res.status(500).json({ match: null });
  }
});
