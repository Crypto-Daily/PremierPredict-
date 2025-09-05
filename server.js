import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import fetch from "node-fetch";
import dotenv from "dotenv";
import pkg from "pg";

dotenv.config();

const { Pool } = pkg;
const app = express();
app.use(cors());
app.use(bodyParser.json());

// ✅ PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // required for Render
});

// ✅ Create table if not exists
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tickets (
        id SERIAL PRIMARY KEY,
        ticket_id VARCHAR(20) UNIQUE NOT NULL,
        phone VARCHAR(20) NOT NULL,
        selections JSONB NOT NULL,
        paid BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log("✅ Tickets table ready");
  } catch (err) {
    console.error("❌ Error creating tickets table:", err);
  }
})();

// ✅ Step 1: Create Paystack payment
app.post("/create-payment", async (req, res) => {
  try {
    const { phone, match } = req.body;
    if (!phone || !match) {
      return res.status(400).json({ error: "Phone and match are required" });
    }

    // Generate ticket ID
    const ticketId = "PRE" + Math.floor(10000000 + Math.random() * 90000000);

    // Save ticket in DB (unpaid for now)
    await pool.query(
      "INSERT INTO tickets (ticket_id, phone, selections, paid) VALUES ($1, $2, $3, $4)",
      [ticketId, phone, JSON.stringify(match), false]
    );

    // Initialize Paystack payment
    const response = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: `${phone}@premierpredict.com`,
        amount: 10000, // ₦100 (in kobo)
        reference: ticketId,
        // ✅ FIX: include both reference + ticketId
        callback_url: `${process.env.BASE_URL}/verify-payment?ticketId=${ticketId}&reference=${ticketId}`,
      }),
    });

    const data = await response.json();
    if (!data.status) {
      return res.status(400).json({ error: data.message || "Failed to initialize payment" });
    }

    return res.json({ authorization_url: data.data.authorization_url });
  } catch (err) {
    console.error("Create payment error:", err);
    res.status(500).json({ error: "Server error creating payment" });
  }
});

// ✅ Step 2: Verify payment
app.get("/verify-payment", async (req, res) => {
  try {
    const { reference, ticketId } = req.query;

    if (!reference || !ticketId) {
      return res.status(400).send("Missing reference or ticketId");
    }

    // Call Paystack verify API
    const verifyRes = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      },
    });

    const verifyData = await verifyRes.json();

    if (verifyData.status && verifyData.data.status === "success") {
      // ✅ Mark ticket as paid in DB
      await pool.query("UPDATE tickets SET paid = true WHERE ticket_id = $1", [ticketId]);

      // Redirect to frontend success page
      return res.redirect(
        `https://crypto-daily.github.io/PremierPredict-/success.html?ticket=${ticketId}`
      );
    }

    return res.send("Payment verification failed");
  } catch (err) {
    console.error("Verify payment error:", err);
    res.status(500).send("Server error verifying payment");
  }
});

// ✅ Step 3: Check tickets
app.get("/tickets", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM tickets ORDER BY created_at DESC");
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching tickets:", err);
    res.status(500).json({ error: "Failed to fetch tickets" });
  }
});

// ✅ Step 4: Get single ticket by ID (fixed column name)
app.get("/ticket/:ticketId", async (req, res) => {
  try {
    const { ticketId } = req.params;
    const result = await pool.query("SELECT * FROM tickets WHERE ticket_id = $1", [ticketId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Ticket not found" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Error fetching ticket:", err);
    res.status(500).json({ error: "Server error fetching ticket" });
  }
});

app.get("/", (req, res) => {
  res.send("PremierPredict Backend with PostgreSQL 🚀");
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
