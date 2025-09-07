import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import db from "./db.js";

// Import routes
import authRoutes from "./routes/auth.js";
import walletRoutes from "./routes/wallet.js";
import jackpotRoutes from "./routes/jackpot.js";

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use("/auth", authRoutes);
app.use("/wallet", walletRoutes);
app.use("/jackpot", jackpotRoutes);

// Test route
app.get("/", (req, res) => {
  res.send("🎉 PremierPredict backend is running...");
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
