// routes/jackpot.js
import express from "express";
import jwt from "jsonwebtoken";
import pool from "../db.js";

const router = express.Router();

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

// Place a bet
router.post("/bet", authMiddleware, async (req, res) => {
  try {
    const { round_id, match_id, prediction, stake_kobo } = req.body;

    // Deduct stake from wallet
    await pool.query("UPDATE users SET balance = balance - $1 WHERE id=$2", [
      stake_kobo,
      req.userId,
    ]);

    // Save bet
    const bet = await pool.query(
      "INSERT INTO bets (user_id, round_id, match_id, prediction, stake_kobo) VALUES ($1,$2,$3,$4,$5) RETURNING *",
      [req.userId, round_id, match_id, prediction, stake_kobo]
    );

    res.json({ bet: bet.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
