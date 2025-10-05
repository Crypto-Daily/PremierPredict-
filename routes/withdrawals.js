// routes/withdrawals.js
import express from "express";
import pool from "../db.js";
import { authMiddleware } from "../middleware/authMiddleware.js";

const router = express.Router();

/* ============================================================
   🔐 ADMIN MIDDLEWARE
============================================================ */
async function adminMiddleware(req, res, next) {
  if (!req.user?.is_admin) {
    return res.status(403).json({ error: "Access denied. Admins only." });
  }
  next();
}

/* ============================================================
   💸 USER: Create Withdrawal Request
============================================================ */
router.post("/", authMiddleware, async (req, res) => {
  const { amount, bank_name, account_number } = req.body;
  const userId = req.user.id;

  try {
    const { rows: [wallet] } = await pool.query(
      "SELECT balance_kobo FROM wallets WHERE user_id = $1",
      [userId]
    );

    const amount_kobo = Math.round(amount * 100);

    if (!wallet || wallet.balance_kobo < amount_kobo) {
      return res.status(400).json({ error: "Insufficient balance" });
    }

    // Create withdrawal request
    const { rows: [withdrawal] } = await pool.query(
      `INSERT INTO withdrawals (user_id, amount_kobo, bank_name, account_number)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [userId, amount_kobo, bank_name, account_number]
    );

    // Deduct from wallet
    await pool.query(
      "UPDATE wallets SET balance_kobo = balance_kobo - $1 WHERE user_id = $2",
      [amount_kobo, userId]
    );

    res.json({ message: "Withdrawal request submitted", withdrawal });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ============================================================
   💼 ADMIN: View All Withdrawal Requests
============================================================ */
router.get("/admin", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT w.id, u.username, w.bank_name, w.account_number, 
             w.amount_kobo, w.status, w.created_at
      FROM withdrawals w
      JOIN users u ON u.id = w.user_id
      ORDER BY w.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error fetching withdrawals" });
  }
});

/* ============================================================
   ✅ ADMIN: Approve Withdrawal
============================================================ */
router.post("/:id/approve", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(
      "UPDATE withdrawals SET status = 'paid', updated_at = NOW() WHERE id = $1 RETURNING *",
      [id]
    );
    res.json({ message: "Withdrawal marked as paid", withdrawal: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error approving withdrawal" });
  }
});

/* ============================================================
   ❌ ADMIN: Reject (Refund) Withdrawal
============================================================ */
router.post("/:id/reject", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    // Fetch withdrawal
    const { rows: [withdrawal] } = await pool.query(
      "SELECT user_id, amount_kobo FROM withdrawals WHERE id = $1",
      [id]
    );

    if (withdrawal) {
      // Refund user
      await pool.query(
        "UPDATE wallets SET balance_kobo = balance_kobo + $1 WHERE user_id = $2",
        [withdrawal.amount_kobo, withdrawal.user_id]
      );
    }

    const { rows } = await pool.query(
      "UPDATE withdrawals SET status = 'rejected', updated_at = NOW() WHERE id = $1 RETURNING *",
      [id]
    );

    res.json({ message: "Withdrawal rejected and refunded", withdrawal: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error rejecting withdrawal" });
  }
});

/* ============================================================
   📜 USER: Withdrawal History
============================================================ */
router.get("/history", authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, amount_kobo, bank_name, account_number, status, created_at
       FROM withdrawals
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch history" });
  }
});

/* ============================================================
   ⚽ ADMIN: JACKPOT MANAGEMENT
============================================================ */

// --- Create New Round ---
router.post("/rounds", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { name, start_time, end_time } = req.body;
    const result = await pool.query(
      `INSERT INTO jackpot_rounds (name, start_time, end_time, status, is_active)
       VALUES ($1, $2, $3, 'active', true)
       RETURNING *`,
      [name, start_time, end_time]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error creating round" });
  }
});

// --- Update Match Results ---
router.post("/results/:roundId", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { roundId } = req.params;
    const { results } = req.body; // [{match_id, result}, ...]

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const r of results) {
        await client.query(
          `UPDATE jackpot_matches SET result = $1 WHERE id = $2 AND round_id = $3`,
          [r.result, r.match_id, roundId]
        );
      }
      await client.query("COMMIT");
      res.json({ success: true });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error updating results" });
  }
});

// --- List All Tickets ---
router.get("/tickets", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT t.id, u.username, r.name AS round_name, t.created_at,
             CASE
               WHEN r.status = 'completed' THEN 'won'
               ELSE 'pending'
             END AS ticket_status
      FROM jackpot_tickets t
      JOIN users u ON u.id = t.user_id
      JOIN jackpot_rounds r ON r.id = t.round_id
      ORDER BY t.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error fetching tickets" });
  }
});

export default router;
