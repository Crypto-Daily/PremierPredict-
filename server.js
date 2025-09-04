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
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
  .then(() => console.log("✅ Connected to MongoDB"))
  .catch(err => console.error("❌ MongoDB connection error:", err));

// ✅ Ticket Schema
const ticketSchema = new mongoose.Schema({
  ticketId: String,
  phone: String,
  match: Object,
  paid: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

const Ticket = mongoose.model("Ticket", ticketSchema);

// ✅ Step 1: Create Paystack payment
app.post("/create-payment", async (req, res) => {
  try {
    const { phone, match } = req.body;
    if (!phone || !match) {
      return res.status(400).json({ error: "Phone and match are required" });
    }

    // Generate ticket ID
    const ticketId = "PRE" + Math.floor(10000000 + Math.random() * 90000000);

    // Save ticket (unpaid for now)
    const ticket = new Ticket({ ticketId, phone, match, paid: false });
    await ticket.save();

    // Initialize Paystack payment
    const response = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: `${phone}@premierpredict.com`, // Paystack requires email
        amount: 10000, // ₦100 (in kobo)
        reference: ticketId,
        callback_url: `https://crypto-daily.github.io/PremierPredict-/success.html?ticketId=${ticketId}`,
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

// ✅ Step 2: Verify payment after Paystack redirects
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
      // Mark ticket as paid in DB
      await Ticket.findOneAndUpdate(
        { ticketId },
        { paid: true }
      );

      // Redirect to success page with ticketId
      return res.redirect(`https://crypto-daily.github.io/PremierPredict-/success.html?ticket=${ticketId}`);
    }

    return res.send("Payment verification failed");
  } catch (err) {
    console.error("Verify payment error:", err);
    res.status(500).send("Server error verifying payment");
  }
});

// ✅ Health check
app.get("/", (req, res) => {
  res.send("PremierPredict Backend is running 🚀");
});

// ✅ Step 3: Check tickets
app.get("/tickets", async (req, res) => {
  const tickets = await Ticket.find();
  res.json(tickets);
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
