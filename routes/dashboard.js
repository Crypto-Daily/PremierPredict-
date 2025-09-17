// routes/dashboard.js
import express from "express";
import pool from "../db.js";
import { authMiddleware } from "../middleware/authMiddleware.js";

const router = express.Router();

// Get dashboard data
router.get("/", authMiddleware, async (req, res) => {
  try {
    // Fetch basic user info
    const userRes = await pool.query(
      "SELECT id, username, email FROM users WHERE id = $1",
      [req.user.id]
    );

    // Fetch wallet balance
    const walletRes = await pool.query(
      "SELECT balance_kobo FROM wallets WHERE user_id = $1",
      [req.user.id]
    );

    const balance = walletRes.rows.length
      ? walletRes.rows[0].balance_kobo / 100
      : 0;

    res.json({
      user: userRes.rows[0],
      balance,
    });
  } catch (err) {
    console.error("❌ Dashboard error:", err.message);
    res.status(500).json({ error: "Failed to fetch dashboard data" });
  }
});

export default router;
