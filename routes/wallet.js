import express from "express";
import jwt from "jsonwebtoken";
import db from "../db.js";

const router = express.Router();

// Middleware to verify JWT
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "No token provided" });

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) return res.status(403).json({ error: "Invalid token" });
    req.userId = decoded.id;
    next();
  });
}

// Get balance
router.get("/balance", authMiddleware, async (req, res) => {
  try {
    const [rows] = await db.query("SELECT balance FROM users WHERE id = ?", [
      req.userId,
    ]);
    res.json({ balance: rows[0].balance });
  } catch (err) {
    console.error("Balance error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Deposit (dummy for now, Paystack integration later)
router.post("/deposit", authMiddleware, async (req, res) => {
  try {
    const { amount } = req.body;
    await db.query("UPDATE users SET balance = balance + ? WHERE id = ?", [
      amount,
      req.userId,
    ]);
    res.json({ message: "Deposit successful" });
  } catch (err) {
    console.error("Deposit error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
