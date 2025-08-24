import express from "express";
import pkg from "pg";
import dotenv from "dotenv";
import crypto from "crypto";
import fetch from "node-fetch"; // ✅ Import fetch for Node.js

dotenv.config();
const { Pool } = pkg;

const app = express();

// ✅ Parse JSON normally
app.use(express.json());

// ✅ Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ✅ Test DB connection
async function initDB() {
  try {
    await pool.connect();
    console.log("📦 Connected to PostgreSQL");
  } catch (err) {
    console.error("❌ Database connection error", err);
  }
}
initDB();

// ✅ Home route
app.get("/", (req, res) => {
  res.send("PremierPredict backend is live 🚀");
});

// ✅ Start Paystack payment
app.post("/pay", async (req, res) => {
  try {
    const { email, amount } = req.body;

    if (!email || !amount) {
      return res.status(400).json({ error: "Email and amount are required" });
    }

    const response = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        amount: amount * 100, // Paystack expects amount in kobo
      }),
    });

    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error("❌ Payment init error:", err);
    res.status(500).send("Payment initialization failed");
  }
});

// ✅ Verify Paystack payment & save ticket
app.post("/verify-payment", async (req, res) => {
  try {
    const { reference, selections, phone } = req.body;

    if (!reference || !phone || !selections) {
      return res.status(400).json({ success: false, message: "Missing required fields" });
    }

    // 1️⃣ Verify with Paystack
    const response = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
    });

    const data = await response.json();
    if (!data.status || data.data.status !== "success") {
      return res.json({ success: false, message: "Payment not verified" });
    }

    // 2️⃣ Generate Ticket ID & Password
    const ticketID = "TICKET-" + crypto.randomBytes(3).toString("hex").toUpperCase();
    const password = crypto.randomBytes(4).toString("hex");

    // 3️⃣ Save to DB
    await pool.query(
      "INSERT INTO tickets(ticket_id, password, phone, selections, reference, amount) VALUES($1,$2,$3,$4,$5,$6)",
      [ticketID, password, phone, JSON.stringify(selections), reference, data.data.amount]
    );

    // 4️⃣ Send response to frontend
    res.json({
      success: true,
      ticketID,
      password,
    });

  } catch (err) {
    console.error("❌ Verify-payment error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ✅ Paystack Webhook
app.post("/webhook", (req, res) => {
  try {
    const signature = req.headers["x-paystack-signature"];
    if (!signature) {
      return res.status(401).send("No signature header found");
    }

    // Verify signature
    const hash = crypto
      .createHmac("sha512", process.env.PAYSTACK_SECRET_KEY)
      .update(JSON.stringify(req.body))
      .digest("hex");

    if (hash !== signature) {
      return res.status(401).send("Invalid signature");
    }

    const event = req.body.event;
    console.log("✅ Webhook received:", event);

    // Example: Log successful payment
    if (event === "charge.success") {
      const { reference, amount, customer } = req.body.data;
      console.log(`💰 Payment success: ${reference} - ${amount} by ${customer.email}`);
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("❌ Webhook error:", err);
    res.status(500).send("Webhook error");
  }
});

// ✅ Start server
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
