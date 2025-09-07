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

// Place a bet
router.post("/bet", authMiddleware, async (req, res) => {
  try {
    const { predictions } = req.body; // array of 10 match predictions
    if (!predictions || predictions.length !== 10) {
      return res.status(400).json({ error: "Must provide 10 predictions" });
    }

    await db.query(
      "INSERT INTO bets (user_id, predictions) VALUES (?, ?)",
      [req.userId, JSON.stringify(predictions)]
    );

    res.json({ message: "Bet placed successfully" });
  } catch (err) {
    console.error("Bet error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
