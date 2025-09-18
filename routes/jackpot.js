import express from "express";
import pool from "../db.js";   // adjust path if needed
import { authMiddleware } from "../middleware/authMiddleware.js";

const router = express.Router();

/**
 * ✅ GET current active jackpot round with matches
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
                    'match_time', jm.match_time
                  )
                  ORDER BY jm.match_time
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

    res.json(rows[0]);
  } catch (err) {
    console.error("Error fetching jackpot:", err);
    res.status(500).json({ error: "Server error fetching jackpot." });
  }
});

/**
 * ✅ POST place a jackpot ticket with selections
 * Body: { selections: [{ match_id: 1, prediction: "home_win" }, ...10] }
 */
router.post("/bet", authMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    const { selections } = req.body;
    const userId = req.user.id;

    if (!selections || selections.length !== 10) {
      return res.status(400).json({ error: "You must provide exactly 10 selections." });
    }

    await client.query("BEGIN");

    // 1. Get active round
    const roundRes = await client.query(
      `SELECT id FROM jackpot_rounds WHERE status = 'active' ORDER BY created_at DESC LIMIT 1`
    );
    if (roundRes.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "No active jackpot round." });
    }
    const roundId = roundRes.rows[0].id;

    // 2. Check wallet balance (fixed stake ₦100 = 10000 kobo)
    const STAKE_KOBO = 10000;
    const walletRes = await client.query(
      "SELECT balance_kobo FROM wallets WHERE user_id = $1 FOR UPDATE",
      [userId]
    );
    if (walletRes.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Wallet not found." });
    }
    const balance = walletRes.rows[0].balance_kobo;
    if (balance < STAKE_KOBO) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Insufficient balance." });
    }

    // 3. Deduct wallet
    await client.query(
      `UPDATE wallets
       SET balance_kobo = balance_kobo - $1, updated_at = NOW()
       WHERE user_id = $2`,
      [STAKE_KOBO, userId]
    );

    // 4. Insert wallet transaction
    const reference = `jackpot_${Date.now()}`;
    await client.query(
      `INSERT INTO wallet_txns (user_id, type, amount_kobo, reference, status, created_at)
       VALUES ($1, 'jackpot_bet', $2, $3, 'success', NOW())`,
      [userId, STAKE_KOBO, reference]
    );

    // 5. Insert ticket
    const ticketRes = await client.query(
      `INSERT INTO jackpot_tickets (user_id, round_id, amount_kobo, stake_kobo, reference)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [userId, roundId, STAKE_KOBO, STAKE_KOBO, reference]
    );
    const ticketId = ticketRes.rows[0].id;

    // 6. Insert 10 selections
    const insertValues = selections.map(
      (sel, i) =>
        `(${ticketId}, ${sel.match_id}, '${sel.prediction}')`
    ).join(",");

    await client.query(
      `INSERT INTO jackpot_selections (ticket_id, match_id, selection)
       VALUES ${insertValues}`
    );

    await client.query("COMMIT");
    res.json({ message: "✅ Ticket placed successfully!", ticketId, reference });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error placing jackpot ticket:", err);
    res.status(500).json({ error: "Server error placing ticket." });
  } finally {
    client.release();
  }
});

/**
 * ✅ GET ticket results
 */
router.get("/tickets/:ticketId/results", authMiddleware, async (req, res) => {
  try {
    const { ticketId } = req.params;

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

    res.json({
      ticketId,
      selections: selections.rows,
      summary: status.rows[0] || { ticket_status: "NOT_FOUND" }
    });
  } catch (err) {
    console.error("Error fetching ticket results:", err);
    res.status(500).json({ error: "Server error fetching results." });
  }
});

// ✅ ESM export
export default router;
