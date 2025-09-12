import express from "express";
import pool from "../db.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import axios from "axios";
import crypto from "crypto";

const router = express.Router();

// ✅ Get wallet balance
router.get("/balance", authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT balance FROM wallets WHERE user_id = $1", [req.user.id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: "Wallet not found" });
    }
    res.json({ balance: rows[0].balance });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ Initialize Paystack Deposit
router.post("/deposit/initiate", authMiddleware, async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    // Get user email
    const userEmailQuery = await pool.query("SELECT email FROM users WHERE id = $1", [req.user.id]);
    if (userEmailQuery.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }
    const email = userEmailQuery.rows[0].email;

    // ✅ include callback_url so user comes back to wallet.html
    const response = await axios.post(
      "https://api.paystack.co/transaction/initialize",
      {
        email,
        amount: amount * 100, // Paystack expects kobo
        callback_url: "https://premierpredict.onrender.com/wallet.html",
        metadata: { userId: req.user.id }
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    res.json({ authorizationUrl: response.data.data.authorization_url });
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: "Failed to initialize payment" });
  }
});

// ✅ Verify Paystack Payment (direct wallet update like test mode)
router.post("/deposit/verify", authMiddleware, async (req, res) => {
  try {
    const { reference } = req.body;
    if (!reference) return res.status(400).json({ error: "Missing reference" });

    // Call Paystack verify API
    const response = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }
      }
    );

    const data = response.data.data;

    if (data && data.status === "success") {
      const amount = data.amount / 100; // convert kobo to naira
      const userId = data.metadata?.userId || req.user.id;

      // ✅ Update wallet balance (same as your test mode)
      const updated = await pool.query(
        `UPDATE wallets SET balance = balance + $1 WHERE user_id = $2 RETURNING balance`,
        [amount, userId]
      );

      return res.json({
        success: true,
        message: "Deposit successful",
        balance: updated.rows[0].balance
      });
    } else {
      return res.json({ success: false, message: "Payment not successful" });
    }
  } catch (err) {
    console.error("❌ Verification error:", err.response?.data || err.message);
    res.status(500).json({ error: "Verification failed" });
  }
});

// ✅ Paystack Webhook (auto-credit wallet even if user doesn’t return)
router.post("/webhook", express.json({ type: "application/json" }), async (req, res) => {
  try {
    const secret = process.env.PAYSTACK_SECRET_KEY;

    // Verify webhook signature
    const hash = crypto
      .createHmac("sha512", secret)
      .update(JSON.stringify(req.body))
      .digest("hex");

    if (hash !== req.headers["x-paystack-signature"]) {
      return res.sendStatus(401); // Invalid signature
    }

    const event = req.body;

    if (event.event === "charge.success") {
      const data = event.data;
      const amount = data.amount / 100;
      const userId = data.metadata.userId;

      // ✅ Same direct balance update as test mode
      await pool.query(
        `UPDATE wallets SET balance = balance + $1 WHERE user_id = $2 RETURNING balance`,
        [amount, userId]
      );

      console.log(`✅ Webhook deposit: ₦${amount} credited to user ${userId}`);
    }

    res.sendStatus(200); // acknowledge Paystack
  } catch (err) {
    console.error("❌ Webhook error:", err.message);
    res.sendStatus(500);
  }
});

// ✅ Withdraw funds
router.post("/withdraw", authMiddleware, async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    const { rows } = await pool.query("SELECT balance FROM wallets WHERE user_id = $1", [req.user.id]);
    if (rows.length === 0 || rows[0].balance < amount) {
      return res.status(400).json({ error: "Insufficient balance" });
    }

    const result = await pool.query(
      `UPDATE wallets SET balance = balance - $1 WHERE user_id = $2 RETURNING balance`,
      [amount, req.user.id]
    );

    res.json({ message: "Withdrawal successful", balance: result.rows[0].balance });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
