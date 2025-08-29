// server.js
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import fetch from "node-fetch";
import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config();

const app = express();
app.use(cors());
app.use(bodyParser.json());

// ✅ Connect to MongoDB
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("✅ MongoDB connected"))
  .catch(err => console.error("❌ MongoDB connection failed:", err));

// ✅ Define Ticket Schema
const ticketSchema = new mongoose.Schema({
  ticketId: { type: String, required: true, unique: true },
  phone: { type: String, required: true },
  selections: { type: Object, required: true },
  reference: { type: String, required: true },
  amount: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now }
});

const Ticket = mongoose.model("Ticket", ticketSchema);

// ✅ Generate unique Ticket ID
function generateTicketId() {
  return "PRE" + Math.floor(10000000 + Math.random() * 90000000);
}

// ✅ Create Paystack payment
app.post("/create-payment", async (req, res) => {
  try {
    const { phone, selections } = req.body;

    // ✅ Ensure phone is provided and selections is not empty
    if (!phone || !selections || Object.keys(selections).length === 0) {
      return res.status(400).json({ error: "Phone number and selections are required" });
    }

    const amount = 100 * 100; // ₦100 in kobo
    const ticketId = generateTicketId();

    // Initialize Paystack transaction
    const response = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: `${phone}@premierpredict.com`, // Fake email (Paystack requires it)
        amount,
        callback_url: `https://crypto-daily.github.io/PremierPredict-/success.html?ticket=${ticketId}`,
        metadata: { phone, selections, ticketId },
      }),
    });

    const data = await response.json();

    if (!data.status) {
      console.error("❌ Paystack init failed:", data);
      return res.status(400).json({ error: data.message || "Paystack error" });
    }

    res.json({ url: data.data.authorization_url });
  } catch (error) {
    console.error("❌ Payment creation error:", error.message);
    res.status(500).json({ error: "Server error creating payment" });
  }
});

// ✅ Verify payment and save ticket
app.get("/verify-payment/:reference", async (req, res) => {
  try {
    const { reference } = req.params;

    // Verify with Paystack
    const response = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      },
    });

    const data = await response.json();

    if (data.status && data.data.status === "success") {
      const { phone, selections, ticketId } = data.data.metadata;
      const amount = data.data.amount;
      const paystackRef = data.data.reference;

      // ✅ Save ticket into MongoDB
      const ticket = new Ticket({ ticketId, phone, selections, reference: paystackRef, amount });
      await ticket.save();

      return res.json({
        success: true,
        ticketId,
        phone,
        selections,
      });
    } else {
      return res.status(400).json({ success: false, message: "Payment not verified" });
    }
  } catch (error) {
    console.error("❌ Verification error:", error.message);
    res.status(500).json({ error: "Verification failed" });
  }
});

// ✅ Root route
app.get("/", (req, res) => {
  res.send("PremierPredict Backend is running 🚀");
});

// ✅ Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
