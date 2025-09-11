// server.js
import express from "express";
import dotenv from "dotenv";
import cors from "cors";   // ✅ import cors
import authRoutes from "./routes/auth.js";
import walletRoutes from "./routes/wallet.js";
import jackpotRoutes from "./routes/jackpot.js";
import { authMiddleware } from "./middleware/authMiddleware.js";

dotenv.config();

const app = express();

// ✅ Enable CORS for frontend requests
app.use(cors({
  origin: "*",            // allow all origins (you can restrict later to your domain)
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json());

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/wallet", walletRoutes);
app.use("/api/jackpot", jackpotRoutes);

// Test protected route
app.get("/api/protected", authMiddleware, (req, res) => {
  res.json({ message: `Hello ${req.user.id}, you have access!` });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});

export default app;
