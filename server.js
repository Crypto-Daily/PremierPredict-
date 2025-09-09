// server.js
import express from "express";
import dotenv from "dotenv";
import authRoutes from "./routes/auth.js";
import walletRoutes from "./routes/wallet.js";
import jackpotRoutes from "./routes/jackpot.js";
import { authMiddleware } from "./middleware/authMiddleware.js";

dotenv.config();
app.use(express.json());

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/wallet", walletRoutes);
app.use("/api/jackpot", jackpotRoutes);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});

const app = express();

app.get("/api/protected", authMiddleware, (req, res) => {
  res.json({ message: `Hello ${req.user.id}, you have access!` });
});

export default app;
