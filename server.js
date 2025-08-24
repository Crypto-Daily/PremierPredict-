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
    console.error(err);
    res.status(500).send("Payment initialization failed");
  }
});

// ✅ Paystack Webhook (very important)
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

// ✅ Start server
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
