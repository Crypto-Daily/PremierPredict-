// routes/jackpot.js
import express from "express";
import pool from "../db.js";
import { authMiddleware } from "../middleware/authMiddleware.js";

const router = express.Router();
const STAKE_KOBO = 10000; // ₦100 per ticket
const ALLOWED = new Set(["H", "D", "A"]); // DB uses H/D/A

// --- Helpers ---------------------------------------------------------------
async function tableHasColumns(clientOrPool, tableName, cols) {
  const res = await clientOrPool.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_name = $1
       AND column_name = ANY($2::text[])`,
    [tableName, cols]
  );
  return new Set(res.rows.map(r => r.column_name));
}

async function findActiveRound(clientOrPool) {
  // Decide which round columns exist and build an appropriate query
  const cols = await tableHasColumns(clientOrPool, "jackpot_rounds", [
    "status",
    "is_active",
    "start_time",
    "end_time",
    "prize_pool_kobo",
    "created_at",
    "name"
  ]);

  const select = ["id"];
  if (cols.has("name")) select.push("name");
  if (cols.has("prize_pool_kobo")) select.push("prize_pool_kobo");
  if (cols.has("status")) select.push("status");
  if (cols.has("start_time")) select.push("start_time");
  if (cols.has("end_time")) select.push("end_time");

  const whereParts = [];
  if (cols.has("status")) whereParts.push(`status = 'active'`);
  if (cols.has("is_active")) whereParts.push(`is_active = TRUE`);
  if (cols.has("start_time") && cols.has("end_time")) {
    whereParts.push(`start_time <= NOW() AND end_time >= NOW()`);
  }

  const where = whereParts.length ? whereParts.join(" AND ") : "TRUE";
  const orderBy = cols.has("created_at") ? "created_at DESC" : "id DESC";

  const query = `SELECT ${select.join(", ")} FROM jackpot_rounds WHERE ${where} ORDER BY ${orderBy} LIMIT 1`;
  const r = await clientOrPool.query(query);
  return r.rows[0] || null;
}

// --- Routes ---------------------------------------------------------------
/**
 * GET /api/jackpot
 * Return the active round (adaptive to schema) and its matches
 */
router.get("/", authMiddleware, async (req, res) => {
  try {
    const round = await findActiveRound(pool);
    if (!round) return res.json({ message: "No active round" });

    const matchesResult = await pool.query(
      `SELECT id AS match_id, home_team, away_team, match_time, result
       FROM jackpot_matches
       WHERE round_id = $1
       ORDER BY match_time ASC`,
      [round.id]
    );

    return res.json({
      id: round.id,
      name: round.name || null,
      prize_pool_kobo: round.prize_pool_kobo ? Number(round.prize_pool_kobo) : 0,
      status: round.status || (round.is_active ? "active" : undefined),
      start_time: round.start_time || null,
      end_time: round.end_time || null,
      matches: matchesResult.rows
    });
  } catch (err) {
    console.error("❌ Error GET /api/jackpot:", err.stack || err);
    res.status(500).json({ error: "Server error fetching jackpot." });
  }
});

/**
 * POST /api/jackpot/bet
 * Body: { selections: [{ match_id, selection }, ...] }
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
          error: "Each selection must be { match_id, selection } with a valid value (H, D, A)."
        });
      }
    }

    await client.query("BEGIN");

    // find active round (use the client inside the transaction)
    const round = await findActiveRound(client);
    if (!round) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "No active round." });
    }
    const roundId = round.id;

    // validate matches belong to the round
    const matchIds = selections.map(s => Number(s.match_id));
    const matchCheck = await client.query(
      `SELECT id FROM jackpot_matches WHERE round_id = $1 AND id = ANY($2::int[])`,
      [roundId, matchIds]
    );
    if (matchCheck.rows.length !== matchIds.length) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Invalid matches for this round." });
    }

    // lock and check wallet
    const walletRes = await client.query(
      `SELECT balance_kobo FROM wallets WHERE user_id = $1 FOR UPDATE`,
      [userId]
    );
    if (walletRes.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Wallet not found." });
    }
    const balance = Number(walletRes.rows[0].balance_kobo || 0);
    if (balance < STAKE_KOBO) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Insufficient balance." });
    }

    // update wallet — only set updated_at if column exists
    const walletCols = await tableHasColumns(client, "wallets", ["updated_at"]);
    if (walletCols.has("updated_at")) {
      await client.query(
        `UPDATE wallets SET balance_kobo = balance_kobo - $1, updated_at = NOW() WHERE user_id = $2`,
        [STAKE_KOBO, userId]
      );
    } else {
      await client.query(
        `UPDATE wallets SET balance_kobo = balance_kobo - $1 WHERE user_id = $2`,
        [STAKE_KOBO, userId]
      );
    }

    // insert wallet_txn (attempt with common columns)
    await client.query(
      `INSERT INTO wallet_txns (user_id, type, amount_kobo, reference, status, created_at)
       VALUES ($1, 'jackpot_bet', $2, $3, 'success', NOW())`,
      [userId, STAKE_KOBO, `jackpot_${Date.now()}`]
    );

    // create ticket
    const reference = `jackpot_${Date.now()}`;
    const t = await client.query(
      `INSERT INTO jackpot_tickets (user_id, round_id, amount_kobo, stake_kobo, reference, status, created_at)
       VALUES ($1, $2, $3, $4, $5, 'pending', NOW())
       RETURNING id`,
      [userId, roundId, STAKE_KOBO, STAKE_KOBO, reference]
    );
    const ticketId = t.rows[0].id;

    // insert selections
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
    console.error("❌ Error POST /api/jackpot/bet:", (err && err.stack) || err);
    // return more informative message if known (but not internal details)
    res.status(500).json({ error: "Server error placing ticket." });
  } finally {
    client.release();
  }
});

/**
 * GET /api/jackpot/tickets
 * Returns user's tickets and selections
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
    console.error("❌ Error GET /api/jackpot/tickets:", err.stack || err);
    res.status(500).json({ error: "Server error fetching tickets." });
  }
});

export default router;
