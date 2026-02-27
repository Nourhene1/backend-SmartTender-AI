import { Hono } from "hono";
import "dotenv/config";

import { serve } from "@hono/node-server";
import { cors } from "hono/cors";
import dotenv from "dotenv";
import { connectDB } from "./models/db.js";
import { serveStatic } from "@hono/node-server/serve-static";


import userRoutes from "./routes/user.routes.js";
import jobRoutes from "./routes/job.routes.js";
import applicationRoutes from "./routes/application.routes.js";
import candidatureRoutes from "./routes/candidature.routes.js";
import RolesRoutes from "./routes/role.routes.js";
import ficheRoutes from "./routes/fiche.routes.js";
import ficheSubmissionRoutes from "./routes/ficheSubmission.routes.js";
import interviewRoutes from "./routes/interview.routes.js";
import quizRoutes from "./routes/quiz.routes.js";
import passwordRoutes from "./routes/password.routes.js";
import notificationRoutes from "./routes/Notification.routes.js";
import authMicrosoftRouter from "./routes/Authmicrosoft.route.js";
import calendarRouter from "./routes/calendar.routes.js";
import quizSubmissionRoutes from "./routes/Quizsubmission.routes.js";
import linkedinRoutes from "./routes/linkedin.routes.js";
import { startReminderCron } from "./jobs/reminder-cron.js";

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
startReminderCron(db);
/* ================== ROUTES ================== */
app.route("/users", userRoutes);
app.route("/jobs", jobRoutes);
app.route("/fiches", ficheRoutes);
app.route("/api/interviews", interviewRoutes);
app.use("/uploads/*", serveStatic({ root: "./" }));
app.route("/fiche-submissions", ficheSubmissionRoutes);
app.route("/candidatures", candidatureRoutes);
app.route("/api", applicationRoutes);
app.route("/roles", RolesRoutes);
app.route("/notifications", notificationRoutes);
app.route("/quizzes", quizRoutes);
app.route("/password", passwordRoutes);
app.route("/quiz-submissions", quizSubmissionRoutes);

app.route("/api/auth/microsoft", authMicrosoftRouter);
app.route("/api/calendar", calendarRouter);
app.route("/linkedin", linkedinRoutes);


app.get("/", (c) => c.json({ status: "ok" }));

if (process.env.NODE_ENV !== "test") {
  serve({ fetch: app.fetch, port: process.env.PORT || 5000 });
  console.log(`✅ Server running on port ${process.env.PORT || 5000}`);
}

export default app;