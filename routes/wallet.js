// routes/wallet.js
import express from "express";
import pool from "../db.js";
import { authMiddleware } from "../middleware/authMiddleware.js";

const router = express.Router();

// Get wallet balance
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

// Deposit funds
router.post("/deposit", authMiddleware, async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    const { rows } = await pool.query(
      `UPDATE wallets SET balance = balance + $1 WHERE user_id = $2 RETURNING balance`,
      [amount, req.user.id]
    );

    res.json({ message: "Deposit successful", balance: rows[0].balance });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Withdraw funds
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
