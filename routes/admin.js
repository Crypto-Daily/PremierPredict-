// routes/admin.js
import express from "express";
import pool from "../db.js";
import { authMiddleware } from "../middleware/authMiddleware.js";

const router = express.Router();

// Middleware to ensure only admins can access
async function adminMiddleware(req, res, next) {
  if (!req.user?.is_admin) {
    return res.status(403).json({ error: "Access denied" });
  }
  next();
}

// --- CREATE NEW ROUND --------------------------------------------------
router.post("/rounds", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { name, start_time, end_time } = req.body;
    const result = await pool.query(
      `INSERT INTO jackpot_rounds (name, start_time, end_time, status, is_active)
       VALUES ($1, $2, $3, 'active', true)
       RETURNING *`,
      [name, start_time, end_time]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error creating round" });
  }
});

// --- UPDATE RESULTS ----------------------------------------------------
router.post("/results/:roundId", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { roundId } = req.params;
    const { results } = req.body; // e.g. [{match_id:1, result:'H'}, ...]

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const r of results) {
        await client.query(
          `UPDATE jackpot_matches SET result = $1 WHERE id = $2 AND round_id = $3`,
          [r.result, r.match_id, roundId]
        );
      }
      await client.query("COMMIT");
      res.json({ success: true });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error updating results" });
  }
});

// --- LIST ALL USER TICKETS (WON/PENDING) -------------------------------
router.get("/tickets", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT t.id, u.username, r.name AS round_name, t.created_at,
             CASE
               WHEN r.status = 'completed' THEN 'won'
               ELSE 'pending'
             END AS ticket_status
      FROM jackpot_tickets t
      JOIN users u ON u.id = t.user_id
      JOIN jackpot_rounds r ON r.id = t.round_id
      ORDER BY t.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error fetching tickets" });
  }
});

export default router;
