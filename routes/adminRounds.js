import express from "express";
import pool from "../db.js";
import { authMiddleware } from "../middleware/authMiddleware.js";

const router = express.Router();

// ✅ (Optional) secure all routes to admins only
// router.use(authMiddleware); // Uncomment if you already have admin auth

// ---------------------------------------------------------------------------
// 1️⃣ Get all rounds
// ---------------------------------------------------------------------------
router.get("/rounds", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name, is_active, status, start_time, end_time, created_at
      FROM jackpot_rounds
      ORDER BY id DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching rounds:", err);
    res.status(500).json({ error: "Error fetching rounds" });
  }
});

// ---------------------------------------------------------------------------
// 2️⃣ Get all matches for a specific round
// ---------------------------------------------------------------------------
router.get("/rounds/:id/matches", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`
      SELECT id, home_team, away_team, result, match_time
      FROM jackpot_matches
      WHERE round_id = $1
      ORDER BY id ASC
    `, [id]);
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching matches:", err);
    res.status(500).json({ error: "Error fetching matches" });
  }
});

// ---------------------------------------------------------------------------
// 3️⃣ Update match results for a specific round
// ---------------------------------------------------------------------------
router.post("/rounds/:id/update-results", async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { matches } = req.body; // Array of { id, result }

    await client.query("BEGIN");

    for (const match of matches) {
      await client.query(
        `UPDATE jackpot_matches
         SET result = $1
         WHERE id = $2 AND round_id = $3`,
        [match.result, match.id, id]
      );
    }

    await client.query("COMMIT");
    res.json({ success: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error updating match results:", err);
    res.status(500).json({ error: "Error updating match results" });
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------------
// 4️⃣ Create a new round with 10 matches
// ---------------------------------------------------------------------------
router.post("/rounds/create", async (req, res) => {
  const client = await pool.connect();
  try {
    const { name, start_time, end_time, matches } = req.body;
    // matches = [{ home_team, away_team, match_time }]

    if (!matches || matches.length !== 10) {
      return res.status(400).json({ error: "Exactly 10 matches required" });
    }

    await client.query("BEGIN");

    // Deactivate all previous rounds
    await client.query(`UPDATE jackpot_rounds SET is_active = FALSE, status = 'closed'`);

    // Create new round
    const roundRes = await client.query(
      `INSERT INTO jackpot_rounds (name, is_active, status, start_time, end_time)
       VALUES ($1, TRUE, 'open', $2, $3)
       RETURNING id`,
      [name, start_time, end_time]
    );
    const roundId = roundRes.rows[0].id;

    // Insert matches
    for (const m of matches) {
      await client.query(
        `INSERT INTO jackpot_matches (round_id, home_team, away_team, match_time)
         VALUES ($1, $2, $3, $4)`,
        [roundId, m.home_team, m.away_team, m.match_time]
      );
    }

    await client.query("COMMIT");
    res.json({ success: true, round_id: roundId });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error creating new round:", err);
    res.status(500).json({ error: "Error creating new round" });
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------------
// 5️⃣ Close / deactivate a round manually
// ---------------------------------------------------------------------------
router.post("/rounds/:id/close", async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query(`
      UPDATE jackpot_rounds
      SET is_active = FALSE, status = 'closed'
      WHERE id = $1
    `, [id]);
    res.json({ success: true });
  } catch (err) {
    console.error("Error closing round:", err);
    res.status(500).json({ error: "Error closing round" });
  }
});

export default router;
