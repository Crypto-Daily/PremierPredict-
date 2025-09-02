// server.js (CommonJS version)

const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const fetch = require("node-fetch");
const dotenv = require("dotenv");
const mongoose = require("mongoose");

dotenv.config();

const app = express();
app.use(cors());
app.use(bodyParser.json());

// ✅ Connect MongoDB
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.error("❌ MongoDB error:", err));

// ✅ Ticket Schema
const ticketSchema = new mongoose.Schema({
  ticketId: String,
  phone: String,
  match: String,
  createdAt: { type: Date, default: Date.now },
});

const Ticket = mongoose.model("Ticket", ticketSchema);

// ✅ Verify payment
app.get("/verify-payment/:reference", async (req, res) => {
  const reference = req.params.reference;

  try {
    const response = await fetch(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        },
      }
    );

    const data = await response.json();

    if (data.status && data.data.status === "success") {
      // Generate unique ticket
      const ticketId = "PRE" + Math.floor(10000000 + Math.random() * 90000000);

      // Save to DB
      const ticket = new Ticket({
        ticketId,
        phone: data.data.customer.phone || "N/A",
        match: "Premier League Prediction",
      });

      await ticket.save();

      // Redirect to GitHub page with ticket
      res.redirect(
        `https://crypto-daily.github.io/PremierPredict-/success.html?ticket=${ticketId}`
      );
      return;
    } else {
      res.status(400).json({ error: "Payment verification failed" });
    }
  } catch (err) {
    console.error("❌ Error verifying payment:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ Get all tickets (for testing/debugging)
app.get("/tickets", async (req, res) => {
  const tickets = await Ticket.find();
  res.json(tickets);
});

// ✅ Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
