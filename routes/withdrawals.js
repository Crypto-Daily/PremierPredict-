import express from "express";
import pool from "../db.js";
import { authMiddleware } from "../middleware/authMiddleware.js";

const router = express.Router();

// --- User submits withdrawal request ---
router.post("/", authMiddleware, async (req, res) => {
  const { amount, bank_name, account_number } = req.body;
  const userId = req.user.id;

  try {
    const { rows: [wallet] } = await pool.query(
      "SELECT balance_kobo FROM wallets WHERE user_id = $1",
      [userId]
    );

    const amount_kobo = Math.round(amount * 100);

    if (!wallet || wallet.balance_kobo < amount_kobo) {
      return res.status(400).json({ error: "Insufficient balance" });
    }

    // Create withdrawal request
    const { rows: [withdrawal] } = await pool.query(
      `INSERT INTO withdrawals (user_id, amount_kobo, bank_name, account_number)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [userId, amount_kobo, bank_name, account_number]
    );

    // Temporarily lock the funds
    await pool.query(
      "UPDATE wallets SET balance_kobo = balance_kobo - $1 WHERE user_id = $2",
      [amount_kobo, userId]
    );

    res.json({ message: "Withdrawal request submitted", withdrawal });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
