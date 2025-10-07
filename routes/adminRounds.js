import express from "express";
import pool from "../db.js";
import { authMiddleware } from "../middleware/authMiddleware.js";

const router = express.Router();

// Admin access middleware
async function adminOnly(req, res, next) {
  if (!req.user?.is_admin) {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}

/* ───────────────────────────────
   1️⃣  CREATE NEW ROUND (with matches)
   ─────────────────────────────── */
router.post("/rounds/full", authMiddleware, adminOnly, async (req, res) => {
  const { name, matches } = req.body; // matches = [{home_team, away_team, match_time}]
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const roundRes = await client.query(
      "INSERT INTO jackpot_rounds (name, is_active) VALUES ($1, false) RETURNING *",
      [name]
    );
    const round = roundRes.rows[0];

    for (const m of matches) {
      await client.query(
        `INSERT INTO jackpot_matches (round_id, home_team, away_team, match_time)
         VALUES ($1, $2, $3, $4)`,
        [round.id, m.home_team, m.away_team, m.match_time]
      );
    }

    await client.query("COMMIT");
    res.json({ success: true, round });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Failed to create round with matches" });
  } finally {
    client.release();
  }
});

/* ───────────────────────────────
   2️⃣  UPDATE ALL RESULTS IN A ROUND
   ─────────────────────────────── */
router.put("/rounds/:id/results", authMiddleware, adminOnly, async (req, res) => {
  const { id } = req.params;
  const { results } = req.body; // [{match_id, result}]
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    for (const r of results) {
      if (!["H", "D", "A"].includes(r.result)) continue;
      await client.query(
        "UPDATE jackpot_matches SET result = $1 WHERE id = $2 AND round_id = $3",
        [r.result, r.match_id, id]
      );
    }

    await client.query("COMMIT");
    res.json({ success: true, message: "Results updated" });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Failed to update results" });
  } finally {
    client.release();
  }
});

/* ───────────────────────────────
   3️⃣  ACTIVATE / DEACTIVATE ROUND
   ─────────────────────────────── */
router.put("/rounds/:id/active", authMiddleware, adminOnly, async (req, res) => {
  const { id } = req.params;
  const { is_active } = req.body;
  try {
    const result = await pool.query(
      "UPDATE jackpot_rounds SET is_active = $1 WHERE id = $2 RETURNING *",
      [is_active, id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update round status" });
  }
});

/* ───────────────────────────────
   4️⃣  VIEW ROUNDS (with matches)
   ─────────────────────────────── */
router.get("/rounds", authMiddleware, adminOnly, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT r.id AS round_id, r.name, r.is_active,
             json_agg(json_build_object(
               'id', m.id,
               'home_team', m.home_team,
               'away_team', m.away_team,
               'match_time', m.match_time,
               'result', m.result
             ) ORDER BY m.id) AS matches
      FROM jackpot_rounds r
      LEFT JOIN jackpot_matches m ON m.round_id = r.id
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
