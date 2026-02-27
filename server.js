import { Hono } from "hono";
import "dotenv/config";

import { serve } from "@hono/node-server";
import { cors } from "hono/cors";
import dotenv from "dotenv";
import { connectDB } from "./models/db.js";
import { serveStatic } from "@hono/node-server/serve-static";


import userRoutes from "./routes/user.routes.js";
import applicationRoutes from "./routes/application.routes.js";
import candidatureRoutes from "./routes/candidature.routes.js";
import tenderRouter   from "./routes/tender.routes.js";
import documentRouter from "./routes/document.routes.js";

import passwordRoutes from "./routes/password.routes.js";
import notificationRoutes from "./routes/Notification.routes.js";

dotenv.config();

const app = new Hono();

/* ================== CORS ================== */
app.use("*", cors({
  origin: "http://localhost:3000",
  credentials: true,
  allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
}));

/* ================== DB + INJECTION ================== */
const db = await connectDB();

// ✅ Injecte la DB dans chaque requête Hono
app.use("*", async (c, next) => {
  c.set("db", db);
  await next();
});
app.route("/tenders",   tenderRouter);
app.route("/documents", documentRouter);
/* ================== ROUTES ================== */
app.route("/users", userRoutes);

app.use("/uploads/*", serveStatic({ root: "./" }));
app.route("/candidatures", candidatureRoutes);
app.route("/api", applicationRoutes);
app.route("/notifications", notificationRoutes);

app.route("/password", passwordRoutes);





app.get("/", (c) => c.json({ status: "ok" }));

if (process.env.NODE_ENV !== "test") {
  serve({ fetch: app.fetch, port: process.env.PORT || 5000 });
  console.log(`✅ Server running on port ${process.env.PORT || 5000}`);
}

export default app;