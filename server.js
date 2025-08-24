import express from "express";
import pkg from "pg";
import dotenv from "dotenv";
import crypto from "crypto";

dotenv.config();
const { Pool } = pkg;

const app = express();
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

    const response = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        amount: amount * 100, // Paystack expects kobo
      }),
    });

    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error("❌ Payment init error:", err);
    res.status(500).send("Payment initialization failed");
  }
});

// ✅ Paystack Webhook
app.post("/webhook", (req, res) => {
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

  // ✅ Process webhook event
  const event = req.body.event;
  console.log("✅ Webhook received:", event);

  // Example: Save successful payment to DB
  if (event === "charge.success") {
    const { reference, amount, customer } = req.body.data;
    pool.query(
      "INSERT INTO payments(reference, amount, email) VALUES($1, $2, $3)",
      [reference, amount, customer.email]
    ).catch(err => console.error("DB insert error:", err));
  }

  res.sendStatus(200);
});

// ✅ Verify Paystack payment & save ticket
app.post("/verify-payment", async (req, res) => {
  try {
    const { reference, selections, phone } = req.body;

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

// ✅ Start server
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
