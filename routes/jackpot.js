import express from "express";
import pool from "../db.js";   // adjust path if needed
import { authMiddleware } from "../middleware/authMiddleware.js";

const router = express.Router();

// ✅ GET current jackpot round
router.get("/", authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, prize_pool_kobo, status, created_at
       FROM jackpot_rounds
       WHERE status = 'active'
       ORDER BY created_at DESC
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

// ✅ POST place a bet
router.post("/bet", authMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    const { amount, choice } = req.body;
    const userId = req.user.id;

    if (!amount || !choice) {
      return res.status(400).json({ error: "Amount and choice are required." });
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

    // 2. Check wallet balance
    const walletRes = await client.query(
      "SELECT balance_kobo FROM wallets WHERE user_id = $1 FOR UPDATE",
      [userId]
    );
    if (walletRes.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Wallet not found." });
    }
    const balance = walletRes.rows[0].balance_kobo;
    if (balance < amount) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Insufficient balance." });
    }

    // 3. Deduct wallet
    await client.query(
      `UPDATE wallets SET balance_kobo = balance_kobo - $1, updated_at = NOW()
       WHERE user_id = $2`,
      [amount, userId]
    );

    // 4. Insert wallet transaction
    const reference = `jackpot_${Date.now()}`;
    await client.query(
      `INSERT INTO wallet_txns (user_id, type, amount_kobo, reference, status, created_at)
       VALUES ($1, 'jackpot_bet', $2, $3, 'success', NOW())`,
      [userId, amount, reference]
    );

    // 5. Insert jackpot bet
    await client.query(
      `INSERT INTO jackpot_bets (user_id, round_id, amount_kobo, choice, reference)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, roundId, amount, choice, reference]
    );

    await client.query("COMMIT");
    res.json({ message: "✅ Bet placed successfully!" });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error placing jackpot bet:", err);
    res.status(500).json({ error: "Server error placing bet." });
  } finally {
    client.release();
  }
});

// ✅ ESM export
export default router;
