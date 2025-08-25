// server.js
import express from "express";
import dotenv from "dotenv";
import pkg from "pg";
import crypto from "crypto";

dotenv.config();
const { Pool } = pkg;

const app = express();
const PORT = process.env.PORT || 10000;

/**
 * Minimal CORS (no 'cors' package needed)
 * - Allow all origins. If you want to restrict, set Access-Control-Allow-Origin to your site.
 */
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*"); // e.g. "https://your-frontend.com"
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-api-key");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Parse JSON bodies
app.use(express.json());

// ---- Database connection ----
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Optional: test connection on boot
pool
  .connect()
  .then((client) => {
    console.log("📦 Connected to PostgreSQL");
    client.release();
  })
  .catch((err) => console.error("❌ Database connection error:", err.message));

// Helper: generate Ticket ID
function generateTicketId() {
  return "TICKET-" + crypto.randomBytes(4).toString("hex").toUpperCase();
}

// Health check
app.get("/", (_req, res) => {
  res.send("✅ PremierPredict API is running");
});

/**
 * Create ticket
 * POST /tickets
 * headers: x-api-key: <your PUBLIC_API_KEY>
 * body: { phone, amount, selections }
 */
app.post("/tickets", async (req, res) => {
  try {
    // API key validation (expecting PUBLIC_API_KEY in Render env vars)
    const clientKey = req.headers["x-api-key"];
    const validKey = process.env.PUBLIC_API_KEY;
    if (!validKey) {
      console.error("⚠️ Missing PUBLIC_API_KEY in environment");
      return res.status(500).json({ error: "Server misconfiguration" });
    }
    if (!clientKey || clientKey !== validKey) {
      return res.status(403).json({ error: "Invalid API key" });
    }

    const { phone, amount, selections } = req.body;

    // Validate phone (NG numbers: +234… or 0… for MTN/Glo/Airtel/9mobile patterns)
    const phoneRegex = /^(?:\+234|0)[789][01]\d{8}$/;
    if (!phone || !phoneRegex.test(phone)) {
      return res.status(400).json({ error: "Invalid Nigerian phone number" });
    }

    // Validate amount
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    // Validate selections: expect 10 picks (0..9)
    if (
      !selections ||
      typeof selections !== "object" ||
      Object.keys(selections).length !== 10
    ) {
      return res
        .status(400)
        .json({ error: "You must make predictions for all 10 matches" });
    }

    // Create ticket
    const ticketId = generateTicketId();
    const reference = "REF_" + crypto.randomBytes(3).toString("hex").toUpperCase();

    // Insert into DB
    const query = `
      INSERT INTO tickets (ticket_id, phone, selections, reference, amount, created_at)
      VALUES ($1, $2, $3::jsonb, $4, $5, NOW())
      RETURNING ticket_id, phone, selections, reference, amount, created_at
    `;
    const values = [ticketId, phone, JSON.stringify(selections), reference, amount];

    const result = await pool.query(query, values);
    const row = result.rows[0];

    return res.json({
      success: true,
      ticket_id: row.ticket_id,
      phone: row.phone,
      selections: row.selections,
      reference: row.reference,
      amount: row.amount,
      created_at: row.created_at,
    });
  } catch (err) {
    console.error("❌ /tickets error:", err);
    return res.status(500).json({ error: "Server error. Please try again." });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
