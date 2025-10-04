// server.js
import express from "express";
import dotenv from "dotenv";
import cors from "cors";

// 🧩 Route imports
import authRoutes from "./routes/auth.js";
import walletRoutes from "./routes/wallet.js";
import jackpotRoutes from "./routes/jackpot.js";
import dashboardRoutes from "./routes/dashboard.js";
import withdrawalsRouter from "./routes/withdrawals.js";
import adminRoutes from "./routes/admin.js";

import { authMiddleware } from "./middleware/authMiddleware.js";

// 🔧 Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

/* -------------------------------------------
   🧰 Middleware Setup
-------------------------------------------- */
app.use(express.json()); // Parse JSON bodies
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "*", // ✅ Allow frontend requests
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

/* -------------------------------------------
   🧭 API Routes
-------------------------------------------- */
app.use("/api/auth", authRoutes);
app.use("/api/wallet", walletRoutes);
app.use("/api/jackpot", jackpotRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/withdrawals", withdrawalsRouter);
app.use("/api/admin", adminRoutes);

/* -------------------------------------------
   🧪 Protected Test Route (optional)
-------------------------------------------- */
app.get("/api/protected", authMiddleware, (req, res) => {
  res.json({ message: `Hello user ${req.user.id}, you have access!` });
});

/* -------------------------------------------
   🗂️ Static Frontend (Serve /docs folder)
-------------------------------------------- */
app.use(express.static("docs"));

/* -------------------------------------------
   ⚠️ Catch-All Route — must come LAST
   (useful for SPA routing or 404 fallback)
-------------------------------------------- */
app.get("*", (req, res) => {
  res.sendFile("index.html", { root: "docs" });
});

/* -------------------------------------------
   🚀 Start Server
-------------------------------------------- */
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});

export default app;
