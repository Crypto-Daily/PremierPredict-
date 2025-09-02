import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import fetch from "node-fetch";
import dotenv from "dotenv";
import fs from "fs";

dotenv.config();

const app = express();
app.use(cors());
app.use(bodyParser.json());

// database file
const DB_FILE = "./tickets.json";

// Load tickets
function loadTickets() {
  if (!fs.existsSync(DB_FILE)) return [];
  return JSON.parse(fs.readFileSync(DB_FILE));
}

// Save tickets
function saveTickets(tickets) {
  fs.writeFileSync(DB_FILE, JSON.stringify(tickets, null, 2));
}

// ✅ Create Paystack payment (robust + verbose logging)
app.post("/create-payment", async (req, res) => {
  try {
    const { phone, selections } = req.body || {};
    console.log("📩 /create-payment body:", JSON.stringify(req.body).slice(0, 400));

    // Make sure the key is present
    if (!process.env.PAYSTACK_SECRET_KEY) {
      console.error("❌ Missing PAYSTACK_SECRET_KEY env");
      return res.status(500).json({ error: "Server misconfiguration" });
    }

    // Accept selections as object/array OR JSON string
    let parsedSelections = selections;
    if (typeof parsedSelections === "string") {
      try {
        parsedSelections = JSON.parse(parsedSelections);
      } catch {
        console.warn("⚠️ selections is a string but not valid JSON");
      }
    }

    const hasSelections =
      (Array.isArray(parsedSelections) && parsedSelections.length > 0) ||
      (parsedSelections && typeof parsedSelections === "object" && Object.keys(parsedSelections).length > 0);

    if (!phone || !hasSelections) {
      console.error("❌ Validation failed: phone or selections missing/empty");
      return res.status(400).json({ error: "Phone number and selections are required" });
    }

    const amount = 100 * 100; // ₦100 in kobo
    const ticketId = generateTicketId();

    const initPayload = {
      email: `${String(phone).replace(/\D/g, "")}@premierpredict.com`, // meets Paystack email requirement
      amount,
      // keep your original success page flow (unchanged)
      callback_url: `https://crypto-daily.github.io/PremierPredict-/success.html?ticket=${ticketId}`,
      metadata: { phone, selections: parsedSelections, ticketId },
    };

    const psRes = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(initPayload),
    });

    const data = await psRes.json();
    console.log("↩️ Paystack init:", data.status, data.message, data?.data && { ref: data.data.reference });

    if (!data.status) {
      // Most common cases: bad/empty key, wrong environment, or malformed payload
      return res.status(400).json({ error: data.message || "Paystack error" });
    }

    // Frontend should redirect to this URL
    return res.json({
      url: data.data.authorization_url,
      reference: data.data.reference,
      ticketId,
    });
  } catch (error) {
    console.error("❌ Payment creation error:", error);
    return res.status(500).json({ error: "Server error creating payment" });
  }
});
// ✅ Verify payment
app.get("/verify-payment", async (req, res) => {
  try {
    const { reference, match, phone } = req.query;

    const response = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      },
    });

    const data = await response.json();

    if (data.status && data.data.status === "success") {
      // generate ticket id
      const ticketId = "PRE" + Math.floor(10000000 + Math.random() * 90000000);

      // save to db
      const tickets = loadTickets();
      tickets.push({ ticketId, phone, match, date: new Date().toISOString() });
      saveTickets(tickets);

      // redirect to success page
      res.redirect(`https://crypto-daily.github.io/PremierPredict-/success.html?ticket=${ticketId}`);
    } else {
      res.redirect("https://crypto-daily.github.io/PremierPredict-/failed.html");
    }
  } catch (err) {
    console.error("Verify Error:", err);
    res.redirect("https://crypto-daily.github.io/PremierPredict-/failed.html");
  }
});

// ✅ View all tickets
app.get("/tickets", (req, res) => {
  res.json(loadTickets());
});

// ✅ Get one ticket
app.get("/tickets/:id", (req, res) => {
  const tickets = loadTickets();
  const ticket = tickets.find(t => t.ticketId === req.params.id);
  if (ticket) {
    res.json(ticket);
  } else {
    res.status(404).json({ error: "Ticket not found" });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
