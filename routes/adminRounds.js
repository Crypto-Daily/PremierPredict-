import express from "express";
import pool from "../db.js";
import { authMiddleware } from "../middleware/authMiddleware.js";

const router = express.Router();

// Require admin
async function adminOnly(req, res, next) {
  if (!req.user?.is_admin) {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}

// ─────────── CREATE NEW ROUND ───────────
router.post("/rounds", authMiddleware, adminOnly, async (req, res) => {
  const { name, is_active = false } = req.body;
  try {
    const result = await pool.query(
      "INSERT INTO jackpot_rounds (name, is_active) VALUES ($1, $2) RETURNING *",
      [name, is_active]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create round" });
  }
});

// ─────────── ADD MATCH TO ROUND ───────────
router.post("/matches", authMiddleware, adminOnly, async (req, res) => {
  const { round_id, home_team, away_team, match_time } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO jackpot_matches (round_id, home_team, away_team, match_time)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [round_id, home_team, away_team, match_time]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to add match" });
  }
});

// ─────────── UPDATE MATCH RESULT ───────────
router.put("/matches/:id/result", authMiddleware, adminOnly, async (req, res) => {
  const { id } = req.params;
  const { result } = req.body; // "H", "D", or "A"
  try {
    const valid = ["H", "D", "A"];
    if (!valid.includes(result))
      return res.status(400).json({ error: "Invalid result value" });

    const updated = await pool.query(
      "UPDATE jackpot_matches SET result = $1 WHERE id = $2 RETURNING *",
      [result, id]
    );
    res.json(updated.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update result" });
  }
});

// ─────────── VIEW ROUNDS AND MATCHES ───────────
router.get("/rounds", authMiddleware, adminOnly, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT r.id AS round_id, r.name AS round_name, r.is_active,
             json_agg(json_build_object(
               'id', m.id,
               'home_team', m.home_team,
               'away_team', m.away_team,
               'match_time', m.match_time,
               'result', m.result
             ) ORDER BY m.id) AS matches
      FROM jackpot_rounds r
      LEFT JOIN jackpot_matches m ON r.id = m.round_id
      GROUP BY r.id
      ORDER BY r.id DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch rounds" });
  }
});

export default router;
