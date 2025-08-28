import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import fetch from "node-fetch";   // ✅ Needed for Paystack API
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(bodyParser.json());

// ✅ Create Paystack payment
app.post("/create-payment", async (req, res) => {
  try {
    const { phone, match } = req.body;

    if (!phone || !match) {
      return res.status(400).json({ error: "Phone and match are required" });
    }

    // fixed amount (₦100 = 10000 kobo)
    const amount = 100 * 100;

    // initialize Paystack transaction
    const response = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`, // ✅ must be SECRET key
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: `${phone}@premierpredict.com`, // fake email since Paystack requires it
        amount,
        callback_url: "https://crypto-daily.github.io/PremierPredict-/success.html", // ✅ change to your deployed success page
        metadata: { phone, match },
      }),
    });

    const data = await response.json();

    if (!data.status) {
      console.error("❌ Paystack init failed:", data);
      return res.status(400).json({ error: data.message || "Paystack error" });
    }

    res.json({ url: data.data.authorization_url });
  } catch (error) {
    console.error("❌ Payment error:", error.message, error.stack);
    res.status(500).json({ error: "Server error creating payment" });
  }
});

// ✅ Verify payment after callback
app.get("/verify-payment/:reference", async (req, res) => {
  try {
    const { reference } = req.params;

    const response = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      },
    });

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error("❌ Verification error:", error.message, error.stack);
    res.status(500).json({ error: "Verification failed" });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
// Generate ticket ID (example: PRE12345678)
function generateTicketId() {
  return "PRE" + Math.floor(10000000 + Math.random() * 90000000);
}

app.post("/create-payment", async (req, res) => {
  try {
    const { phone, match } = req.body;

    if (!phone || !match) {
      return res.status(400).json({ error: "Phone and match are required" });
    }

    const amount = 100 * 100;
    const ticketId = generateTicketId(); // ✅ create ticket

    const response = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: `${phone}@premierpredict.com`,
        amount,
        callback_url: `https://crypto-daily.github.io/PremierPredict-/success.html?ticket=${ticketId}`,
        metadata: { phone, match, ticketId }, // ✅ store ticket in Paystack metadata
      }),
    });
// Generate ticket ID (example: PRE12345678)
function generateTicketId() {
  return "PRE" + Math.floor(10000000 + Math.random() * 90000000);
}

app.post("/create-payment", async (req, res) => {
  try {
    const { phone, match } = req.body;

    if (!phone || !match) {
      return res.status(400).json({ error: "Phone and match are required" });
    }

    const amount = 100 * 100;
    const ticketId = generateTicketId();

    const response = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: `${phone}@premierpredict.com`,
        amount,
        // ✅ redirect to success page with ticket id in query string
        callback_url: `https://crypto-daily.github.io/PremierPredict-/success.html?ticket=${ticketId}`,
        metadata: { phone, match, ticketId },
      }),
    });

    const data = await response.json();

    if (!data.status) {
      console.error("❌ Paystack init failed:", data);
      return res.status(400).json({ error: data.message || "Paystack error" });
    }

    res.json({ url: data.data.authorization_url });
  } catch (error) {
    console.error("❌ Payment error:", error.message, error.stack);
    res.status(500).json({ error: "Server error creating payment" });
  }
});
