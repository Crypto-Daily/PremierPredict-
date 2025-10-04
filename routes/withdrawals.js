// routes/withdrawals.js
import express from "express";
import pool from "../db.js";
import { authMiddleware } from "../middleware/authMiddleware.js";

const router = express.Router();

/* -------------------------------------------
   1️⃣  USER: Create Withdrawal Request
-------------------------------------------- */
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

    // Temporarily deduct balance
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

/* -------------------------------------------
   2️⃣  ADMIN: View All Requests
-------------------------------------------- */
router.get("/admin", async (req, res) => {
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

/* -------------------------------------------
   3️⃣  ADMIN: Approve Request
-------------------------------------------- */
router.post("/:id/approve", async (req, res) => {
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

/* -------------------------------------------
   4️⃣  ADMIN: Reject Request (Refund)
-------------------------------------------- */
router.post("/:id/reject", async (req, res) => {
  try {
    const { id } = req.params;

    // Fetch withdrawal info
    const { rows: [withdrawal] } = await pool.query(
      "SELECT user_id, amount_kobo FROM withdrawals WHERE id = $1",
      [id]
    );

    if (withdrawal) {
      // Refund the user’s wallet
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

export default router;
