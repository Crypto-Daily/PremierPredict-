// server.js
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import pkg from "pg";
import dotenv from "dotenv";

dotenv.config();
const { Pool } = pkg;

const app = express();
const PORT = process.env.PORT || 10000;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// API route to create ticket
app.post("/api/tickets", async (req, res) => {
  try {
    const { phone, selections, amount } = req.body;

    if (!phone || !selections) {
      return res.status(400).json({ status: "error", message: "Phone and selections are required" });
    }

    // Generate random ticket + reference
    const ticket_id = "TICKET-" + Math.random().toString(36).substr(2, 9).toUpperCase();
    const reference = "REF-" + Date.now();

    const query = `
      INSERT INTO tickets (ticket_id, phone, selections, reference, amount, created_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      RETURNING *;
    `;

    const values = [ticket_id, phone, selections, reference, amount || 100];

    const result = await pool.query(query, values);

    res.json({ status: "success", ticket: result.rows[0] });

  } catch (err) {
    console.error("❌ Ticket creation failed:", err);
    res.status(500).json({ status: "error", message: "Server misconfiguration. Check logs." });
  }
});

// Health check
app.get("/", (req, res) => {
  res.send("✅ PremierPredict API is running");
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
