import express from "express";
import pool from "../db.js";
import { authMiddleware } from "../middleware/authMiddleware.js";

const router = express.Router();

// --- Get all winning tickets (with user + round info) ---
router.get("/winning-tickets", authMiddleware, async (req, res) => {
  try {
    // Optional: Only allow admin
    if (!req.user.is_admin) {
      return res.status(403).json({ message: "Access denied" });
    }

    const query = `
      SELECT 
        t.id AS ticket_id,
        u.id AS user_id,
        u.username,
        r.id AS round_id,
        r.name AS round_name,
        t.is_won,
        t.created_at
      FROM jackpot_tickets t
      JOIN users u ON u.id = t.user_id
      JOIN jackpot_rounds r ON r.id = t.round_id
      WHERE t.is_won = true
      ORDER BY t.created_at DESC;
    `;

    const { rows } = await pool.query(query);

    res.json(rows);
  } catch (err) {
    console.error("Error fetching winning tickets:", err);
    res.status(500).json({ message: "Server error" });
  }
});

export default router;
