// routes/calendar.routes.js — VERSION COMPLÈTE
import { Hono } from "hono";
import { ObjectId } from "mongodb";
import { verifyToken } from "../middlewares/auth.js";
import * as graphService from "../services/Microsoftgraphservice.js";
import { getDB } from "../models/db.js";
import {
  createInterviewEventController,
  getRhSlotsController,
  candidateConfirmRhController,
  candidateRescheduleRhController,
  getRescheduleInfoController,
   getRhTechSlotsController,
  proposeRhTechInterviewController,

  managerConfirmRhTechController,
  managerProposeNewRhTechController,

  candidateGetSlotsController,
  candidateGetInfoController,
  candidateConfirmRhTechController,
  candidateProposeNewRhTechController,
  recruiterGetReviewController,
  recruiterAcceptManagerProposalController,
  recruiterProposeCounterController,
} from "../controllers/Calendar.interview.controller.js";
import {
  getInterviewByIdController,
  getRecruiterFreeSlotsController,
  recruiterProposeNewSlotController,
} from "../controllers/Calendar.interview.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
const router = new Hono();

// ─── Verrou en mémoire : évite 2 refreshs simultanés pour le même user ────────
const refreshLocks = new Map();

/* ─── MIDDLEWARE : refresh token Microsoft seulement si nécessaire ───────────
 *  1. On utilise le token en DB s'il est encore valide (marge 5 min).
 *  2. Si expiré, on refresh UNE SEULE FOIS via un verrou par userId.
 *  3. Si Graph retourne 401 malgré tout, on tente un unique retry après refresh.
 * ─────────────────────────────────────────────────────────────────────────── */
const withGraphToken = async (c, next) => {
  try {
    const db     = c.get("db");
    const userId = c.get("user")?.id;

    if (!db)     return c.json({ message: "DB non disponible" }, 500);
    if (!userId) return c.json({ message: "Non authentifié" }, 401);

    const tokenRecord = await db.collection("user_calendar_tokens").findOne({
      userId: String(userId), provider: "microsoft", connected: true,
    });

    if (!tokenRecord) {
      return c.json({ message: "Outlook non connecté", code: "OUTLOOK_NOT_CONNECTED" }, 403);
    }

    // ── Détermine si le token est expiré (avec marge de 5 min) ───────────────
    const MARGIN_MS    = 5 * 60 * 1000;
    const tokenExpired = !tokenRecord.expiresAt ||
      new Date(tokenRecord.expiresAt).getTime() - Date.now() < MARGIN_MS;

    if (!tokenExpired) {
      c.set("accessToken",  tokenRecord.accessToken);
      c.set("refreshToken", tokenRecord.refreshToken);
      c.set("userId", String(userId));
      return await next();
    }

    // ── Token expiré → refresh avec verrou par userId ─────────────────────────
    if (refreshLocks.has(String(userId))) {
      await refreshLocks.get(String(userId));
      const fresh = await db.collection("user_calendar_tokens").findOne({
        userId: String(userId), provider: "microsoft", connected: true,
      });
      if (!fresh) {
        return c.json({ message: "Session Outlook expirée, veuillez reconnecter", code: "OUTLOOK_NOT_CONNECTED" }, 403);
      }
      c.set("accessToken",  fresh.accessToken);
      c.set("refreshToken", fresh.refreshToken);
      c.set("userId", String(userId));
      return await next();
    }

    let resolveLock;
    const lockPromise = new Promise((res) => { resolveLock = res; });
    refreshLocks.set(String(userId), lockPromise);

    try {
      console.log("🔄 Refresh token Microsoft pour user", userId);
      const result = await graphService.refreshAccessToken(tokenRecord.refreshToken);

      await db.collection("user_calendar_tokens").updateOne(
        { userId: String(userId), provider: "microsoft" },
        {
          $set: {
            accessToken:  result.accessToken,
            refreshToken: result.refreshToken,
            expiresAt:    new Date(Date.now() + (result.expiresIn || 3600) * 1000),
          },
        }
      );

      c.set("accessToken",  result.accessToken);
      c.set("refreshToken", result.refreshToken);
      c.set("userId", String(userId));
      console.log("✅ Token Microsoft rafraîchi pour user", userId);
    } catch (err) {
      console.error("❌ Refresh Microsoft échoué:", err?.response?.data || err?.message);
      await db.collection("user_calendar_tokens").updateOne(
        { userId: String(userId), provider: "microsoft" },
        { $set: { connected: false } }
      );
      refreshLocks.delete(String(userId));
      resolveLock();
      return c.json(
        { message: "Session Outlook expirée, veuillez reconnecter", code: "OUTLOOK_NOT_CONNECTED" },
        403
      );
    } finally {
      refreshLocks.delete(String(userId));
      resolveLock();
    }

    await next();
  } catch (err) {
    console.error("withGraphToken error:", err);
    return c.json({ message: "Erreur serveur", error: String(err) }, 500);
  }
};

/* ─── Helper : retente 1 fois si TOKEN_EXPIRED ───────────────────────────── */
const withRetry = async (c, fn) => {
  try {
    return await fn(c.get("accessToken"));
  } catch (err) {
    if (err?.code !== "TOKEN_EXPIRED") throw err;

    console.warn("⚠️  TOKEN_EXPIRED malgré refresh → 2e tentative");
    const db           = c.get("db");
    const userId       = c.get("userId");
    const refreshToken = c.get("refreshToken");

    try {
      const result = await graphService.refreshAccessToken(refreshToken);
      await db.collection("user_calendar_tokens").updateOne(
        { userId, provider: "microsoft" },
        {
          $set: {
            accessToken:  result.accessToken,
            refreshToken: result.refreshToken,
            expiresAt:    new Date(Date.now() + (result.expiresIn || 3600) * 1000),
          },
        }
      );
      c.set("accessToken",  result.accessToken);
      c.set("refreshToken", result.refreshToken);
      return await fn(result.accessToken);
    } catch (retryErr) {
      console.error("❌ Re-refresh échoué:", retryErr?.response?.data || retryErr?.message);
      await db.collection("user_calendar_tokens").updateOne(
        { userId, provider: "microsoft" },
        { $set: { connected: false } }
      );
      throw new Error("SESSION_EXPIRED");
    }
  }
};

/* ══════════════════════════════════════════════════════════════════
 *  ROUTES ENTRETIEN — sans withGraphToken (gèrent leur propre token)
 * ══════════════════════════════════════════════════════════════════ */

/* ─── GET /calendar/rh-slots ─────────────────────────────────────
 *  Retourne créneaux libres 10h→12h du recruteur (Outlook) / 7 jours
 * ─────────────────────────────────────────────────────────────── */
router.get("/rh-slots", verifyToken, getRhSlotsController);

/* ─── POST /calendar/events/interview ────────────────────────────
 *  1. Crée l'événement dans Outlook du recruteur
 *  2. Enregistre l'entretien RH en DB
 *  3. Envoie email au candidat (confirmer / proposer autre date)
 * ─────────────────────────────────────────────────────────────── */
router.post("/events/interview", verifyToken, createInterviewEventController);

/* ─── POST /calendar/interview/confirm/:confirmToken ─────────────
 *  Route PUBLIQUE — candidat confirme depuis son email
 * ─────────────────────────────────────────────────────────────── */
router.post("/interview/confirm/:confirmToken", candidateConfirmRhController);

/* ─── POST /calendar/interview/reschedule/:rescheduleToken ───────
 *  Route PUBLIQUE — candidat demande une autre date
 * ─────────────────────────────────────────────────────────────── */
router.post("/interview/reschedule/:rescheduleToken", candidateRescheduleRhController);

/* ══════════════════════════════════════════════════════════════════
 *  ⚠️  ROUTES STATIQUES EN PREMIER (avant les routes dynamiques /:id)
 *  Dans Hono/Express, /interview/:id intercepterait "confirm" et
 *  "reschedule" si ces routes étaient déclarées après.
 * ══════════════════════════════════════════════════════════════════ */

/* ─── GET /calendar/interview/confirm/:confirmToken ──────────────
 *  Page de confirmation (GET pour afficher la page au candidat)
 * ─────────────────────────────────────────────────────────────── */
router.get("/interview/confirm/:confirmToken", async (c) => {
  try {
    const { confirmToken } = c.req.param();
    const db = getDB();

    const iv = await db.collection("interviews").findOne({ confirmToken });
    if (!iv) return c.json({ error: "Lien invalide ou expiré" }, 404);

    // ✅ Fallback pour les anciens interviews (qui n'ont pas jobTitle)
    let job = null;
    if ((!iv.jobTitle || String(iv.jobTitle).trim() === "") && iv.jobOfferId) {
      try {
        job = await db.collection("job_offers").findOne({ _id: iv.jobOfferId });
      } catch {}
    }

    const title =
      (iv.jobTitle && String(iv.jobTitle).trim()) ||
      job?.titre ||
      job?.title ||
      "Poste à définir";

    const location = iv.location || "Optylab / Teams";

    return c.json({
      status: iv.status,
      date: iv.proposedDate,
      time: iv.proposedTime,
      candidateName: iv.candidateName,
      jobTitle: title,
      location,
      typeLabel: "Entretien RH",
    });
  } catch (err) {
    console.error("❌ GET confirm info error:", err);
    return c.json({ error: "Erreur serveur" }, 500);
  }
});

/* ─── GET /calendar/interview/reschedule/:rescheduleToken ────────
 *  Page reschedule candidat — retourne infos + créneaux libres
 * ─────────────────────────────────────────────────────────────── */
router.get("/interview/reschedule/:rescheduleToken", getRescheduleInfoController);

/* ══════════════════════════════════════════════════════════════════
 *  ROUTES DYNAMIQUES /:id — déclarées APRÈS les routes statiques
 * ══════════════════════════════════════════════════════════════════ */

/* ─── GET /calendar/interview/:id ────────────────────────────────
 *  Recruteur : infos complètes d'un entretien par ID
 * ─────────────────────────────────────────────────────────────── */
router.get("/interview/:id", verifyToken, getInterviewByIdController);

/* ─── GET /calendar/interview/:id/free-slots ─────────────────────
 *  Recruteur : créneaux libres 10-12 après J+3
 * ─────────────────────────────────────────────────────────────── */
router.get("/interview/:id/free-slots", verifyToken, getRecruiterFreeSlotsController);

/* ─── POST /calendar/interview/:id/propose ───────────────────────
 *  Recruteur : propose un nouveau créneau → email candidat (confirm only)
 * ─────────────────────────────────────────────────────────────── */
router.post("/interview/:id/propose", verifyToken, recruiterProposeNewSlotController);
/* ─── GET /calendar/events ───────────────────────────────────── */
/* ─── GET /calendar/events ───────────────────────────────────── */
router.get("/events", verifyToken, withGraphToken, async (c) => {
  try {
    const db = c.get("db");
    const userId = c.get("userId");
    const { startDate, endDate } = c.req.query();

    // 1) Fetch Outlook events for the requested range
    const outlookEvents = await withRetry(c, (token) =>
      graphService.getOutlookEvents(token, startDate || null, endDate || null)
    );

    const col = db.collection("calendar_events");

    // 2) Upsert all outlook events
    const seenOutlookIds = new Set();

    for (const event of outlookEvents) {
      if (!event?.outlookId) continue;
      seenOutlookIds.add(event.outlookId);

      await col.updateOne(
        { userId, outlookId: event.outlookId },
        {
          $set: {
            userId,
            outlookId: event.outlookId,
            title: event.title,
            description: event.description || "",
            startDate: event.start ? new Date(event.start) : null,
            endDate: event.end ? new Date(event.end) : null,
            location: event.location || null,
            isAllDay: !!event.isAllDay,
            source: "outlook",          // ✅ Outlook is the truth
            status: "scheduled",
            syncedAt: new Date(),
          },
          $setOnInsert: { createdAt: new Date(), type: "outlook" },
        },
        { upsert: true }
      );
    }

    // 3) CLEANUP: delete mirrored events that are no longer in Outlook (in this range)
    // ✅ only delete events that have outlookId (mirrored)
    const idsArray = Array.from(seenOutlookIds);

    // If Graph returns 0 events, we still want to cleanup the range safely:
    // We can't filter by date range easily without extra query,
    // so we keep it simple: remove all outlook-mirrored events that are not in the latest Graph list,
    // BUT ONLY if the client requested a specific range (startDate/endDate)
    if (startDate && endDate) {
      await col.deleteMany({
        userId,
        outlookId: { $exists: true, $ne: null, $nin: idsArray },
        source: "outlook",
        // Optional: limit deletion to range (safer)
        startDate: { $gte: new Date(startDate), $lte: new Date(endDate) },
      });
    }

    // 4) Return DB view (now mirrored)
    const allEvents = await col.find({ userId }).sort({ startDate: 1 }).toArray();
    return c.json({ events: allEvents, total: allEvents.length });
  } catch (err) {
    console.error("GET /calendar/events error:", err);
    if (err?.message === "SESSION_EXPIRED") {
      return c.json(
        { message: "Session Outlook expirée, veuillez reconnecter", code: "OUTLOOK_NOT_CONNECTED" },
        403
      );
    }
    return c.json({ message: "Erreur serveur", error: String(err) }, 500);
  }
});

/* ─── POST /calendar/events ──────────────────────────────────── */
router.post("/events", verifyToken, withGraphToken, async (c) => {
  try {
    const db     = c.get("db");
    const userId = c.get("userId");
    const body   = await c.req.json();

    const outlookEvent = await withRetry(c, (token) =>
      graphService.createOutlookEvent(token, body)
    );

    const newEvent = {
      userId,
      outlookId:   outlookEvent.outlookId,
      title:       body.title,
      description: body.description ?? null,
      startDate:   new Date(body.start),
      endDate:     new Date(body.end),
      location:    body.location  ?? null,
      isAllDay:    body.isAllDay  ?? false,
      source:      "app",
      syncedAt:    new Date(),
      createdAt:   new Date(),
      status:      "scheduled",
    };
    const result = await db.collection("calendar_events").insertOne(newEvent);
    return c.json({ message: "Créé ✅", event: { ...newEvent, _id: result.insertedId } }, 201);
  } catch (err) {
    console.error("POST /calendar/events error:", err);
    if (err?.message === "SESSION_EXPIRED") {
      return c.json({ message: "Session Outlook expirée, veuillez reconnecter", code: "OUTLOOK_NOT_CONNECTED" }, 403);
    }
    return c.json({ message: "Erreur création", error: String(err) }, 500);
  }
});

/* ─── PUT /calendar/events/:id ───────────────────────────────── */
router.put("/events/:id", verifyToken, withGraphToken, async (c) => {
  try {
    const db     = c.get("db");
    const userId = c.get("userId");
    const { id } = c.req.param();
    const body   = await c.req.json();

    let event;
    try { event = await db.collection("calendar_events").findOne({ _id: new ObjectId(id), userId }); }
    catch { event = await db.collection("calendar_events").findOne({ outlookId: id, userId }); }
    if (!event) return c.json({ message: "Introuvable" }, 404);

    if (event.outlookId) {
      await withRetry(c, (token) =>
        graphService.updateOutlookEvent(token, event.outlookId, body)
      );
    }

    const updates = {
      title:       body.title,
      description: body.description ?? event.description,
      startDate:   new Date(body.start),
      endDate:     new Date(body.end),
      location:    body.location  ?? event.location,
      isAllDay:    body.isAllDay  ?? event.isAllDay,
      syncedAt:    new Date(),
    };
    await db.collection("calendar_events").updateOne({ _id: event._id }, { $set: updates });
    return c.json({ message: "Mis à jour ✅", event: { ...event, ...updates } });
  } catch (err) {
    console.error("PUT error:", err);
    if (err?.message === "SESSION_EXPIRED") {
      return c.json({ message: "Session Outlook expirée, veuillez reconnecter", code: "OUTLOOK_NOT_CONNECTED" }, 403);
    }
    return c.json({ message: "Erreur", error: String(err) }, 500);
  }
});

/* ─── DELETE /calendar/events/:id ────────────────────────────── */
router.delete("/events/:id", verifyToken, withGraphToken, async (c) => {
  try {
    const db     = c.get("db");
    const userId = c.get("userId");
    const { id } = c.req.param();

    let event;
    try { event = await db.collection("calendar_events").findOne({ _id: new ObjectId(id), userId }); }
    catch { event = await db.collection("calendar_events").findOne({ outlookId: id, userId }); }
    if (!event) return c.json({ message: "Introuvable" }, 404);

    if (event.outlookId) {
      await withRetry(c, (token) =>
        graphService.deleteOutlookEvent(token, event.outlookId)
      );
    }
    await db.collection("calendar_events").deleteOne({ _id: event._id });
    return c.json({ message: "Supprimé ✅" });
  } catch (err) {
    console.error("DELETE error:", err);
    if (err?.message === "SESSION_EXPIRED") {
      return c.json({ message: "Session Outlook expirée, veuillez reconnecter", code: "OUTLOOK_NOT_CONNECTED" }, 403);
    }
    return c.json({ message: "Erreur", error: String(err) }, 500);
  }
});

/* ─── POST /calendar/sync ────────────────────────────────────── */
// POST /calendar/sync
router.post("/sync", verifyToken, withGraphToken, async (c) => {
  try {
    const db = c.get("db");
    const userId = c.get("userId");

    let body = null;
    try { body = await c.req.json(); } catch {}

    const startDate = body?.startDate || null;
    const endDate   = body?.endDate   || null;

    const outlookEvents = await withRetry(c, (token) =>
      graphService.getOutlookEvents(token, startDate, endDate)
    );

    const col = db.collection("calendar_events");
    let synced = 0;

    for (const event of outlookEvents) {
      await col.updateOne(
        { userId, outlookId: event.outlookId },
        {
          $set: {
            userId,
            outlookId: event.outlookId,
            title: event.title,
            description: event.description,
            startDate: event.start ? new Date(event.start) : null,
            endDate: event.end ? new Date(event.end) : null,
            location: event.location,
            isAllDay: event.isAllDay,
            source: "outlook",
            syncedAt: new Date(),
          },
          $setOnInsert: { createdAt: new Date(), status: "scheduled" },
        },
        { upsert: true }
      );
      synced++;
    }

    return c.json({ message: `Sync ✅ (${synced} events)`, synced });
  } catch (err) {
    console.error("POST /sync error:", err);
    if (err?.message === "SESSION_EXPIRED") {
      return c.json({ message: "Session Outlook expirée, veuillez reconnecter", code: "OUTLOOK_NOT_CONNECTED" }, 403);
    }
    return c.json({ message: "Erreur sync", error: String(err) }, 500);
  }
});
/* ─── POST /calendar/webhook ─────────────────────────────────── */
router.post("/webhook", async (c) => {
  const validationToken = c.req.query("validationToken");
  if (validationToken) {
    return new Response(validationToken, { headers: { "Content-Type": "text/plain" } });
  }
  return c.text("OK", 202);
});

// ✅ slots communs recruteur + responsable métier
router.get("/rh-tech-slots", authMiddleware, getRhTechSlotsController);

// ✅ recruteur propose une date => email au responsable
router.post("/rh-tech/schedule", authMiddleware, proposeRhTechInterviewController);

// ✅ responsable confirme la date proposée
router.post("/rh-tech/manager/confirm/:token", managerConfirmRhTechController);

// ✅ responsable propose une nouvelle date (si pas dispo)
router.post("/rh-tech/manager/propose/:token", managerProposeNewRhTechController);

// Candidat
router.get("/rh-tech/candidate/slots/:token",    candidateGetSlotsController);
router.get("/rh-tech/candidate/info/:token",     candidateGetInfoController);
router.post("/rh-tech/candidate/confirm/:token", candidateConfirmRhTechController);
router.post("/rh-tech/candidate/propose/:token", candidateProposeNewRhTechController);

// Recruteur review
router.get("/rh-tech/recruiter/review/:token",   recruiterGetReviewController);
router.post("/rh-tech/recruiter/accept/:token",  recruiterAcceptManagerProposalController);
router.post("/rh-tech/recruiter/propose/:token", recruiterProposeCounterController);

export default router;