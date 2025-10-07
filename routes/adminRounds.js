// routes/adminRounds.js
import express from "express";
import pool from "../db.js";

const router = express.Router();

// --- Get all jackpot rounds
router.get("/rounds", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name, is_active, start_time, end_time, created_at
      FROM jackpot_rounds
      ORDER BY id DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error fetching rounds" });
  }
});

export default router;
