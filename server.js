// server.js
import express from "express";
import dotenv from "dotenv";
import cors from "cors";


import authRoutes from "./routes/auth.js";
import walletRoutes from "./routes/wallet.js";
import jackpotRoutes from "./routes/jackpot.js";
import { authMiddleware } from "./middleware/authMiddleware.js";
import dashboardRoutes from "./routes/dashboard.js";

dotenv.config();

const app = express();
// ✅ Middleware
app.use(express.json());

// ✅ Enable CORS for frontend requests
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "*", // 🔒 set FRONTEND_URL in production
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// ✅ Serve static frontend files (like wallet.html)
app.use(express.static("docs"));

// ✅ Routes
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/wallet", walletRoutes);
app.use("/api/jackpot", jackpotRoutes);

// ✅ Health check / protected test route
app.get("/api/protected", authMiddleware, (req, res) => {
  res.json({ message: `Hello ${req.user.id}, you have access!` });
});

// ✅ Catch-all (optional) – useful if serving frontend SPA
app.get("*", (req, res) => {
  res.sendFile("index.html", { root: "docs" });
});

// ✅ Start server
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});

export default app;
