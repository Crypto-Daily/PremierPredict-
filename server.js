import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

const app = express();
app.use(cors());
app.use(bodyParser.json());

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY; // put your sk_test / sk_live key in Render env

// Payment route
app.post("/api/pay", async (req, res) => {
  try {
    const { phone, selections } = req.body;

    // FIXED amount = ₦100 (Paystack expects kobo → 100 * 100 = 10000)
    const amount = 100 * 100;

    // Initialize Paystack payment
    const response = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: `${phone}@premierpredict.com`, // fake email since no email collected
        amount,
        metadata: {
          phone,
          selections,
        },
        callback_url: "https://premierpredict.onrender.com/success.html", // redirect here after payment
      }),
    });

    const data = await response.json();

    if (!data.status) {
      return res.status(400).json({ error: data.message });
    }

    // Send URL to frontend
    res.json({ authorization_url: data.data.authorization_url });
  } catch (error) {
    console.error("Payment init error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Port binding
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));
