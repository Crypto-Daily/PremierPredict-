// routes/jackpot.js
import express from "express";
import pool from "../db.js";
import { authMiddleware } from "../middleware/authMiddleware.js";

const router = express.Router();
const STAKE_KOBO = 10000; // ₦100
const ALLOWED = new Set(["home_win", "draw", "away_win"]);

/**
 * GET /api/jackpot
 * Return active jackpot round + matches (max 10)
 */
router.get("/", authMiddleware, async (req, res) => {
  try {
    const q = `
      SELECT jr.id, jr.name, jr.prize_pool_kobo, jr.status, jr.start_time, jr.end_time,
             COALESCE(
               json_agg(json_build_object(
                 'match_id', jm.id,
                 'home_team', jm.home_team,
                 'away_team', jm.away_team,
                 'match_time', jm.match_time,
                 'result', jm.result
               ) ORDER BY jm.match_time)
               FILTER (WHERE jm.id IS NOT NULL), '[]'
             ) as matches
      FROM jackpot_rounds jr
      LEFT JOIN jackpot_matches jm ON jm.round_id = jr.id
      WHERE jr.status = 'active'
      GROUP BY jr.id
      ORDER BY jr.created_at DESC
      LIMIT 1
    `;
    const { rows } = await pool.query(q);
    if (rows.length === 0) return res.json({ message: "No active jackpot round." });
    const round = rows[0];
    round.prize_pool_kobo = Number(round.prize_pool_kobo);
    return res.json(round);
  } catch (err) {
    console.error("Error GET /api/jackpot", err);
    res.status(500).json({ error: "Server error fetching jackpot." });
  }
});

/**
 * POST /api/jackpot/bet
 * Body: { selections: [{ match_id, prediction }, ...] }
 * Accepts exactly 10 selections; deducts fixed stake and stores ticket + selections.
 */
router.post("/bet", authMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    const userId = req.user.id;
    const { selections } = req.body;

    if (!Array.isArray(selections) || selections.length !== 10) {
      return res.status(400).json({ error: "Provide exactly 10 selections." });
    }

    // validate shape
    for (const s of selections) {
      if (!s || !s.match_id || !s.prediction || !ALLOWED.has(String(s.prediction))) {
        return res.status(400).json({ error: "Each selection must be {match_id, prediction} with a valid prediction." });
      }
    }

    await client.query("BEGIN");

    // ensure active round exists & get id
    const r = await client.query("SELECT id FROM jackpot_rounds WHERE status='active' ORDER BY created_at DESC LIMIT 1");
    if (r.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "No active jackpot round." });
    }
    const roundId = r.rows[0].id;

    // verify each match belongs to round
    const matchIds = selections.map(s => Number(s.match_id));
    const matchCheck = await client.query(
      `SELECT id FROM jackpot_matches WHERE round_id = $1 AND id = ANY($2::int[])`,
      [roundId, matchIds]
    );
    if (matchCheck.rows.length !== matchIds.length) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "One or more selected matches do not belong to the active round." });
    }

    // lock wallet FOR UPDATE
    const w = await client.query("SELECT balance_kobo FROM wallets WHERE user_id = $1 FOR UPDATE", [userId]);
    if (w.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Wallet not found." });
    }
    const balance = Number(w.rows[0].balance_kobo);
    if (balance < STAKE_KOBO) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Insufficient balance." });
    }

    // deduct wallet
    await client.query("UPDATE wallets SET balance_kobo = balance_kobo - $1, updated_at = NOW() WHERE user_id = $2", [STAKE_KOBO, userId]);

    // wallet txn
    const reference = `jackpot_${Date.now()}`;
    await client.query(`INSERT INTO wallet_txns (user_id, type, amount_kobo, reference, status, created_at) VALUES ($1,'jackpot_bet',$2,$3,'success',NOW())`, [userId, STAKE_KOBO, reference]);

    // create ticket
    const t = await client.query(
      `INSERT INTO jackpot_tickets (user_id, round_id, amount_kobo, stake_kobo, reference, created_at)
       VALUES ($1, $2, $3, $3, $4, NOW()) RETURNING id`,
      [userId, roundId, STAKE_KOBO, reference]
    );
    const ticketId = t.rows[0].id;

    // insert selections parameterized
    const placeholders = [];
    const params = [];
    let idx = 1;
    for (const s of selections) {
      placeholders.push(`($${idx++}, $${idx++}, $${idx++})`);
      params.push(ticketId, Number(s.match_id), String(s.prediction));
    }
    await client.query(`INSERT INTO jackpot_selections (ticket_id, match_id, selection) VALUES ${placeholders.join(",")}`, params);

    await client.query("COMMIT");
    return res.json({ message: "Ticket placed", ticketId, reference });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error POST /api/jackpot/bet", err);
    return res.status(500).json({ error: "Server error placing ticket." });
  } finally {
    client.release();
  }
});

/**
 * GET /api/jackpot/tickets
 * Return all tickets for logged-in user including selections and result flags.
 */
router.get("/tickets", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const q = `
      SELECT t.id, t.round_id, t.amount_kobo, t.stake_kobo, t.reference, t.status, t.created_at,
            COALESCE(json_agg(json_build_object(
              'match_id', s.match_id,
              'selection', s.selection,
              'result', jm.result,
              'is_correct', (s.selection = jm.result)
            ) ORDER BY s.match_id) FILTER (WHERE s.id IS NOT NULL), '[]') as selections
      FROM jackpot_tickets t
      LEFT JOIN jackpot_selections s ON s.ticket_id = t.id
      LEFT JOIN jackpot_matches jm ON jm.id = s.match_id
      WHERE t.user_id = $1
      GROUP BY t.id
      ORDER BY t.created_at DESC
    `;
    const { rows } = await pool.query(q, [userId]);
    const tickets = rows.map(r => ({
      ...r,
      amount_kobo: Number(r.amount_kobo),
      stake_kobo: Number(r.stake_kobo),
      selections: r.selections
    }));
    return res.json({ tickets });
  } catch (err) {
    console.error("Error GET /api/jackpot/tickets", err);
    res.status(500).json({ error: "Server error fetching tickets." });
  }
});

export default router;
