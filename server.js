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

// ✅ Create payment
app.post("/create-payment", async (req, res) => {
  try {
    const { phone, match } = req.body;

    const response = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: 10000, // ₦100
        email: `${phone}@premierpredict.com`,
        callback_url: `${process.env.SERVER_URL}/verify-payment?match=${encodeURIComponent(match)}&phone=${phone}`,
      }),
    });

    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error("Payment Init Error:", err);
    res.status(500).json({ error: "Payment initialization failed" });
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
