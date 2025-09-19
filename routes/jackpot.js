// routes/jackpot.js
import express from "express";
import pool from "../db.js";
import { authMiddleware } from "../middleware/authMiddleware.js";

const router = express.Router();

const ALLOWED_PREDICTIONS = new Set(["home_win", "draw", "away_win"]);
const STAKE_KOBO = 10000; // ₦100 fixed stake

/**
 * GET /api/jackpot
 * Returns the current active jackpot round with matches.
 */
router.get("/", authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT jr.id,
              jr.name,
              jr.prize_pool_kobo,
              jr.status,
              jr.start_time,
              jr.end_time,
              COALESCE(
                json_agg(
                  json_build_object(
                    'match_id', jm.id,
                    'home_team', jm.home_team,
                    'away_team', jm.away_team,
                    'match_time', jm.match_time,
                    'result', jm.result
                  ) ORDER BY jm.match_time
                ) FILTER (WHERE jm.id IS NOT NULL),
                '[]'
              ) AS matches
       FROM jackpot_rounds jr
       LEFT JOIN jackpot_matches jm ON jm.round_id = jr.id
       WHERE jr.status = 'active'
       GROUP BY jr.id
       ORDER BY jr.created_at DESC
       LIMIT 1`
    );

    if (rows.length === 0) {
      return res.json({ message: "No active jackpot round." });
    }

    const round = rows[0];
    round.prize_pool_kobo = Number(round.prize_pool_kobo);

    res.json(round);
  } catch (err) {
    console.error("❌ Error fetching jackpot:", err);
    res.status(500).json({ error: "Server error fetching jackpot.", details: err.message });
  }
});

/**
 * GET /api/jackpot/bets
 * Show all bets (from jackpot_bets) for the logged-in user
 */
router.get("/bets", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    const { rows } = await pool.query(
      `SELECT id, round_id, amount_kobo, choice, status, reference, created_at
       FROM jackpot_bets
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId]
    );

    // Parse JSON choices (so frontend gets an object not raw text)
    const bets = rows.map(r => ({
      ...r,
      amount_kobo: Number(r.amount_kobo),
      choice: typeof r.choice === "string" ? JSON.parse(r.choice) : r.choice
    }));

    res.json(bets);
  } catch (err) {
    console.error("❌ Error fetching jackpot bets:", err);
    res.status(500).json({ error: "Server error fetching bets.", details: err.message });
  }
});

/**
 * GET /api/jackpot/tickets
 * Show all tickets + selections (old method)
 */
router.get("/tickets", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    const { rows } = await pool.query(
      `SELECT t.id as ticket_id,
              t.round_id,
              t.amount_kobo,
              t.stake_kobo,
              t.reference,
              t.created_at,
              COALESCE(
                json_agg(
                  json_build_object(
                    'match_id', s.match_id,
                    'selection', s.selection
                  )
                ) FILTER (WHERE s.id IS NOT NULL),
                '[]'
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

    res.json(tickets);
  } catch (err) {
    console.error("❌ Error fetching jackpot tickets:", err);
    res.status(500).json({ error: "Server error fetching tickets.", details: err.message });
  }
});

export default router;
