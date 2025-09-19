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
    res.status(500).json({
      error: "Server error fetching jackpot.",
      details: err.message,
    });
  }
});

/**
 * POST /api/jackpot/bet
 * Body: { selections: [{ match_id: 1, prediction: "home_win" }, ...] }
 * Deducts wallet balance, creates ticket, and stores selections.
 */
router.post("/bet", authMiddleware, async (req, res) => {
  const client = await pool.connect();

  try {
    const { selections } = req.body;
    const userId = req.user.id;

    // 🔹 Validate selections
    if (!Array.isArray(selections) || selections.length !== 10) {
      return res.status(400).json({
        error: "You must provide exactly 10 selections.",
      });
    }

    for (const s of selections) {
      if (
        !s ||
        !s.match_id ||
        !s.prediction ||
        !ALLOWED_PREDICTIONS.has(String(s.prediction))
      ) {
        return res.status(400).json({
          error: "Invalid selection format. Use { match_id, prediction } with valid prediction.",
        });
      }
    }

    await client.query("BEGIN");

    // 🔹 Active round
    const roundRes = await client.query(
      `SELECT id FROM jackpot_rounds WHERE status = 'active' ORDER BY created_at DESC LIMIT 1`
    );
    if (roundRes.rows.length === 0) {
      throw new Error("No active jackpot round.");
    }
    const roundId = roundRes.rows[0].id;

    // 🔹 Validate matches belong to round
    const matchIds = selections.map((s) => Number(s.match_id));
    const matchCheck = await client.query(
      `SELECT id FROM jackpot_matches WHERE round_id = $1 AND id = ANY($2::int[])`,
      [roundId, matchIds]
    );
    if (matchCheck.rows.length !== matchIds.length) {
      throw new Error("One or more selected matches are invalid for this round.");
    }

    // 🔹 Check wallet balance
    const walletRes = await client.query(
      "SELECT balance_kobo FROM wallets WHERE user_id = $1 FOR UPDATE",
      [userId]
    );
    if (walletRes.rows.length === 0) {
      throw new Error("Wallet not found.");
    }
    const balance = Number(walletRes.rows[0].balance_kobo);
    if (balance < STAKE_KOBO) {
      throw new Error("Insufficient balance.");
    }

    // 🔹 Deduct wallet
    await client.query(
      `UPDATE wallets
       SET balance_kobo = balance_kobo - $1, updated_at = NOW()
       WHERE user_id = $2`,
      [STAKE_KOBO, userId]
    );

    // 🔹 Insert wallet transaction
    const reference = `jackpot_${Date.now()}`;
    await client.query(
      `INSERT INTO wallet_txns (user_id, type, amount_kobo, reference, status, created_at)
       VALUES ($1, 'jackpot_bet', $2, $3, 'success', NOW())`,
      [userId, STAKE_KOBO, reference]
    );

    // 🔹 Create ticket
    const ticketRes = await client.query(
      `INSERT INTO jackpot_tickets (user_id, round_id, amount_kobo, stake_kobo, reference, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       RETURNING id`,
      [userId, roundId, STAKE_KOBO, STAKE_KOBO, reference]
    );
    const ticketId = ticketRes.rows[0].id;

    // 🔹 Insert selections
    const values = [];
    const params = [];
    let idx = 1;
    for (const s of selections) {
      values.push(`($${idx++}, $${idx++}, $${idx++})`);
      params.push(ticketId, Number(s.match_id), String(s.prediction));
    }
    await client.query(
      `INSERT INTO jackpot_selections (ticket_id, match_id, selection)
       VALUES ${values.join(",")}`,
      params
    );

    await client.query("COMMIT");

    return res.json({
      message: "✅ Ticket placed successfully!",
      ticketId,
      reference,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error placing jackpot ticket:", err);
    return res.status(500).json({
      error: "Server error placing ticket.",
      details: err.message,
    });
  } finally {
    client.release();
  }
});

/**
 * GET /api/jackpot/tickets/:ticketId/results
 * Shows selections, results, and summary.
 */
router.get("/tickets/:ticketId/results", authMiddleware, async (req, res) => {
  try {
    const ticketId = Number(req.params.ticketId);

    if (!Number.isInteger(ticketId)) {
      return res.status(400).json({ error: "Invalid ticketId." });
    }

    const selectionsQuery = `
      SELECT s.match_id, s.selection, m.result, (s.selection = m.result) AS is_correct
      FROM jackpot_selections s
      JOIN jackpot_matches m ON s.match_id = m.id
      WHERE s.ticket_id = $1
      ORDER BY s.match_id;
    `;

    const statusQuery = `
      SELECT
        COUNT(*) FILTER (WHERE s.selection = m.result) AS correct_count,
        CASE WHEN COUNT(*) FILTER (WHERE s.selection = m.result) = 10
             THEN 'WINNER'
             ELSE 'LOSER'
        END AS ticket_status
      FROM jackpot_selections s
      JOIN jackpot_matches m ON s.match_id = m.id
      WHERE s.ticket_id = $1
      GROUP BY s.ticket_id;
    `;

    const selections = await pool.query(selectionsQuery, [ticketId]);
    const status = await pool.query(statusQuery, [ticketId]);

    return res.json({
      ticketId,
      selections: selections.rows,
      summary: status.rows[0] || { ticket_status: "NOT_FOUND", correct_count: 0 },
    });
  } catch (err) {
    console.error("❌ Error fetching ticket results:", err);
    return res.status(500).json({
      error: "Server error fetching results.",
      details: err.message,
    });
  }
});

export default router;
