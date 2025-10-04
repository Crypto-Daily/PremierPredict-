// routes/admin.js
import express from "express";
import pool from "../db.js";
const router = express.Router();

/* 1️⃣ Create new round */
router.post("/rounds", async (req, res) => {
  const { name } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO jackpot_rounds (name, is_active) VALUES ($1, false) RETURNING *`,
      [name]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: "Error creating round" });
  }
});

/* 1️⃣ Mark round active */
router.post("/rounds/:id/activate", async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query(`UPDATE jackpot_rounds SET is_active = false`);
    const { rows } = await pool.query(
      `UPDATE jackpot_rounds SET is_active = true WHERE id = $1 RETURNING *`,
      [id]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: "Error activating round" });
  }
});

/* 2️⃣ Update round results */
router.post("/rounds/:id/results", async (req, res) => {
  const { id } = req.params;
  const { results } = req.body; // e.g. array of [{match_id, outcome}]
  try {
    for (const r of results) {
      await pool.query(
        `UPDATE jackpot_matches SET result = $1 WHERE id = $2 AND round_id = $3`,
        [r.outcome, r.match_id, id]
      );
    }
    res.json({ message: "Results updated" });
  } catch (err) {
    res.status(500).json({ error: "Error updating results" });
  }
});

/* 3️⃣ Pending & won tickets */
router.get("/tickets", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT t.id, u.username, t.round_id, t.predictions, t.status, t.created_at
      FROM jackpot_tickets t
      JOIN users u ON u.id = t.user_id
      WHERE t.status IN ('pending','won')
      ORDER BY t.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Error fetching tickets" });
  }
});

/* 4️⃣ Adjust user wallet */
router.post("/users/:id/balance", async (req, res) => {
  const { id } = req.params;
  const { amount } = req.body; // positive or negative (in naira)
  try {
    const amount_kobo = Math.round(amount * 100);
    await pool.query(
      `UPDATE wallets SET balance_kobo = balance_kobo + $1 WHERE user_id = $2`,
      [amount_kobo, id]
    );
    res.json({ message: `User balance updated by ₦${amount}` });
  } catch (err) {
    res.status(500).json({ error: "Error updating balance" });
  }
});

export default router;
