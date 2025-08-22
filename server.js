const express = require("express");
const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// Home route
app.get("/", (req, res) => {
  res.send("✅ Lottery backend is running!");
});

// Example payment confirmation & ticket generation
app.post("/payment/confirm", (req, res) => {
  const { phoneNumber, amount } = req.body;
  const ticketId = "TICKET-" + Date.now();
  res.json({ success: true, phoneNumber, amount, ticketId });
});

// Start server
app.listen(port, () => {
  console.log(`🎉 Lottery backend running on port ${port}`);
});
