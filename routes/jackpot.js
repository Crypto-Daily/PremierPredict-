// routes/jackpot.js
import express from "express";
import pool from "../db.js";
import { authMiddleware } from "../middleware/authMiddleware.js";

const router = express.Router();

// Join jackpot with predictions
router.post("/join", authMiddleware, async (req, res) => {
  try {
    const { predictions } = req.body; // should be array of 10 match predictions
    if (!predictions || predictions.length !== 10) {
      return res.status(400).json({ error: "You must provide 10 predictions" });
    }

    const { rows } = await pool.query(
      "INSERT INTO jackpots (user_id, predictions) VALUES ($1, $2) RETURNING *",
      [req.user.id, predictions]
    );

    res.json({ message: "Joined jackpot successfully", jackpot: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get my jackpot history
router.get("/history", authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM jackpots WHERE user_id = $1", [req.user.id]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
    res.json({ bet: bet.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
