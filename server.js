import express from "express";
import bodyParser from "body-parser";
import crypto from "crypto";
import pkg from "pg";
const { Pool } = pkg;

const app = express();
app.use(bodyParser.json());

// PostgreSQL connection (Render provides DATABASE_URL)
const pool = new Pool({
  connectionString: "postgresql://premierpredict_user:scdeLsN9rmFEbBxVPOVffIcQTOblozia@dpg-d2kth5ruibrs73ekv59g-a.frankfurt-postgres.render.com/premierpredict",
  ssl: { rejectUnauthorized: false },
});

// ✅ Create table if not exists
const initDB = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS payments (
      id SERIAL PRIMARY KEY,
      phone_number VARCHAR(20),
      amount BIGINT,
      ticket_id VARCHAR(100) UNIQUE,
      ticket_password VARCHAR(100),
      selected_games JSONB,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
};
initDB();

// ✅ Paystack Webhook
app.post("/paystack/webhook", async (req, res) => {
  try {
    // 1. Verify Paystack Signature
    const hash = crypto
      .createHmac("sha512", process.env.sk_live_e854f1ee1be98bd733b97e187aa11f664dd04fc6)
      .update(JSON.stringify(req.body))
      .digest("hex");

    if (hash !== req.headers["x-paystack-signature"]) {
      return res.status(401).send("Invalid signature");
    }

    // 2. Process payment
    const event = req.body;
    if (event.event === "charge.success") {
      const { customer, amount, metadata } = event.data;

      // Metadata can hold extra fields like selected games
      const selectedGames = metadata?.selectedGames || [];
      const phoneNumber = customer.phone || "unknown";

      // 3. Generate unique ticket & password
      const ticketId = "TICKET-" + Date.now().toString(36);
      const ticketPassword = crypto.randomBytes(4).toString("hex");

      // 4. Save to DB
      await pool.query(
        "INSERT INTO payments (phone_number, amount, ticket_id, ticket_password, selected_games) VALUES ($1, $2, $3, $4, $5)",
        [phoneNumber, amount, ticketId, ticketPassword, JSON.stringify(selectedGames)]
      );

      console.log(
        `✅ Payment saved | Phone: ${phoneNumber} | Ticket: ${ticketId} | Games: ${JSON.stringify(
          selectedGames
        )}`
      );
    }

    res.sendStatus(200); // Always acknowledge
  } catch (error) {
    console.error("Webhook Error:", error);
    res.sendStatus(500);
  }
});

// ✅ Root route for testing
app.get("/", (req, res) => {
  res.send("🎉 PremierPredict Backend is Live!");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
