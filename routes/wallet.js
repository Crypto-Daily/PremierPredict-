// routes/wallet.js
import express from "express";
import pool from "../db.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import axios from "axios";
import crypto from "crypto";

const router = express.Router();

/**
 * ✅ Get wallet balance
 */
router.get("/balance", authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT balance_kobo FROM wallets WHERE user_id = $1",
      [req.user.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Wallet not found" });
    }

    // Convert kobo → naira
    const balance = rows[0].balance_kobo / 100;

    res.json({ balance });
  } catch (err) {
    console.error("❌ Balance error:", err.message);
    res.status(500).json({ error: "Failed to fetch balance" });
  }
});

/**
 * ✅ Initialize Paystack Deposit
 */
router.post("/deposit/initiate", authMiddleware, async (req, res) => {
  try {
    const { amount } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    // Get user email
    const { rows } = await pool.query(
      "SELECT email FROM users WHERE id = $1",
      [req.user.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const email = rows[0].email;

    // Initialize Paystack transaction
    const paystackRes = await axios.post(
      "https://api.paystack.co/transaction/initialize",
      {
        email,
        amount: amount * 100, // convert to kobo
        callback_url: `${process.env.APP_URL}/api/wallet/deposit/verify`,
        metadata: { userId: req.user.id },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    const { authorization_url, reference } = paystackRes.data.data;

    // Save pending payment
    await pool.query(
      `INSERT INTO paystack_payments (user_id, reference, amount, status)
       VALUES ($1, $2, $3, 'pending')`,
      [req.user.id, reference, amount]
    );

    res.json({ authorizationUrl: authorization_url, reference });
  } catch (err) {
    console.error(
      "❌ Deposit initiation error:",
      err.response?.data || err.message
    );
    res.status(500).json({ error: "Failed to initialize deposit" });
  }
});

/**
 * ✅ Verify Paystack Payment (via redirect from Paystack)
 */
router.get("/deposit/verify", async (req, res) => {
  try {
    const { reference } = req.query;

    if (!reference) {
      return res.redirect("/wallet.html?status=missing_reference");
    }

    // Verify with Paystack
    const verifyRes = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
      }
    );

    const data = verifyRes.data.data;
    console.log("🔍 Paystack verify response:", JSON.stringify(data, null, 2));

    if (data?.status === "success") {
      const amount = data.amount / 100; // amount in naira
      const userId = data.metadata?.userId;

      if (!userId) {
        console.error("❌ No userId in metadata");
        return res.redirect("/wallet.html?status=failed");
      }

      // Prevent double credit
      const existing = await pool.query(
        `SELECT status FROM paystack_payments WHERE reference = $1`,
        [reference]
      );
      if (existing.rows.length && existing.rows[0].status === "success") {
        return res.redirect("/wallet.html?status=already_verified");
      }

      // Mark payment as success
      await pool.query(
        `UPDATE paystack_payments 
         SET status = 'success', updated_at = NOW()
         WHERE reference = $1`,
        [reference]
      );

      // Credit wallet (convert to kobo)
      await pool.query(
        `UPDATE wallets 
         SET balance_kobo = balance_kobo + $1 
         WHERE user_id = $2`,
        [amount * 100, userId]
      );

      console.log(`✅ Deposit verified: ₦${amount} credited to user ${userId}`);
      return res.redirect(`/wallet.html?status=success&amount=${amount}`);
    }

    res.redirect("/wallet.html?status=failed");
  } catch (err) {
    console.error("❌ Verification error:", err.response?.data || err.message);
    res.redirect("/wallet.html?status=error");
  }
});

/**
 * ✅ Webhook (extra safety)
 */
router.post(
  "/webhook",
  express.json({ type: "application/json" }),
  async (req, res) => {
    try {
      const secret = process.env.PAYSTACK_SECRET_KEY;

      // Verify signature
      const hash = crypto
        .createHmac("sha512", secret)
        .update(JSON.stringify(req.body))
        .digest("hex");

      if (hash !== req.headers["x-paystack-signature"]) {
        console.error("❌ Invalid webhook signature");
        return res.sendStatus(401);
      }

      const event = req.body;

      if (event.event === "charge.success") {
        const data = event.data;
        const amount = data.amount / 100; // naira
        const userId = data.metadata?.userId;

        if (!userId) {
          console.error("❌ Webhook missing userId metadata");
          return res.sendStatus(400);
        }

        // Mark success
        await pool.query(
          `UPDATE paystack_payments
           SET status = 'success', updated_at = NOW()
           WHERE reference = $1`,
          [data.reference]
        );

        // Credit wallet (convert to kobo)
        await pool.query(
          `UPDATE wallets
           SET balance_kobo = balance_kobo + $1
           WHERE user_id = $2`,
          [amount * 100, userId]
        );

        console.log(`✅ Webhook deposit: ₦${amount} credited to user ${userId}`);
      }

      res.sendStatus(200);
    } catch (err) {
      console.error("❌ Webhook error:", err.message);
      res.sendStatus(500);
    }
  }
);

export default router;
