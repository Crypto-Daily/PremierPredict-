// routes/wallet.js
import express from "express";
import jwt from "jsonwebtoken";
import pool from "../db.js";

const router = express.Router();

// Middleware to check auth
function authMiddleware(req, res, next) {
  const token = req.headers["authorization"];
  if (!token) return res.status(401).json({ error: "No token provided" });

  try {
    const decoded = jwt.verify(token.split(" ")[1], process.env.JWT_SECRET);
    req.userId = decoded.id;
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

// Get wallet balance
router.get("/balance", authMiddleware, async (req, res) => {
  try {
    const result = await pool.query("SELECT balance FROM users WHERE id=$1", [req.userId]);
    res.json({ balance: result.rows[0].balance });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fake deposit (for testing)
router.post("/deposit", authMiddleware, async (req, res) => {
  try {
    const { amount } = req.body;

    await pool.query("UPDATE users SET balance = balance + $1 WHERE id=$2", [
      amount,
      req.userId,
    ]);

    res.json({ message: "Deposit successful" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
