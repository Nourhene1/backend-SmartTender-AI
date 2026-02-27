// routes/Authmicrosoft.route.js
import { Hono } from "hono";
import { verifyToken } from "../middlewares/auth.js";
import {
  getAuthUrl,
  getTokenFromCode,
  createWebhookSubscription,
} from "../services/Microsoftgraphservice.js";

const router = new Hono();

/* ─── GET /auth/microsoft/connect ────────────────────────── */
router.get("/connect", verifyToken, async (c) => {
  try {
    const userId = c.get("user")?.id;
    if (!userId) return c.json({ message: "Unauthorized" }, 401);
    const authUrl = await getAuthUrl(String(userId));
    return c.json({ authUrl });
  } catch (err) {
    console.error("Microsoft connect error:", err);
    return c.json({ message: "Erreur de connexion Microsoft" }, 500);
  }
});

/* ─── GET /auth/microsoft/callback ───────────────────────── */
router.get("/callback", async (c) => {
  const frontendBase = process.env.FRONTEND_URL || "http://localhost:3000";
  const error = c.req.query("error");
  if (error) return c.redirect(`${frontendBase}/calendar?error=microsoft_denied`);

  const code   = c.req.query("code");
  const userId = c.req.query("state");
  if (!code) return c.text("Code manquant", 400);

  try {
    // ✅ Appel HTTP direct → accessToken + refreshToken garantis
    const tokenResponse = await getTokenFromCode(code);

    const { accessToken, refreshToken, expiresIn, outlookEmail } = tokenResponse;
    const expiresAt = new Date(Date.now() + (expiresIn || 3600) * 1000);

    const db = c.get("db");
    if (db) {
      // ✅ Stocke le refreshToken directement en DB
      await db.collection("user_calendar_tokens").updateOne(
        { userId: String(userId), provider: "microsoft" },
        {
          $set: {
            userId:       String(userId),
            provider:     "microsoft",
            accessToken,
            refreshToken,  // ✅ stocké directement
            expiresAt,
            outlookEmail,
            connected:    true,
            updatedAt:    new Date(),
          },
          $setOnInsert: { createdAt: new Date() },
        },
        { upsert: true }
      );
    }

    // Webhook (non bloquant)
    try {
      const sub = await createWebhookSubscription(accessToken);
      if (db && sub?.id) {
        await db.collection("webhook_subscriptions").updateOne(
          { userId: String(userId) },
          {
            $set: {
              userId:         String(userId),
              subscriptionId: sub.id,
              expiresAt:      new Date(sub.expirationDateTime),
              updatedAt:      new Date(),
            },
            $setOnInsert: { createdAt: new Date() },
          },
          { upsert: true }
        );
        console.log("✅ Webhook créé !");
      }
    } catch (e) {
      console.warn("Webhook failed (non bloquant):", e?.message || e);
    }

    // Redirection selon le rôle
    let redirectPath = "/ResponsableMetier/calendar";
    if (db && userId) {
      try {
        const { ObjectId } = await import("mongodb");
        let user = null;
        try { user = await db.collection("users").findOne({ _id: new ObjectId(userId) }); }
        catch { user = await db.collection("users").findOne({ _id: userId }); }
        const role = (user?.role ?? "").toLowerCase();
        if (role === "admin" || role === "recruiter" || role === "recruteur") {
          redirectPath = "/recruiter/calendar";
        }
        console.log(`✅ Outlook connecté (rôle: ${role}) → ${redirectPath}`);
      } catch (e) {
        console.warn("Rôle introuvable:", e?.message);
      }
    }

    return c.redirect(`${frontendBase}${redirectPath}?connected=true`);
  } catch (err) {
    console.error("Microsoft callback error:", err?.response?.data || err?.message);
    const frontendBase = process.env.FRONTEND_URL || "http://localhost:3000";
    return c.redirect(`${frontendBase}/calendar?error=auth_failed`);
  }
});

/* ─── GET /auth/microsoft/status ─────────────────────────── */
router.get("/status", verifyToken, async (c) => {
  try {
    const userId = c.get("user")?.id;
    const db = c.get("db");
    if (!db || !userId) return c.json({ connected: false });

    const token = await db.collection("user_calendar_tokens").findOne({
      userId: String(userId), provider: "microsoft", connected: true,
    });

    if (!token) return c.json({ connected: false });

    return c.json({
      connected:    true,
      outlookEmail: token.outlookEmail,
      tokenExpired: new Date(token.expiresAt) < new Date(),
    });
  } catch (err) {
    return c.json({ connected: false });
  }
});

/* ─── DELETE /auth/microsoft/disconnect ──────────────────── */
router.delete("/disconnect", verifyToken, async (c) => {
  try {
    const userId = c.get("user")?.id;
    const db = c.get("db");
    if (db && userId) {
      await db.collection("user_calendar_tokens").updateOne(
        { userId: String(userId), provider: "microsoft" },
        { $set: { connected: false } }
      );
      await db.collection("webhook_subscriptions").deleteMany({ userId: String(userId) });
    }
    return c.json({ message: "Outlook déconnecté ✅" });
  } catch (err) {
    return c.json({ message: "Erreur déconnexion" }, 500);
  }
});

export default router;