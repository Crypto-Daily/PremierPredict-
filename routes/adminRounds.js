// routes/adminRounds.js
import express from "express";
import pool from "../db.js";
import { authMiddleware } from "../middleware/authMiddleware.js";

const router = express.Router();

// --- Get all rounds and matches
router.get("/rounds", authMiddleware, async (req, res) => {
  try {
    const rounds = await pool.query(`
      SELECT id, name, is_active, start_time, end_time
      FROM jackpot_rounds
      ORDER BY id DESC
    `);

    const matches = await pool.query(`
      SELECT id, round_id, home_team, away_team, match_time, result
      FROM jackpot_matches
      ORDER BY id ASC
    `);

    const data = rounds.rows.map(r => ({
      ...r,
      matches: matches.rows.filter(m => m.round_id === r.id),
    }));

    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error fetching rounds" });
  }
});

// --- Update match result
router.put("/match/:id/result", authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { result } = req.body;

  try {
    const valid = ["H", "D", "A"];
    if (!valid.includes(result)) {
      return res.status(400).json({ error: "Result must be H, D, or A" });
    }

    await pool.query(
      "UPDATE jackpot_matches SET result = $1 WHERE id = $2",
      [result, id]
    );

    res.json({ message: "Result updated successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error updating result" });
  }
});

// --- Create new round
router.post("/rounds", authMiddleware, async (req, res) => {
  const { name, start_time, end_time, matches } = req.body;

  if (!matches || matches.length !== 10) {
    return res.status(400).json({ error: "Exactly 10 matches required" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const roundRes = await client.query(
      `INSERT INTO jackpot_rounds (name, is_active, start_time, end_time)
       VALUES ($1, TRUE, $2, $3)
       RETURNING id`,
      [name, start_time, end_time]
    );

    const roundId = roundRes.rows[0].id;

    for (const m of matches) {
      await client.query(
        `INSERT INTO jackpot_matches (round_id, home_team, away_team, match_time)
         VALUES ($1, $2, $3, $4)`,
        [roundId, m.home_team, m.away_team, m.match_time]
      );
    }

    await client.query("COMMIT");
    res.json({ message: "Round created successfully", round_id: roundId });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Server error creating round" });
  } finally {
    client.release();
  }
});

// --- Deactivate round
router.put("/rounds/:id/deactivate", authMiddleware, async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query(
      "UPDATE jackpot_rounds SET is_active = FALSE WHERE id = $1",
      [id]
    );
    res.json({ message: "Round deactivated" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error deactivating round" });
  }
});

export default router;
