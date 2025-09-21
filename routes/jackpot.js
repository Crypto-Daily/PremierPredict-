// routes/jackpot.js
import express from "express";
import pool from "../db.js";
import { authMiddleware } from "../middleware/authMiddleware.js";

const router = express.Router();
const STAKE_KOBO = 10000; // ₦100 stake
const ALLOWED = new Set(["home_win", "draw", "away_win"]);

/**
 * GET /api/jackpot
 * Fetch the current active jackpot round and its matches
 */
router.get("/", authMiddleware, async (req, res) => {
  try {
    const roundResult = await pool.query(
      `SELECT id, name, prize_pool_kobo, status, start_time, end_time
       FROM jackpot_rounds
       WHERE status = 'active'
       AND start_time <= NOW()
       AND end_time >= NOW()
       ORDER BY created_at DESC
       LIMIT 1`
    );

    if (roundResult.rows.length === 0) {
      return res.json({ message: "No active round" });
    }

    const round = roundResult.rows[0];

    const matchesResult = await pool.query(
      `SELECT id AS match_id, home_team, away_team, match_time, result
       FROM jackpot_matches
       WHERE round_id = $1
       ORDER BY match_time ASC`,
      [round.id]
    );

    res.json({
      id: round.id,
      name: round.name,
      prize_pool_kobo: Number(round.prize_pool_kobo),
      status: round.status,
      start_time: round.start_time,
      end_time: round.end_time,
      matches: matchesResult.rows
    });
  } catch (err) {
    console.error("❌ Error GET /api/jackpot:", err);
    res.status(500).json({ error: "Server error fetching jackpot." });
  }
});

/**
 * POST /api/jackpot/bet
 */
router.post("/bet", authMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    const userId = req.user.id;
    const { selections } = req.body;

    if (!Array.isArray(selections) || selections.length !== 10) {
      return res.status(400).json({ error: "Provide exactly 10 selections." });
    }

    for (const s of selections) {
      if (!s || !s.match_id || !s.selection || !ALLOWED.has(s.selection)) {
        return res.status(400).json({
          error: "Each selection must be { match_id, selection } with a valid selection."
        });
      }
    }

    await client.query("BEGIN");

    // active round
    const r = await client.query(
      `SELECT id FROM jackpot_rounds
       WHERE status = 'active'
       AND start_time <= NOW()
       AND end_time >= NOW()
       ORDER BY created_at DESC
       LIMIT 1`
    );
    if (r.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "No active round." });
    }
    const roundId = r.rows[0].id;

    // match validation
    const matchIds = selections.map(s => Number(s.match_id));
    const matchCheck = await client.query(
      "SELECT id FROM jackpot_matches WHERE round_id = $1 AND id = ANY($2::int[])",
      [roundId, matchIds]
    );
    if (matchCheck.rows.length !== matchIds.length) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Invalid matches for this round." });
    }

    // wallet check
    const w = await client.query(
      "SELECT balance_kobo FROM wallets WHERE user_id = $1 FOR UPDATE",
      [userId]
    );
    if (w.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Wallet not found." });
    }
    if (Number(w.rows[0].balance_kobo) < STAKE_KOBO) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Insufficient balance." });
    }

    // deduct
    await client.query(
      "UPDATE wallets SET balance_kobo = balance_kobo - $1, updated_at = NOW() WHERE user_id = $2",
      [STAKE_KOBO, userId]
    );

    // wallet txn
    const reference = `jackpot_${Date.now()}`;
    await client.query(
      `INSERT INTO wallet_txns (user_id, type, amount_kobo, reference, status, created_at)
       VALUES ($1, 'jackpot_bet', $2, $3, 'success', NOW())`,
      [userId, STAKE_KOBO, reference]
    );

    // ticket
    const t = await client.query(
      `INSERT INTO jackpot_tickets (user_id, round_id, amount_kobo, stake_kobo, reference, status, created_at)
       VALUES ($1, $2, $3, $4, $5, 'pending', NOW())
       RETURNING id`,
      [userId, roundId, STAKE_KOBO, STAKE_KOBO, reference]
    );
    const ticketId = t.rows[0].id;

    // selections
    const placeholders = [];
    const params = [];
    let idx = 1;
    for (const s of selections) {
      placeholders.push(`($${idx++}, $${idx++}, $${idx++})`);
      params.push(ticketId, s.match_id, s.selection);
    }
    await client.query(
      `INSERT INTO jackpot_ticket_selections (ticket_id, match_id, selection) VALUES ${placeholders.join(",")}`,
      params
    );

    await client.query("COMMIT");

    res.json({ message: "Ticket placed successfully", ticketId, reference });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error POST /api/jackpot/bet:", err);
    res.status(500).json({ error: "Server error placing ticket." });
  } finally {
    client.release();
  }
});

/**
 * GET /api/jackpot/tickets
 */
router.get("/tickets", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const q = `
      SELECT t.id, t.round_id, t.amount_kobo, t.stake_kobo, t.reference, t.status, t.created_at,
             COALESCE(
               json_agg(
                 json_build_object(
                   'match_id', s.match_id,
                   'selection', s.selection,
                   'result', jm.result,
                   'is_correct', (s.selection = jm.result)
                 ) ORDER BY s.match_id
               ) FILTER (WHERE s.match_id IS NOT NULL), '[]'
             ) AS selections
      FROM jackpot_tickets t
      LEFT JOIN jackpot_ticket_selections s ON s.ticket_id = t.id
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

    res.json({ tickets });
  } catch (err) {
    console.error("❌ Error GET /api/jackpot/tickets:", err);
    res.status(500).json({ error: "Server error fetching tickets." });
  }
});

export default router;
