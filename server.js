import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import dotenv from "dotenv";
import pkg from "pg";
import crypto from "crypto";

dotenv.config();
const { Pool } = pkg;

const app = express();
const PORT = process.env.PORT || 10000;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Postgres connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Helper: generate Ticket ID
function generateTicketId() {
  return "TICKET-" + crypto.randomBytes(4).toString("hex").toUpperCase();
}

// ✅ API route to create ticket
app.post("/tickets", async (req, res) => {
  try {
    const apiKey = req.headers["x-api-key"];
    if (apiKey !== process.env.API_KEY) {
      return res.status(403).json({ error: "Invalid API key" });
    }

    const { phone, amount, selections } = req.body;

    // ✅ Validation
    const phoneRegex = /^(?:\+234|0)[789][01]\d{8}$/;
    if (!phone || !phoneRegex.test(phone)) {
      return res.status(400).json({ error: "Invalid Nigerian phone number" });
    }
    if (!amount || isNaN(amount) || amount <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }
    if (!selections || Object.keys(selections).length !== 10) {
      return res.status(400).json({ error: "You must make predictions for all matches" });
    }

    const ticketId = generateTicketId();
    const reference = "REF_" + crypto.randomBytes(3).toString("hex").toUpperCase();

    const result = await pool.query(
      `INSERT INTO tickets (ticket_id, phone, selections, reference, amount, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING *`,
      [ticketId, phone, selections, reference, amount]
    );

    return res.json({
      success: true,
      ticket_id: ticketId,
      reference,
      amount,
      phone,
      created_at: result.rows[0].created_at
    });

  } catch (err) {
    console.error("❌ Server error:", err);
    res.status(500).json({ error: "Server error. Please try again later." });
  }
});

// Health check
app.get("/", (req, res) => {
  res.send("✅ PremierPredict API is running");
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
