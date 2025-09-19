// routes/jackpot.js
import express from "express";
import pool from "../db.js";
import { authMiddleware } from "../middleware/authMiddleware.js";

const router = express.Router();
const STAKE_KOBO = 10000; // ₦100 fixed stake
const ALLOWED_PREDICTIONS = new Set(["home_win", "draw", "away_win"]);

/**
 * GET /api/jackpot
 * Get current active jackpot round + matches
 */
router.get("/", authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT jr.id, jr.name, jr.prize_pool_kobo, jr.status, jr.start_time, jr.end_time,
              COALESCE(
                json_agg(
                  json_build_object(
                    'match_id', jm.id,
                    'home_team', jm.home_team,
                    'away_team', jm.away_team,
                    'match_time', jm.match_time,
                    'result', jm.result
                  ) ORDER BY jm.match_time
                ) FILTER (WHERE jm.id IS NOT NULL), '[]'
              ) AS matches
       FROM jackpot_rounds jr
       LEFT JOIN jackpot_matches jm ON jm.round_id = jr.id
       WHERE jr.status = 'active'
       GROUP BY jr.id
       ORDER BY jr.created_at DESC
       LIMIT 1`
    );

    if (rows.length === 0) return res.json({ message: "No active jackpot round." });
    res.json(rows[0]);
  } catch (err) {
    console.error("❌ Error fetching jackpot:", err);
    res.status(500).json({ error: "Server error fetching jackpot." });
  }
});

/**
 * POST /api/jackpot/bet
 * Place a bet with 10 selections
 */
router.post("/bet", authMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    const userId = req.user.id;
    const { selections } = req.body; // [{ match_id, prediction }]

    if (!selections || selections.length !== 10) {
      return res.status(400).json({ error: "Must provide 10 selections." });
    }

    // Validate predictions
    for (const s of selections) {
      if (!ALLOWED_PREDICTIONS.has(s.prediction)) {
        return res.status(400).json({ error: `Invalid prediction: ${s.prediction}` });
      }
    }

    await client.query("BEGIN");

    // Insert ticket
    const ticketRes = await client.query(
      `INSERT INTO jackpot_tickets (user_id, round_id, amount_kobo, stake_kobo, reference)
       VALUES ($1, (SELECT id FROM jackpot_rounds WHERE status='active' LIMIT 1),
               $2, $2, gen_random_uuid())
       RETURNING id`,
      [userId, STAKE_KOBO]
    );

    const ticketId = ticketRes.rows[0].id;

    // Insert selections
    const values = selections.map((s, i) =>
      `(${ticketId}, ${s.match_id}, '${s.prediction}')`
    );
    await client.query(
      `INSERT INTO jackpot_selections (ticket_id, match_id, selection)
       VALUES ${values.join(",")}`
    );

    await client.query("COMMIT");
    res.json({ message: "Bet placed successfully", ticket_id: ticketId });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error placing bet:", err);
    res.status(500).json({ error: "Server error placing bet." });
  } finally {
    client.release();
  }
});

/**
 * GET /api/jackpot/tickets
 * Get all tickets + selections for logged-in user
 */
router.get("/tickets", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const { rows } = await pool.query(
      `SELECT t.id, t.round_id, t.amount_kobo, t.stake_kobo, t.reference, t.created_at,
              COALESCE(
                json_agg(
                  json_build_object(
                    'match_id', s.match_id,
                    'selection', s.selection,
                    'result', s.result,
                    'is_correct', s.is_correct
                  )
                ) FILTER (WHERE s.id IS NOT NULL), '[]'
              ) AS selections
       FROM jackpot_tickets t
       LEFT JOIN jackpot_selections s ON s.ticket_id = t.id
       WHERE t.user_id = $1
       GROUP BY t.id
       ORDER BY t.created_at DESC`,
      [userId]
    );

    const tickets = rows.map(r => ({
      ...r,
      amount_kobo: Number(r.amount_kobo),
      stake_kobo: Number(r.stake_kobo)
    }));

    res.json({ tickets });
  } catch (err) {
    console.error("❌ Error fetching tickets:", err);
    res.status(500).json({ error: "Server error fetching tickets." });
  }
});

export default router;
