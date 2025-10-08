// routes/rounds.js
import express from "express";
import pool from "../db.js";

const router = express.Router();

// --- Get all rounds + matches ---------------------------------------------
router.get("/", async (req, res) => {
  try {
    const roundsRes = await pool.query("SELECT * FROM jackpot_rounds ORDER BY id DESC");
    const rounds = [];

    for (const round of roundsRes.rows) {
      const matchesRes = await pool.query(
        "SELECT * FROM jackpot_matches WHERE round_id = $1 ORDER BY id ASC",
        [round.id]
      );
      rounds.push({ ...round, matches: matchesRes.rows });
    }

    res.json(rounds);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error fetching rounds" });
  }
});

// --- Update match results -------------------------------------------------
router.put("/match/:id", async (req, res) => {
  const { id } = req.params;
  const { result, home_team, away_team, start_time, match_time } = req.body;

  try {
    const q = `
      UPDATE jackpot_matches
      SET result = $1, home_team = $2, away_team = $3, start_time = $4, match_time = $5, updated_at = NOW()
      WHERE id = $6
      RETURNING *;
    `;
    const r = await pool.query(q, [result, home_team, away_team, start_time, match_time, id]);
    res.json(r.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error updating match" });
  }
});

// --- Create new round -----------------------------------------------------
router.post("/new", async (req, res) => {
  const { name, matches } = req.body;
  try {
    const roundRes = await pool.query(
      "INSERT INTO jackpot_rounds (name, is_active) VALUES ($1, false) RETURNING id",
      [name]
    );
    const roundId = roundRes.rows[0].id;

    for (const m of matches) {
      await pool.query(
        `INSERT INTO jackpot_matches (round_id, home_team, away_team, start_time, match_time)
         VALUES ($1, $2, $3, $4, $5)`,
        [roundId, m.home_team, m.away_team, m.start_time, m.match_time]
      );
    }

    res.json({ success: true, round_id: roundId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error creating new round" });
  }
});

// --- Activate / Deactivate round -----------------------------------------
router.put("/:id/activate", async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query("UPDATE jackpot_rounds SET is_active = false");
    const r = await pool.query("UPDATE jackpot_rounds SET is_active = true WHERE id = $1 RETURNING *", [id]);
    res.json(r.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error activating round" });
  }
});

router.put("/:id/deactivate", async (req, res) => {
  const { id } = req.params;
  try {
    const r = await pool.query("UPDATE jackpot_rounds SET is_active = false WHERE id = $1 RETURNING *", [id]);
    res.json(r.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error deactivating round" });
  }
});

export default router;
