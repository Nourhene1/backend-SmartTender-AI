// ================================================================
// calendar.interview.routes.js
//
// Ajouter dans calendar.routes.js (ou créer fichier séparé) :
//
//  POST /calendar/events/interview
//       → Crée l'événement dans Outlook
//       → Enregistre l'entretien en DB (collection interviews)
//       → Envoie email au candidat avec liens confirmer/autre date
//
//  GET  /interviews/rh-slots
//       → Retourne créneaux libres 10h→12h du recruteur (Outlook)
// ================================================================

import { Hono } from "hono";
import { ObjectId } from "mongodb";
import { verifyToken } from "../middlewares/auth.js";
import * as graphService from "../services/Microsoftgraphservice.js";
import { getDB } from "../models/db.js";
import { scheduleInterviewReminders } from "../services/interview-reminder.service.js";
import {
  createInterview,
  findInterviewsByCandidature,
} from "../models/interview.model.js";
import { findJobOfferById } from "../models/job.model.js";
import { sendInterviewInviteToCandidate } from "../services/interview-mail.service.js";
import {
  sendCandidateConfirmedNotification,
  sendCandidateConfirmedToResponsable,
} from "../services/interview-mail.service.js";
import { sendRecruiterRescheduleRequestEmail } from "../services/interview-mail.service.js";
import { sendCandidateProposedSlotConfirmOnlyEmail } from "../services/interview-mail.service.js";

function formatTimeFR(date) {
  return new Date(date).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDateFR(date) {
  return new Date(date).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
// Calendar.interview.controller.js

import {
  sendInterviewConfirmationRequestToManager,
  sendInterviewConfirmedToCandidate,
  sendInterviewInfoToRecruiter,
  sendRecruiterReviewEmail,
  sendInterviewConfirmedNotificationToCandidate,
} from "../services/interview-mail.service.js";

/* ── Outlook helpers RH+Technique ──────────────────────────────────────── */
async function outlookCreateForBoth(db, interview, payload) {
  let rId = null,
    mId = null;

  try {
    const rTok = await getValidToken(String(interview.recruiterId));
    const mTok = await getValidToken(String(interview.responsableMetierId));

    // ── CREATE Outlook recruiter ──
    if (rTok) {
      const ev = await graphService.createOutlookEvent(rTok, payload);
      rId = ev?.outlookId || null;

      // ✅ INSERT DIRECT dans calendar_events (recruteur)
      await db.collection("calendar_events").updateOne(
        { userId: String(interview.recruiterId), outlookId: rId },
        {
          $set: {
            userId: String(interview.recruiterId),
            outlookId: rId,
            title: payload.title,
            description: payload.description || "",
            startDate: new Date(payload.start),
            endDate: new Date(payload.end),
            location: payload.location || "Optylab / Teams",
            source: "outlook",
            type: "interview",
            status: "scheduled",
            syncedAt: new Date(),
          },
          $setOnInsert: { createdAt: new Date() },
        },
        { upsert: true },
      );
    }

    // ── CREATE Outlook manager ──
    if (mTok) {
      const ev = await graphService.createOutlookEvent(mTok, payload);
      mId = ev?.outlookId || null;

      // (optionnel) si tu veux aussi l’afficher pour le manager dans ton app
      await db.collection("calendar_events").insertOne({
        userId: String(interview.responsableMetierId),
        outlookId: mId,
        title: payload.title,
        description: payload.description || "",
        startDate: new Date(payload.start),
        endDate: new Date(payload.end),
        location: payload.location || "Optylab / Teams",
        source: "outlook",
        type: "interview",
        createdAt: new Date(),
        syncedAt: new Date(),
        status: "scheduled",
      });
    }

    // ── UPDATE interview ──
    await db.collection("interviews").updateOne(
      { _id: interview._id },
      {
        $set: {
          "outlook.recruiterEventId": rId,
          "outlook.managerEventId": mId,
        },
      },
    );

    console.log("✅ Outlook + Calendar DB CREATED", { rId, mId });
  } catch (e) {
    console.warn("⚠️ outlookCreateForBoth:", e?.message);
  }

  return { recruiterEventId: rId, managerEventId: mId };
}

async function outlookUpdateForBoth(db, interview, payload) {
  try {
    const rTok = await getValidToken(String(interview.recruiterId));
    const mTok = await getValidToken(String(interview.responsableMetierId));
    if (
      rTok &&
      interview.outlook?.recruiterEventId &&
      graphService.updateOutlookEvent
    )
      await graphService.updateOutlookEvent(
        rTok,
        interview.outlook.recruiterEventId,
        payload,
      );
    if (
      mTok &&
      interview.outlook?.managerEventId &&
      graphService.updateOutlookEvent
    )
      await graphService.updateOutlookEvent(
        mTok,
        interview.outlook.managerEventId,
        payload,
      );
    console.log("✅ Outlook UPDATE");
  } catch (e) {
    console.warn("⚠️ outlookUpdateForBoth:", e?.message);
  }
}

async function outlookDeleteAndCreateForBoth(db, interview, payload) {
  // payload attendu:
  // { title, description, start, end, location }

  const safeDelete = async (token, eventId, label) => {
    if (!token || !eventId || !graphService.deleteOutlookEvent) return;

    try {
      await graphService.deleteOutlookEvent(token, eventId);
      console.log(`🗑️ Outlook DELETE OK (${label})`, eventId);
    } catch (err) {
      const status = err?.response?.status;

      // ✅ 404 = event n'existe plus OU pas accessible pour ce user => on ignore
      if (status === 404) {
        console.warn(`⚠️ Outlook DELETE 404 (${label}) → ignore`, eventId);
        return;
      }

      // ✅ 401/403 = token/scope/propriétaire => on log sans casser le flow
      if (status === 401 || status === 403) {
        console.warn(
          `⚠️ Outlook DELETE ${status} (${label}) → ignore`,
          err?.response?.data || err?.message,
        );
        return;
      }

      // autres erreurs : on log mais on n'explose pas
      console.warn(
        `⚠️ Outlook DELETE error (${label})`,
        err?.response?.data || err?.message,
      );
    }
  };

  try {
    // 1) récupérer tokens
    const rTok = await getValidToken(String(interview.recruiterId));
    const mTok = await getValidToken(String(interview.responsableMetierId));

    // 2) tenter delete des anciens events (si existent)
    await safeDelete(rTok, interview.outlook?.recruiterEventId, "recruiter");
    await safeDelete(mTok, interview.outlook?.managerEventId, "manager");
  } catch (e) {
    console.warn("⚠️ outlookDelete phase failed:", e?.message);
  }

  // 3) reset outlook ids côté objet (pour forcer create)
  const resetInterview = {
    ...interview,
    outlook: { recruiterEventId: null, managerEventId: null },
  };

  // 4) créer les nouveaux events + update DB (via outlookCreateForBoth)
  return await outlookCreateForBoth(db, resetInterview, payload);
}

/* ── Slot builder pour le candidat : commence après offsetDays, skip sam/dim ── */
function buildCandidateSlots({ startDate, days = 14 }) {
  const slots = [];
  const base = startDate instanceof Date ? new Date(startDate) : new Date();
  let workingDays = 0;
  const maxDays = Number(days) || 14;

  for (let d = 1; d <= maxDays * 3; d++) {
    const day = new Date(base);
    day.setDate(day.getDate() + d);
    day.setHours(0, 0, 0, 0);

    const dow = day.getDay();
    if (dow === 0 || dow === 6) continue; // skip dimanche (0) et samedi (6)

    const dateStr = day.toISOString().slice(0, 10);

    // 3 créneaux par jour : 9h, 10h, 11h
    for (const t of ["09:00", "10:00", "11:00", "14:00", "15:00"]) {
      slots.push({
        date: dateStr,
        time: t,
        startISO: `${dateStr}T${t}:00`,
        endISO: `${dateStr}T${t.slice(0, 2) * 1 + 1}:${t.slice(3)}:00`,
      });
    }

    workingDays++;
    if (workingDays >= maxDays) break;
  }
  return slots;
}

/* =========================
   Helpers
========================= */
function pickManagerId(job) {
  return (
    job?.responsableMetierId ||
    job?.managerId ||
    job?.responsibleId ||
    (Array.isArray(job?.assignedUserIds) ? job.assignedUserIds[0] : null) ||
    job?.createdBy ||
    null
  );
}

function buildSlots({ days = 7 }) {
  const maxDays = Math.min(Number(days) || 7, 14);
  const slots = [];

  let workingDays = 0;
  for (let d = 1; d <= maxDays + 10; d++) {
    const day = new Date();
    day.setDate(day.getDate() + d);
    day.setHours(0, 0, 0, 0);

    // skip weekend
    if (day.getDay() === 0 || day.getDay() === 6) continue;

    const dateStr = day.toISOString().slice(0, 10);

    // ✅ 2 créneaux par jour (modifie si tu veux)
    const s1 = {
      date: dateStr,
      time: "10:00",
      startISO: `${dateStr}T10:00:00`,
      endISO: `${dateStr}T11:00:00`,
    };
    const s2 = {
      date: dateStr,
      time: "11:00",
      startISO: `${dateStr}T11:00:00`,
      endISO: `${dateStr}T12:00:00`,
    };

    slots.push(s1, s2);
    workingDays++;
    if (workingDays >= maxDays) break;
  }

  return slots;
}

function overlaps(slotStart, slotEnd, evStart, evEnd) {
  return slotStart < evEnd && slotEnd > evStart;
}

function normalizeEvents(events = []) {
  // essaie d’accepter plusieurs formats
  return events
    .map((ev) => {
      const s =
        ev?.start?.dateTime || ev?.start || ev?.startDate || ev?.startISO;
      const e = ev?.end?.dateTime || ev?.end || ev?.endDate || ev?.endISO;
      if (!s || !e) return null;
      return { start: new Date(s), end: new Date(e) };
    })
    .filter(Boolean);
}

function isSlotFree(slot, busyEvents) {
  const slotStart = new Date(slot.startISO);
  const slotEnd = new Date(slot.endISO);
  return !busyEvents.some((ev) =>
    overlaps(slotStart, slotEnd, ev.start, ev.end),
  );
}

function formatFR(dt) {
  const d = new Date(dt);
  return {
    date: d.toLocaleDateString("fr-FR", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }),
    time: d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }),
  };
}

function randomToken() {
  return (
    Math.random().toString(36).slice(2) +
    Math.random().toString(36).slice(2) +
    Date.now().toString(36)
  );
}

/* =========================
   1) GET /calendar/rh-tech-slots
   => créneaux communs recruteur + responsable métier
========================= */
export async function getRhTechSlotsController(c) {
  try {
    const recruiterId = c.get("user")?.id;
    const { candidatureId, jobOfferId, days = 7 } = c.req.query();

    if (!recruiterId) return c.json({ slots: [] }, 401);
    if (!jobOfferId) return c.json({ slots: [] }, 400);

    const db = getDB();
    const job = await db.collection("job_offers").findOne({
      _id: new ObjectId(String(jobOfferId)),
    });
    if (!job) return c.json({ slots: [] }, 404);

    const managerId = pickManagerId(job);
    if (!managerId) {
      return c.json(
        { slots: [], message: "Responsable métier introuvable" },
        400,
      );
    }

    const slots = buildSlots({ days });

    // range
    const startRange = new Date();
    const endRange = new Date();
    endRange.setDate(endRange.getDate() + (Number(days) || 7) + 14);

    const startISO = startRange.toISOString();
    const endISO = endRange.toISOString();

    // helper: fetch outlook events with 1 retry on TOKEN_EXPIRED
    const fetchOutlookEventsSafe = async (userId) => {
      // 1) token normal
      let token = await getValidToken(String(userId));
      if (!token) return null;

      try {
        return await graphService.getOutlookEvents(token, startISO, endISO);
      } catch (err) {
        // 2) if token expired in reality => force refresh + retry once
        if (err?.code === "TOKEN_EXPIRED") {
          const freshToken = await getValidToken(String(userId), {
            forceRefresh: true,
          });
          if (!freshToken) return null;
          return await graphService.getOutlookEvents(
            freshToken,
            startISO,
            endISO,
          );
        }
        throw err;
      }
    };

    const [rawR, rawM] = await Promise.all([
      fetchOutlookEventsSafe(recruiterId),
      fetchOutlookEventsSafe(managerId),
    ]);

    // fallback si un manque Outlook
    if (!rawR || !rawM) {
      return c.json({
        slots,
        outlookConnected: { recruiter: !!rawR, manager: !!rawM },
        warning:
          "Calendrier Outlook non connecté (ou session expirée) pour au moins un acteur",
      });
    }

    const busyR = normalizeEvents(rawR);
    const busyM = normalizeEvents(rawM);

    const common = slots.filter(
      (s) => isSlotFree(s, busyR) && isSlotFree(s, busyM),
    );

    return c.json({
      slots: common,
      outlookConnected: { recruiter: true, manager: true },
      total: common.length,
    });
  } catch (err) {
    console.error("❌ getRhTechSlotsController:", err);
    // si session outlook vraiment morte
    if (err?.message === "SESSION_EXPIRED" || err?.code === "TOKEN_EXPIRED") {
      return c.json(
        {
          slots: [],
          message: "Session Outlook expirée, veuillez reconnecter",
          code: "OUTLOOK_NOT_CONNECTED",
        },
        403,
      );
    }
    return c.json({ slots: [], error: "Erreur serveur" }, 500);
  }
}

/* =========================
   2) POST /calendar/rh-tech/schedule
   recruteur propose => mail manager pour confirmer/modifier
========================= */
export async function proposeRhTechInterviewController(c) {
  try {
    const recruiterId = c.get("user")?.id;
    if (!recruiterId) return c.json({ message: "Non authentifié" }, 401);

    const body = await c.req.json();
    const { candidatureId, jobOfferId, proposedDate, proposedTime } = body;

    if (!candidatureId || !jobOfferId || !proposedDate || !proposedTime) {
      return c.json({ message: "Champs manquants" }, 400);
    }

    const db = getDB();

    const job = await db.collection("job_offers").findOne({
      _id: new ObjectId(String(jobOfferId)),
    });
    if (!job) return c.json({ message: "Offre introuvable" }, 404);

    const managerId = pickManagerId(job);
    if (!managerId)
      return c.json({ message: "Responsable métier introuvable" }, 400);

    const manager = await db.collection("users").findOne({
      _id: new ObjectId(String(managerId)),
    });
    const responsibleEmail = manager?.email;
    const responsibleName = manager?.name || manager?.fullName || "Responsable";
    if (!responsibleEmail)
      return c.json({ message: "Email responsable introuvable" }, 400);

    const recruiter = await db.collection("users").findOne({
      _id: new ObjectId(String(recruiterId)),
    });
    const recruiterEmail = recruiter?.email || "";
    const recruiterName = recruiter?.name || recruiter?.fullName || "Recruteur";

    const candidature = await db.collection("candidatures").findOne({
      _id: new ObjectId(String(candidatureId)),
    });
    if (!candidature)
      return c.json({ message: "Candidature introuvable" }, 404);

    const candidateEmail =
      candidature?.email ||
      candidature?.extracted?.parsed?.email ||
      candidature?.extracted?.email ||
      "";
    const candidateName =
      candidature?.extracted?.parsed?.nom ||
      candidature?.extracted?.parsed?.name ||
      candidature?.nom ||
      candidature?.name ||
      "Candidat";

    const jobTitle = (job?.titre || job?.title || "Poste").trim();

    const start = new Date(`${proposedDate}T${proposedTime}:00`);
    const end = new Date(start.getTime() + 60 * 60 * 1000);

    const managerToken = randomToken();

    const doc = {
      type: "rh_technique",
      status: "PENDING_MANAGER_CONFIRMATION",

      candidatureId: new ObjectId(String(candidatureId)),
      jobOfferId: new ObjectId(String(jobOfferId)),

      recruiterId: new ObjectId(String(recruiterId)),
      responsableMetierId: new ObjectId(String(managerId)),

      recruiterName,
      recruiterEmail,
      responsibleName,
      responsibleEmail,

      candidateName,
      candidateEmail,
      jobTitle,

      proposedStart: start,
      proposedEnd: end,

      managerToken,
      candidateToken: null,

      outlook: {
        recruiterEventId: null,
        managerEventId: null,
      },

      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const ins = await db.collection("interviews").insertOne(doc);
    const insertedDoc = { ...doc, _id: ins.insertedId };

    // ✅ CREATE Outlook immédiatement pour recruteur + responsable
    await outlookCreateForBoth(db, insertedDoc, {
      title: `⏳ En attente — Entretien RH+Tech — ${candidateName}`,
      description: `Entretien avec ${candidateName} pour "${jobTitle}".\n⚠️ En attente confirmation responsable.`,
      start: start.toISOString(),
      end: end.toISOString(),
      location: "Bureau Optylab / Teams",
    });

    const { date, time } = formatFR(start);

    // Email manager: confirmer / modifier
    await sendInterviewConfirmationRequestToManager({
      responsibleEmail,
      responsibleName,
      recruiterName,
      candidateName,
      jobTitle,
      proposedDate: date,
      proposedTime: time,
      token: managerToken,
      interviewId: String(ins.insertedId),
    });

    return c.json({
      success: true,
      interviewId: String(ins.insertedId),
      message: "Email envoyé au responsable pour confirmation",
    });
  } catch (err) {
    console.error("❌ proposeRhTechInterviewController:", err);
    return c.json(
      { message: "Erreur serveur", error: String(err?.message || err) },
      500,
    );
  }
}

/* =========================
   3) POST /calendar/rh-tech/manager/confirm/:token
   responsable confirme => create outlook events + mail candidat (+ recruiter)
========================= */
export async function managerConfirmRhTechController(c) {
  try {
    const token = c.req.param("token");
    const db = getDB();

    const interview = await db
      .collection("interviews")
      .findOne({ managerToken: token });
    if (!interview) return c.json({ message: "Token invalide" }, 404);

    if (interview.status !== "PENDING_MANAGER_CONFIRMATION") {
      return c.json({ message: "Statut incompatible" }, 400);
    }

    const { date: d0, time: t0 } = formatFR(interview.proposedStart);

    // ✅ SUPPRIMER anciens events + CRÉER nouveaux "⏳ En attente candidat"
    const { recruiterEventId, managerEventId } =
      await outlookDeleteAndCreateForBoth(db, interview, {
        title: `⏳ En attente — Entretien RH+Tech — ${interview.candidateName}`,
        description: `Entretien avec ${interview.candidateName} pour "${interview.jobTitle}".\n📅 ${d0} à ${t0}\n⚠️ En attente confirmation candidat.`,
        start: new Date(interview.proposedStart).toISOString(),
        end: new Date(interview.proposedEnd).toISOString(),
        location: interview.location || "Bureau Optylab / Teams",
      });

    const candidateToken = randomToken();

    await db.collection("interviews").updateOne(
      { _id: interview._id },
      {
        $set: {
          status: "PENDING_CANDIDATE_CONFIRMATION",
          candidateToken,
          "outlook.recruiterEventId": recruiterEventId,
          "outlook.managerEventId": managerEventId,
          updatedAt: new Date(),
        },
      },
    );

    const { date, time } = formatFR(interview.proposedStart);

    // ✅ email candidat: confirmer / proposer autre date
    await sendInterviewConfirmedToCandidate({
      candidateEmail: interview.candidateEmail,
      candidateName: interview.candidateName,
      jobTitle: interview.jobTitle,
      recruiterName: interview.recruiterName,
      responsibleName: interview.responsibleName,
      date,
      time,
      token: candidateToken,
    });

    // ✅ email info recruteur (après confirmation responsable)
    await sendInterviewInfoToRecruiter({
      recruiterEmail: interview.recruiterEmail,
      recruiterName: interview.recruiterName,
      candidateName: interview.candidateName,
      jobTitle: interview.jobTitle,
      date,
      time,
      status: "Responsable confirmé - en attente candidat",
    });

    return c.json({
      success: true,
      message: "Confirmé. Email candidat envoyé.",
    });
  } catch (err) {
    console.error("❌ managerConfirmRhTechController:", err);
    return c.json(
      { message: "Erreur serveur", error: String(err?.message || err) },
      500,
    );
  }
}

/* =========================
   4) POST /calendar/rh-tech/manager/propose/:token
   responsable propose autre date => met à jour + email candidat (ou recruteur)
========================= */
export async function managerProposeNewRhTechController(c) {
  try {
    const token = c.req.param("token");
    const { proposedDate, proposedTime } = await c.req.json();

    if (!proposedDate || !proposedTime)
      return c.json({ message: "Champs manquants" }, 400);

    const db = getDB();
    const interview = await db
      .collection("interviews")
      .findOne({ managerToken: token });
    if (!interview) return c.json({ message: "Token invalide" }, 404);

    const start = new Date(`${proposedDate}T${proposedTime}:00`);
    const end = new Date(start.getTime() + 60 * 60 * 1000);

    const { date, time } = formatFR(start);

    // ✅ UPDATE les 2 events Outlook avec la nouvelle date
    await outlookUpdateForBoth(db, interview, {
      title: `⏳ En attente — Entretien RH+Tech — ${interview.candidateName}`,
      description: `Entretien avec ${interview.candidateName} pour "${interview.jobTitle}".\n📅 ${date} à ${time}\n⚠️ Nouvelle date proposée par le responsable.`,
      start: start.toISOString(),
      end: end.toISOString(),
      location: interview.location || "Bureau Optylab / Teams",
    });

    const recruiterReviewToken = randomToken();
    await db
      .collection("interviews")
      .updateOne(
        { _id: interview._id },
        {
          $set: {
            proposedStart: start,
            proposedEnd: end,
            status: "PENDING_RECRUITER_REVIEW",
            recruiterReviewToken,
            updatedAt: new Date(),
          },
        },
      );

    await sendRecruiterReviewEmail({
      recruiterEmail: interview.recruiterEmail,
      recruiterName: interview.recruiterName || "Recruteur",
      responsibleName: interview.responsibleName || "Responsable",
      candidateName: interview.candidateName,
      jobTitle: interview.jobTitle,
      date,
      time,
      token: recruiterReviewToken,
    });

    return c.json({
      success: true,
      message: "Nouvelle date proposée — recruteur notifié",
    });
  } catch (err) {
    console.error("❌ managerProposeNewRhTechController:", err);
    return c.json({ message: "Erreur serveur" }, 500);
  }
}

/* ── recruiterGetReviewController ── */
export async function recruiterGetReviewController(c) {
  try {
    const token = c.req.param("token");
    const db = getDB();
    const interview = await db
      .collection("interviews")
      .findOne({ recruiterReviewToken: token });
    if (!interview) return c.json({ message: "Token invalide ou expiré" }, 404);
    const { date, time } = formatFR(interview.proposedStart);
    return c.json({
      success: true,
      interview: {
        candidateName: interview.candidateName,
        jobTitle: interview.jobTitle,
        responsibleName: interview.responsibleName || "Responsable",
        date,
        time,
      },
    });
  } catch (err) {
    return c.json({ message: "Erreur serveur" }, 500);
  }
}

/* ── recruiterAcceptManagerProposalController ── */
export async function recruiterAcceptManagerProposalController(c) {
  try {
    const token = c.req.param("token");
    const db = getDB();
    const interview = await db
      .collection("interviews")
      .findOne({ recruiterReviewToken: token });
    if (!interview) return c.json({ message: "Token invalide ou expiré" }, 404);
    if (interview.status !== "PENDING_RECRUITER_REVIEW")
      return c.json({ message: "Statut incompatible" }, 400);
    const candidateToken = randomToken();
    await db
      .collection("interviews")
      .updateOne(
        { _id: interview._id },
        {
          $set: {
            status: "PENDING_CANDIDATE_CONFIRMATION",
            candidateToken,
            updatedAt: new Date(),
          },
          $unset: { recruiterReviewToken: "" },
        },
      );
    const { date, time } = formatFR(interview.proposedStart);
    await sendInterviewConfirmedToCandidate({
      candidateEmail: interview.candidateEmail,
      candidateName: interview.candidateName,
      jobTitle: interview.jobTitle,
      recruiterName: interview.recruiterName,
      responsibleName: interview.responsibleName || "Responsable",
      date,
      time,
      token: candidateToken,
    });
    return c.json({
      success: true,
      message: "Date acceptée. Email candidat envoyé.",
    });
  } catch (err) {
    return c.json({ message: "Erreur serveur" }, 500);
  }
}

/* ── recruiterProposeCounterController ── */
export async function recruiterProposeCounterController(c) {
  try {
    const token = c.req.param("token");
    const { proposedDate, proposedTime } = await c.req.json();
    if (!proposedDate || !proposedTime)
      return c.json({ message: "Champs manquants" }, 400);
    const db = getDB();
    const interview = await db
      .collection("interviews")
      .findOne({ recruiterReviewToken: token });
    if (!interview) return c.json({ message: "Token invalide ou expiré" }, 404);
    const start = new Date(`${proposedDate}T${proposedTime}:00`);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    const { date, time } = formatFR(start);
    await outlookUpdateForBoth(db, interview, {
      title: `⏳ En attente — Entretien RH+Tech — ${interview.candidateName}`,
      description: `Entretien avec ${interview.candidateName} pour "${interview.jobTitle}".\n📅 ${date} à ${time}\n⚠️ Contre-proposition recruteur.`,
      start: start.toISOString(),
      end: end.toISOString(),
      location: interview.location || "Bureau Optylab / Teams",
    });
    const newManagerToken = randomToken();
    await db
      .collection("interviews")
      .updateOne(
        { _id: interview._id },
        {
          $set: {
            proposedStart: start,
            proposedEnd: end,
            status: "PENDING_MANAGER_CONFIRMATION",
            managerToken: newManagerToken,
            updatedAt: new Date(),
          },
          $unset: { recruiterReviewToken: "" },
        },
      );
    await sendInterviewConfirmationRequestToManager({
      responsibleEmail: interview.responsibleEmail,
      responsibleName: interview.responsibleName || "Responsable",
      recruiterName: interview.recruiterName,
      candidateName: interview.candidateName,
      jobTitle: interview.jobTitle,
      proposedDate: date,
      proposedTime: time,
      token: newManagerToken,
      interviewId: String(interview._id),
    });
    return c.json({ success: true, message: "Contre-proposition envoyée" });
  } catch (err) {
    return c.json({ message: "Erreur serveur" }, 500);
  }
}

/* ── candidateGetSlotsController ── créneaux libres APRÈS la date planifiée ── */
export async function candidateGetSlotsController(c) {
  try {
    const token = c.req.param("token");
    const { days = 14 } = c.req.query();
    const db = getDB();

    const interview = await db
      .collection("interviews")
      .findOne({ candidateToken: token });
    if (!interview) return c.json({ message: "Lien invalide ou expiré" }, 404);

    // ✅ Commence 3 jours après la date planifiée (pas aujourd'hui)
    const proposedDate = new Date(interview.proposedStart);
    proposedDate.setDate(proposedDate.getDate() + 2); // startDate = proposedDate + 2 (buildCandidateSlots ajoute +1)

    const slots = buildCandidateSlots({
      startDate: proposedDate,
      days: Number(days) || 14,
    });

    // Filtrer avec Outlook si connecté
    try {
      const rTok = await getValidToken(String(interview.recruiterId));
      const mTok = await getValidToken(String(interview.responsableMetierId));
      if (rTok && mTok) {
        const startRange = new Date(proposedDate);
        const endRange = new Date(proposedDate);
        endRange.setDate(endRange.getDate() + (Number(days) || 14) + 7);
        const [rawR, rawM] = await Promise.all([
          graphService.getOutlookEvents(
            rTok,
            startRange.toISOString(),
            endRange.toISOString(),
          ),
          graphService.getOutlookEvents(
            mTok,
            startRange.toISOString(),
            endRange.toISOString(),
          ),
        ]);
        const busyR = normalizeEvents(rawR);
        const busyM = normalizeEvents(rawM);
        const filtered = slots.filter(
          (s) => isSlotFree(s, busyR) && isSlotFree(s, busyM),
        );
        return c.json({
          slots: filtered,
          total: filtered.length,
          outlookConnected: true,
        });
      }
    } catch (e) {
      console.warn("⚠️ Outlook slots fetch:", e?.message);
    }

    return c.json({ slots, total: slots.length, outlookConnected: false });
  } catch (err) {
    console.error("❌ candidateGetSlotsController:", err);
    return c.json({ slots: [], error: "Erreur serveur" }, 500);
  }
}

/* ── candidateGetInfoController ── */
export async function candidateGetInfoController(c) {
  try {
    const token = c.req.param("token");
    const db = getDB();
    const interview = await db
      .collection("interviews")
      .findOne({ candidateToken: token });
    if (!interview) return c.json({ message: "Lien invalide ou expiré" }, 404);
    const { date, time } = formatFR(interview.proposedStart);
    return c.json({
      success: true,
      interview: {
        candidateName: interview.candidateName,
        jobTitle: interview.jobTitle,
        recruiterName: interview.recruiterName || "",
        responsibleName: interview.responsibleName || "",
        date,
        time,
      },
    });
  } catch (err) {
    return c.json({ message: "Erreur serveur" }, 500);
  }
}

/* =========================
   5) POST /calendar/rh-tech/candidate/confirm/:token
   candidat confirme => finaliser + mail recruteur + mail candidat
========================= */
export async function candidateConfirmRhTechController(c) {
  try {
    const token = c.req.param("token");
    const db = getDB();

    const interview = await db
      .collection("interviews")
      .findOne({ candidateToken: token });
    if (!interview) return c.json({ message: "Token invalide" }, 404);

    if (interview.status !== "PENDING_CANDIDATE_CONFIRMATION") {
      return c.json({ message: "Statut incompatible" }, 400);
    }

    await db
      .collection("interviews")
      .updateOne(
        { _id: interview._id },
        { $set: { status: "CONFIRMED", updatedAt: new Date() } },
      );
    // ✅ Rappels mail candidat (3 jours / 1 jour / 3 heures)
    await scheduleInterviewReminders(db, {
      ...interview,
      startAt: interview.proposedStart, // وقت entretien النهائي
    });

    const { date, time } = formatFR(interview.proposedStart);

    // ✅ UPDATE Outlook → "✅ Confirmé"
    await outlookUpdateForBoth(db, interview, {
      title: `✅ Confirmé — Entretien RH+Tech — ${interview.candidateName}`,
      description: `Entretien avec ${interview.candidateName} pour "${interview.jobTitle}".\n📅 ${date} à ${time}\n✅ Confirmé par le candidat.`,
      start: new Date(interview.proposedStart).toISOString(),
      end: new Date(interview.proposedEnd).toISOString(),
      location: interview.location || "Bureau Optylab / Teams",
    });

    // ✅ Email recruteur : entretien confirmé définitivement
    await sendInterviewInfoToRecruiter({
      recruiterEmail: interview.recruiterEmail,
      recruiterName: interview.recruiterName,
      candidateName: interview.candidateName,
      jobTitle: interview.jobTitle,
      date,
      time,
      status: "✅ Candidat a confirmé — Entretien définitivement planifié",
    });

    return c.json({ success: true, message: "Entretien confirmé" });
  } catch (err) {
    console.error("❌ candidateConfirmRhTechController:", err);
    return c.json({ message: "Erreur serveur" }, 500);
  }
}

/* =========================
   6) POST /calendar/rh-tech/candidate/propose/:token
   candidat propose autre date => email responsable d’abord
========================= */
export async function candidateProposeNewRhTechController(c) {
  try {
    const token = c.req.param("token");
    const { proposedDate, proposedTime } = await c.req.json();

    if (!proposedDate || !proposedTime)
      return c.json({ message: "Champs manquants" }, 400);

    const db = getDB();
    const interview = await db
      .collection("interviews")
      .findOne({ candidateToken: token });
    if (!interview) return c.json({ message: "Token invalide" }, 404);

    const start = new Date(`${proposedDate}T${proposedTime}:00`);
    const end = new Date(start.getTime() + 60 * 60 * 1000);

    // 👉 IMPORTANT: on remet en attente manager d’abord
    const newManagerToken = randomToken();

    // ✅ UPDATE Outlook avec la nouvelle date proposée par candidat
    await outlookUpdateForBoth(db, interview, {
      title: `⏳ En attente — Entretien RH+Tech — ${interview.candidateName}`,
      description: `Entretien avec ${interview.candidateName} pour "${interview.jobTitle}".\n⚠️ Nouvelle date proposée par le candidat — en attente confirmation responsable.`,
      start: start.toISOString(),
      end: end.toISOString(),
      location: interview.location || "Bureau Optylab / Teams",
    });

    await db.collection("interviews").updateOne(
      { _id: interview._id },
      {
        $set: {
          proposedStart: start,
          proposedEnd: end,
          status: "PENDING_MANAGER_CONFIRMATION",
          managerToken: newManagerToken,
          candidateProposed: true, // ✅ flag : candidat a proposé cette date
          updatedAt: new Date(),
        },
        $unset: { candidateToken: "" },
      },
    );

    const { date, time } = formatFR(start);

    // Email responsable pour confirmer la nouvelle date proposée par candidat
    await sendInterviewConfirmationRequestToManager({
      responsibleEmail: interview.responsibleEmail,
      responsibleName: interview.responsibleName,
      recruiterName: interview.recruiterName,
      candidateName: interview.candidateName,
      jobTitle: interview.jobTitle,
      proposedDate: date,
      proposedTime: time,
      token: newManagerToken,
      interviewId: String(interview._id),
    });

    // ❌ recruteur ne reçoit rien tant que manager n’a pas confirmé (comme tu veux)
    return c.json({
      success: true,
      message: "Proposition envoyée au responsable",
    });
  } catch (err) {
    console.error("❌ candidateProposeNewRhTechController:", err);
    return c.json({ message: "Erreur serveur" }, 500);
  }
}

/**
 * ✅ GET /calendar/interview/:id
 * Retourne les infos interview pour le recruteur/admin
 */
export async function getInterviewByIdController(c) {
  try {
    const { id } = c.req.param();
    const user = c.get("user");

    if (!ObjectId.isValid(id)) return c.json({ error: "ID invalide" }, 400);

    const db = getDB();
    const iv = await db
      .collection("interviews")
      .findOne({ _id: new ObjectId(id) });
    if (!iv) return c.json({ error: "Interview introuvable" }, 404);

    // ✅ Autorisation souple : tout user authentifié (verifyToken) peut accéder

    return c.json({
      interview: {
        _id: String(iv._id),
        candidateName: iv.candidateName || "",
        candidateEmail: iv.candidateEmail || "",
        jobTitle: iv.jobTitle || "Poste à définir",
        location: iv.location || "Optylab / Teams",
        proposedDate: iv.proposedDate || null,
        proposedTime:
          iv.proposedTime ||
          (iv.proposedDate ? formatTimeFR(iv.proposedDate) : null),
        status: iv.status,
        candidateRescheduleReason: iv.candidateRescheduleReason || "",
        candidatePreferredSlot: iv.candidatePreferredSlot || null,
      },
    });
  } catch (err) {
    console.error("❌ getInterviewByIdController:", err);
    return c.json({ error: "Erreur serveur" }, 500);
  }
}

/**
 * ✅ GET /calendar/interview/:id/free-slots
 * 3 jours ouvrés (J+3 après date entretien) => slots 10-11 & 11-12 (durée 1h)
 * Filtre selon Outlook (si connecté)
 */
export async function getRecruiterFreeSlotsController(c) {
  try {
    const { id } = c.req.param();
    const user = c.get("user");

    if (!ObjectId.isValid(id)) return c.json({ error: "ID invalide" }, 400);

    const db = getDB();
    const iv = await db
      .collection("interviews")
      .findOne({ _id: new ObjectId(id) });
    if (!iv) return c.json({ error: "Interview introuvable" }, 404);

    // ✅ Autorisation souple : tout user authentifié peut consulter les créneaux

    // ✅ base = date entretien + 3 jours
    const base = new Date(iv.proposedDate || Date.now());
    base.setDate(base.getDate() + 3);
    base.setHours(0, 0, 0, 0);

    // ✅ generate wantedSlots: 3 jours ouvrés, 10-11 & 11-12
    const wantedSlots = [];
    let addedDays = 0;
    let cursor = new Date(base);

    while (addedDays < 3) {
      const dayOfWeek = cursor.getDay(); // 0 dimanche, 6 samedi
      if (dayOfWeek !== 0 && dayOfWeek !== 6) {
        const dateStr = cursor.toISOString().split("T")[0];

        wantedSlots.push(
          {
            date: dateStr,
            time: "10:00",
            startISO: `${dateStr}T10:00:00`,
            endISO: `${dateStr}T11:00:00`,
          },
          {
            date: dateStr,
            time: "11:00",
            startISO: `${dateStr}T11:00:00`,
            endISO: `${dateStr}T12:00:00`,
          },
        );

        addedDays++;
      }
      cursor.setDate(cursor.getDate() + 1);
    }

    // ✅ Outlook token recruteur
    const recToken = await getValidToken(String(iv.assignedUserId || user?.id));

    // Outlook not connected => return unfiltered
    if (!recToken) {
      return c.json({
        slots: wantedSlots,
        outlookConnected: false,
        total: wantedSlots.length,
      });
    }

    // Fetch busy events for range base -> base + 10 days
    let busyEvents = [];
    try {
      const startRange = new Date(base);
      const endRange = new Date(base);
      endRange.setDate(endRange.getDate() + 10);

      busyEvents = await graphService.getOutlookEvents(
        recToken,
        startRange.toISOString(),
        endRange.toISOString(),
      );
    } catch (e) {
      console.warn("⚠️ Outlook fetch error:", e?.message);
      // si outlook fail => fallback no filtering
      return c.json({
        slots: wantedSlots,
        outlookConnected: true,
        total: wantedSlots.length,
        warning: "Outlook fetch failed, returned unfiltered slots",
      });
    }

    // Filter out busy slots
    const freeSlots = wantedSlots.filter((slot) => {
      const slotStart = new Date(slot.startISO);
      const slotEnd = new Date(slot.endISO);

      return !busyEvents.some((ev) => {
        const evStart = new Date(ev.start || ev.startDate);
        const evEnd = new Date(ev.end || ev.endDate);
        return slotStart < evEnd && slotEnd > evStart;
      });
    });

    return c.json({
      slots: freeSlots,
      outlookConnected: true,
      total: freeSlots.length,
    });
  } catch (err) {
    console.error("❌ getRecruiterFreeSlotsController:", err);
    return c.json({ error: "Erreur serveur" }, 500);
  }
}
// ── Helper token avec refresh ─────────────────────────────────
async function getValidToken(userId, opts = {}) {
  const { forceRefresh = false } = opts;

  const db = getDB();
  const rec = await db.collection("user_calendar_tokens").findOne({
    userId: String(userId),
    provider: "microsoft",
    connected: true,
  });
  if (!rec) return null;

  const MARGIN = 5 * 60 * 1000;
  const expiredByTime =
    !rec.expiresAt || new Date(rec.expiresAt).getTime() - Date.now() < MARGIN;

  if (forceRefresh || expiredByTime) {
    try {
      const result = await graphService.refreshAccessToken(rec.refreshToken);

      await db.collection("user_calendar_tokens").updateOne(
        { userId: String(userId), provider: "microsoft" },
        {
          $set: {
            accessToken: result.accessToken,
            refreshToken: result.refreshToken,
            expiresAt: new Date(Date.now() + (result.expiresIn || 3600) * 1000),
            connected: true,
          },
        },
      );

      return result.accessToken;
    } catch (e) {
      // si refresh échoue => session morte
      await db
        .collection("user_calendar_tokens")
        .updateOne(
          { userId: String(userId), provider: "microsoft" },
          { $set: { connected: false } },
        );
      return null;
    }
  }

  return rec.accessToken;
}

// ── Générer token unique pour lien candidat ───────────────────
function generateToken() {
  return (
    Math.random().toString(36).slice(2) +
    Math.random().toString(36).slice(2) +
    Date.now().toString(36)
  );
}

// ================================================================
//  GET /interviews/rh-slots
//  Retourne les créneaux libres 10h→12h du recruteur (Outlook)
//  sur les 7 prochains jours ouvrés
// ================================================================
export async function getRhSlotsController(c) {
  try {
    const recruiterId = c.get("user")?.id;
    if (!recruiterId) return c.json({ slots: [] }, 401);

    const token = await getValidToken(String(recruiterId));

    // Générer créneaux 10h et 11h sur 7 jours ouvrés
    const allSlots = [];
    for (let d = 1; d <= 10; d++) {
      const day = new Date();
      day.setDate(day.getDate() + d);
      day.setHours(0, 0, 0, 0);
      if (day.getDay() === 0 || day.getDay() === 6) continue; // week-end
      if (allSlots.length >= 14) break; // 7 jours * 2 créneaux = 14 max

      const dateStr = day.toISOString().split("T")[0];
      allSlots.push(
        {
          date: dateStr,
          time: "10:00",
          startISO: `${dateStr}T10:00:00`,
          endISO: `${dateStr}T11:00:00`,
        },
        {
          date: dateStr,
          time: "11:00",
          startISO: `${dateStr}T11:00:00`,
          endISO: `${dateStr}T12:00:00`,
        },
      );
    }

    if (!token) {
      // Pas connecté Outlook → retourner les créneaux sans filtrage
      return c.json({ slots: allSlots, outlookConnected: false });
    }

    // Récupérer les événements Outlook du recruteur
    let busyEvents = [];
    try {
      const startDate = new Date();
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + 11);
      busyEvents = await graphService.getOutlookEvents(
        token,
        startDate.toISOString(),
        endDate.toISOString(),
      );
    } catch (e) {
      console.warn("⚠️ Outlook fetch error:", e?.message);
    }

    // Filtrer les créneaux occupés
    const freeSlots = allSlots.filter((slot) => {
      const slotStart = new Date(slot.startISO);
      const slotEnd = new Date(slot.endISO);
      return !busyEvents.some((ev) => {
        const evStart = new Date(ev.start || ev.startDate);
        const evEnd = new Date(ev.end || ev.endDate);
        return slotStart < evEnd && slotEnd > evStart;
      });
    });

    return c.json({
      slots: freeSlots,
      outlookConnected: true,
      total: freeSlots.length,
    });
  } catch (err) {
    console.error("❌ getRhSlotsController:", err);
    return c.json({ slots: [], outlookConnected: false }, 500);
  }
}

// ================================================================
//  POST /calendar/events/interview
//  Corps: { candidatureId, jobOfferId, candidateName, candidateEmail,
//            jobTitle, start, end, notes, sendEmailToCandidate }
//  1. Crée l'événement dans Outlook du recruteur
//  2. Stocke l'entretien en DB (collection interviews)
//  3. Envoie email au candidat avec lien confirmer / proposer autre date
// ================================================================
export async function createInterviewEventController(c) {
  try {
    const recruiterId = c.get("user")?.id;
    const body = await c.req.json();

    const {
      candidatureId,
      jobOfferId,
      candidateName,
      candidateEmail,
      jobTitle,
      start,
      end,
      notes,
      sendEmailToCandidate = true,
    } = body;

    if (!start || !end || !candidatureId) {
      return c.json({ error: "start, end et candidatureId requis" }, 400);
    }

    const token = await getValidToken(String(recruiterId));

    // ── 1. Créer l'événement dans Outlook ──────────────────────
    let outlookEvent = null;
    if (token) {
      try {
        outlookEvent = await graphService.createOutlookEvent(token, {
          title: `⏳ En attente — Entretien RH — ${candidateName || "Candidat"}`,
          description: `Entretien RH avec ${candidateName || "Candidat"} pour le poste "${jobTitle || ""}".\n\n${notes || ""}\n\n⚠️ En attente de confirmation du candidat.`,
          start,
          end,
          location: notes?.includes("http") ? notes : "Bureau Optylab / Teams",
        });

        // Sync en DB calendar_events
        await getDB()
          .collection("calendar_events")
          .insertOne({
            userId: String(recruiterId),
            outlookId: outlookEvent?.outlookId || null,
            title: `⏳ En attente — Entretien RH — ${candidateName || "Candidat"}`,
            description: notes || "",
            startDate: new Date(start),
            endDate: new Date(end),
            source: "app",
            type: "interview_rh",
            candidatureId: ObjectId.isValid(candidatureId)
              ? new ObjectId(candidatureId)
              : null,
            createdAt: new Date(),
            syncedAt: new Date(),
            status: "scheduled",
          });
      } catch (e) {
        console.warn("⚠️ Outlook event creation failed:", e?.message);
      }
    }

    // ── 2. Créer l'entretien en DB ─────────────────────────────
    const confirmToken = generateToken();
    const rescheduleToken = generateToken();

    // Trouver responsable de l'offre
    let assignedUserId = recruiterId;
    let assignedUserEmail = null;
    try {
      const job = await findJobOfferById(jobOfferId);
      if (job?.assignedUserIds?.length > 0) {
        assignedUserId = job.assignedUserIds[0];
        const recruiterRec = await getDB()
          .collection("users")
          .findOne({ _id: new ObjectId(String(assignedUserId)) });
        assignedUserEmail = recruiterRec?.email || null;
      }
    } catch {}

    // ✅ Snapshots pour éviter "Poste à définir" plus tard
    const jobTitleSnapshot = (jobTitle || "").trim() || "Poste à définir";
    const locationSnapshot = notes?.includes("http")
      ? "Teams"
      : "Optylab / Teams";

    const interviewDoc = {
      candidatureId: ObjectId.isValid(candidatureId)
        ? new ObjectId(candidatureId)
        : null,
      jobOfferId:
        jobOfferId && ObjectId.isValid(jobOfferId)
          ? new ObjectId(jobOfferId)
          : null,

      // ✅ AJOUTS (snapshots)
      jobTitle: jobTitleSnapshot,
      location: locationSnapshot,

      candidateEmail: candidateEmail || "",
      candidateName: candidateName || "",
      assignedUserId: ObjectId.isValid(String(assignedUserId))
        ? new ObjectId(String(assignedUserId))
        : null,
      assignedUserEmail,
      type: "rh",
      proposedDate: new Date(start),
      proposedTime: new Date(start).toLocaleTimeString("fr-FR", {
        hour: "2-digit",
        minute: "2-digit",
      }),
      confirmedDate: null,
      status: "PENDING_CANDIDATE_CONFIRMATION",
      confirmToken,
      rescheduleToken,
      outlookEventId: outlookEvent?.outlookId || null,
      notes: notes || "",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await getDB()
      .collection("interviews")
      .insertOne(interviewDoc);
    const interviewId = result.insertedId;

    // Stocker référence sur la candidature
    await getDB()
      .collection("candidatures")
      .updateOne(
        {
          _id: ObjectId.isValid(candidatureId)
            ? new ObjectId(candidatureId)
            : null,
        },
        {
          $set: {
            "entretiens.rhScheduled": true,
            "entretiens.rhDate": new Date(start),
            "entretiens.rhInterviewId": interviewId,
            updatedAt: new Date(),
          },
        },
      );

    // ── 3. Email au candidat ───────────────────────────────────
    let emailSent = false;
    let emailError = null;

    console.log("📧 [EMAIL] candidateEmail =", candidateEmail);
    console.log("📧 [EMAIL] sendEmailToCandidate =", sendEmailToCandidate);
    console.log(
      "📧 [EMAIL] MAIL_USER =",
      process.env.MAIL_USER ? "✅ SET" : "❌ NOT SET",
    );
    console.log(
      "📧 [EMAIL] MAIL_PASS =",
      process.env.MAIL_PASS ? "✅ SET" : "❌ NOT SET",
    );
    console.log(
      "📧 [EMAIL] FRONTEND_URL =",
      process.env.FRONTEND_URL || "❌ NOT SET → fallback localhost:3000",
    );

    if (candidateEmail && sendEmailToCandidate) {
      const FRONTEND = process.env.FRONTEND_URL || "http://localhost:3000";
      const confirmUrl = `${FRONTEND}/candidat/interview/confirm/${confirmToken}`;
      const rescheduleUrl = `${FRONTEND}/candidat/interview/reschedule/${rescheduleToken}`;

      const dateFormatted = new Date(start).toLocaleDateString("fr-FR", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      });
      const timeFormatted = new Date(start).toLocaleTimeString("fr-FR", {
        hour: "2-digit",
        minute: "2-digit",
      });

      try {
        console.log("📧 [EMAIL] Calling sendInterviewInviteToCandidate...");
        await sendInterviewInviteToCandidate({
          candidateEmail,
          candidateName: candidateName || "Candidat",
          jobTitle: jobTitleSnapshot, // ✅ utilise le snapshot
          dateFormatted,
          timeFormatted,
          notes: notes || "",
          confirmUrl,
          rescheduleUrl,
        });
        emailSent = true;
        console.log("✅ [EMAIL] Sent successfully to:", candidateEmail);
      } catch (e) {
        emailError = e?.message || String(e);
        console.error("❌ [EMAIL] FAILED !");
        console.error("❌ [EMAIL] Error:", emailError);
        console.error("❌ [EMAIL] Code:", e?.code);
        console.error("❌ [EMAIL] Response:", e?.response);
        console.error("❌ [EMAIL] Full stack:", e?.stack);
      }
    } else if (!candidateEmail) {
      console.warn("⚠️ [EMAIL] candidateEmail is empty — email skipped");
    } else {
      console.warn("⚠️ [EMAIL] sendEmailToCandidate=false — email skipped");
    }

    return c.json(
      {
        success: true,
        emailSent: !emailError,
        emailError: emailError || null,
        event: {
          _id: String(interviewId),
          outlookId: outlookEvent?.outlookId || null,
          start,
          end,
          type: "rh",
          status: "PENDING_CANDIDATE_CONFIRMATION",
        },
      },
      201,
    );
  } catch (err) {
    console.error("❌ createInterviewEventController:", err);
    return c.json({ error: "Erreur serveur", detail: err.message }, 500);
  }
}

// ================================================================
//  POST /interview/confirm/:confirmToken
//  Candidat confirme l'entretien → update DB
// ================================================================
export async function candidateConfirmRhController(c) {
  try {
    const { confirmToken } = c.req.param();
    const db = getDB();

    // ✅ نلقى interview بالـ token الحالي
    const iv = await db.collection("interviews").findOne({ confirmToken });
    if (!iv) {
      // 👇 optional: نحاول نلقى آخر token مرتبط (إذا تحب صفحة “date تبدلت” بدل 404)
      return c.json({ error: "Lien invalide ou expiré" }, 404);
    }

    const proposedStart = iv.proposedDate ? new Date(iv.proposedDate) : null;
    const proposedEnd = proposedStart
      ? new Date(proposedStart.getTime() + 60 * 60 * 1000)
      : null;

    // ✅ Update DB interview
    await db.collection("interviews").updateOne(
      { _id: iv._id },
      {
        $set: {
          status: "CONFIRMED",
          confirmedDate: new Date(), // timestamp confirmation (نخليها كيما هي)
          updatedAt: new Date(),
          // ✅ optional: نخزّن التاريخ المؤكد (باش ما يضيعش)
          confirmedSlot: proposedStart,
        },
        $push: {
          history: {
            at: new Date(),
            by: "candidate",
            type: "CONFIRMED",
            message: "Candidat a confirmé la date proposée.",
            date: proposedStart,
          },
        },
      },
    );
    // ✅ Rappels mail candidat (3 jours / 1 jour / 3 heures)
await scheduleInterviewReminders(db, {
  ...iv,
  startAt: iv.proposedDate || iv.proposedStart, // حسب اللي موجود عندك
});

    // ✅ Update Outlook event + calendar_events
    try {
      const recruiterToken = await getValidToken(String(iv.assignedUserId));
      if (recruiterToken && iv.outlookEventId && proposedStart && proposedEnd) {
        const dateLabel = proposedStart.toLocaleDateString("fr-FR", {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
        });
        const timeLabel = proposedStart.toLocaleTimeString("fr-FR", {
          hour: "2-digit",
          minute: "2-digit",
        });

        await graphService.updateOutlookEvent(
          recruiterToken,
          iv.outlookEventId,
          {
            title: `✅ Confirmé — Entretien RH — ${iv.candidateName || "Candidat"}`,
            description:
              `Entretien RH avec ${iv.candidateName || "Candidat"} pour le poste "${iv.jobTitle || ""}".\n\n` +
              `📅 ${dateLabel} à ${timeLabel}\n` +
              `📍 ${iv.location || "Optylab / Teams"}\n\n` +
              `✅ Confirmé par le candidat.`,
            start: proposedStart.toISOString(),
            end: proposedEnd.toISOString(),
            location: iv.location || "Optylab / Teams",
          },
        );

        // ✅ مهم: حدّث start/end في DB calendar_events
        await db.collection("calendar_events").updateOne(
          { outlookId: iv.outlookEventId },
          {
            $set: {
              title: `✅ Confirmé — Entretien RH — ${iv.candidateName || "Candidat"}`,
              status: "confirmed",
              startDate: proposedStart,
              endDate: proposedEnd,
              syncedAt: new Date(),
            },
          },
        );
      }
    } catch (e) {
      console.warn("⚠️ Outlook confirm update failed:", e?.message);
    }

    // ✅ Notifications (نخليهم كما عندك)
    try {
      await db.collection("notifications").insertOne({
        userId: iv.assignedUserId,
        type: "INTERVIEW_CONFIRMED",
        title: "Entretien confirmé",
        message: `${iv.candidateName} a confirmé l'entretien.`,
        read: false,
        createdAt: new Date(),
      });
    } catch {}

    return c.json({ success: true, message: "Entretien confirmé !" });
  } catch (err) {
    console.error("❌ candidateConfirmRhController:", err);
    return c.json({ error: "Erreur serveur" }, 500);
  }
}
// ================================================================
//  POST /interview/reschedule/:rescheduleToken
//  Candidat propose une autre date → envoie 3 créneaux alternatifs au candidat
//  et notifie le recruteur
// ================================================================
export async function candidateRescheduleRhController(c) {
  try {
    const { rescheduleToken } = c.req.param();

    // ✅ NEW: reason + selectedStartISO (créneau préféré)
    const { reason, selectedStartISO } = await c.req.json().catch(() => ({}));

    const db = getDB();

    // 1) Find interview by token
    const iv = await db.collection("interviews").findOne({ rescheduleToken });
    if (!iv) return c.json({ error: "Lien invalide ou expiré" }, 404);

    // 2) Update interview status + reason + preferred slot
    await db.collection("interviews").updateOne(
      { rescheduleToken },
      {
        $set: {
          status: "CANDIDATE_REQUESTED_RESCHEDULE",
          candidateRescheduleReason: (reason || "").trim(),
          candidateRescheduleAt: new Date(),
          candidatePreferredSlot: selectedStartISO
            ? new Date(selectedStartISO)
            : null, // ✅ NEW
          updatedAt: new Date(),
        },
      },
    );

    // 3) Resolve recruiter email if missing (optional but recommended)
    let recruiterEmail = iv.assignedUserEmail || null;
    let recruiterName = iv.assignedUserName || "Responsable";

    if (!recruiterEmail && iv.assignedUserId) {
      try {
        const rec = await db.collection("users").findOne({
          _id: new ObjectId(String(iv.assignedUserId)),
        });
        recruiterEmail = rec?.email || null;
        recruiterName = rec?.name || rec?.fullName || recruiterName;
      } catch {}
    }

    // 4) Notify recruiter/admin: notification + email
    // ✅ Update Outlook + calendar_events to show "Report demandé"
    try {
      const recruiterToken = await getValidToken(String(iv.assignedUserId));
      if (recruiterToken && iv.outlookEventId) {
        await graphService.updateOutlookEvent(
          recruiterToken,
          iv.outlookEventId,
          {
            title: `🟠 Report demandé — Entretien RH — ${iv.candidateName || "Candidat"}`,
            description:
              `🟠 Le candidat a demandé un report.\n\n` +
              `Raison: ${(reason || "").trim() || "—"}\n` +
              `Créneau préféré: ${selectedStartISO || "—"}\n\n` +
              `⚠️ En attente d’une nouvelle proposition/validation.`,
          },
        );

        await db.collection("calendar_events").updateOne(
          { outlookId: iv.outlookEventId },
          {
            $set: {
              title: `🟠 Report demandé — Entretien RH — ${iv.candidateName || "Candidat"}`,
              status: "pending_reschedule",
              syncedAt: new Date(),
            },
          },
        );
      }
    } catch (e) {
      console.warn("⚠️ Outlook reschedule title update failed:", e?.message);
    }

    // ✅ IMPORTANT: ما عادش نبعتو أي créneaux للـ candidat هنا
    return c.json({ success: true });
  } catch (err) {
    console.error("❌ candidateRescheduleRhController:", err);
    return c.json({ error: "Erreur serveur" }, 500);
  }
}

export async function getRescheduleInfoController(c) {
  try {
    const { rescheduleToken } = c.req.param();
    const db = getDB();

    const iv = await db.collection("interviews").findOne({ rescheduleToken });
    if (!iv) return c.json({ error: "Lien invalide ou expiré" }, 404);

    // ✅ base = date entretien + 3 jours
    const base = new Date(iv.proposedDate || Date.now());
    base.setDate(base.getDate() + 3);
    base.setHours(0, 0, 0, 0);

    const isWeekend = (d) => d.getDay() === 0 || d.getDay() === 6;

    // ✅ إذا base في weekend نقفز لنهار خدمة
    while (isWeekend(base)) {
      base.setDate(base.getDate() + 1);
    }

    // ✅ helper: format local YYYY-MM-DD (بدون UTC)
    const toLocalDateStr = (d) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    };

    // ✅ helper: يبني Date محلي (YYYY-MM-DD + hour)
    const makeLocalDateTime = (dateObj, hour) => {
      const dt = new Date(dateObj);
      dt.setHours(hour, 0, 0, 0); // local time
      return dt;
    };

    // ✅ 3 أيام عمل * (10-11) و (11-12) مدة 1h
    const wantedSlots = [];
    let addedBusinessDays = 0;
    let cursor = new Date(base);

    while (addedBusinessDays < 3) {
      if (!isWeekend(cursor)) {
        const dateStr = toLocalDateStr(cursor);

        const s10 = makeLocalDateTime(cursor, 10);
        const e10 = makeLocalDateTime(cursor, 11);

        const s11 = makeLocalDateTime(cursor, 11);
        const e11 = makeLocalDateTime(cursor, 12);

        wantedSlots.push(
          {
            date: dateStr,
            time: "10:00",
            startISO: s10.toISOString(),
            endISO: e10.toISOString(),
          },
          {
            date: dateStr,
            time: "11:00",
            startISO: s11.toISOString(),
            endISO: e11.toISOString(),
          },
        );

        addedBusinessDays++;
      }

      cursor.setDate(cursor.getDate() + 1);
    }

    // Token outlook recruteur
    const recToken = await getValidToken(String(iv.assignedUserId));

    // Si Outlook non connecté => pas de filtrage
    if (!recToken) {
      return c.json({
        interview: {
          candidateName: iv.candidateName,
          jobTitle: iv.jobTitle || "Poste à définir",
          date: iv.proposedDate,
          time: iv.proposedTime,
          location: iv.location || "Optylab / Teams",
          status: iv.status,
        },
        slots: wantedSlots,
        outlookConnected: false,
      });
    }

    // Récupérer events occupés (range base → base+10 jours)
    let busyEvents = [];
    try {
      const startRange = new Date(base);
      const endRange = new Date(base);
      endRange.setDate(endRange.getDate() + 10);

      busyEvents = await graphService.getOutlookEvents(
        recToken,
        startRange.toISOString(),
        endRange.toISOString(),
      );
    } catch (e) {
      console.warn("⚠️ Outlook fetch error:", e?.message);
    }

    // Filtrer slots occupés (overlap)
    const freeSlots = wantedSlots.filter((slot) => {
      const slotStart = new Date(slot.startISO);
      const slotEnd = new Date(slot.endISO);

      return !busyEvents.some((ev) => {
        const evStart = new Date(ev.start || ev.startDate);
        const evEnd = new Date(ev.end || ev.endDate);
        return slotStart < evEnd && slotEnd > evStart;
      });
    });

    return c.json({
      interview: {
        candidateName: iv.candidateName,
        jobTitle: iv.jobTitle || "Poste à définir",
        date: iv.proposedDate,
        time: iv.proposedTime,
        location: iv.location || "Optylab / Teams",
        status: iv.status,
      },
      slots: freeSlots,
      outlookConnected: true,
      total: freeSlots.length,
    });
  } catch (err) {
    console.error("❌ getRescheduleInfoController:", err);
    return c.json({ error: "Erreur serveur" }, 500);
  }
}

export async function recruiterProposeNewSlotController(c) {
  try {
    const { id } = c.req.param();
    const recruiterId = c.get("user")?.id;
    const { startISO } = await c.req.json().catch(() => ({}));

    if (!ObjectId.isValid(id)) return c.json({ error: "ID invalide" }, 400);
    if (!recruiterId) return c.json({ error: "Non autorisé" }, 401);
    if (!startISO) return c.json({ error: "startISO requis" }, 400);

    const db = getDB();

    const iv = await db
      .collection("interviews")
      .findOne({ _id: new ObjectId(id) });

    if (!iv) return c.json({ error: "Interview introuvable" }, 404);

    // ✅ parse date
    const start = new Date(startISO);
    if (isNaN(start.getTime()))
      return c.json({ error: "startISO invalide" }, 400);

    // ✅ durée 1h
    const end = new Date(start);
    end.setHours(end.getHours() + 1);

    const proposedTime = start.toLocaleTimeString("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
    });

    const dateFormatted = start.toLocaleDateString("fr-FR", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });

    // ✅ NEW confirm token (باش lien القديم يولي invalid)
    const newConfirmToken = generateToken();

    // ─────────────────────────────────────────────
    // 1) OUTLOOK: UPDATE OR CREATE EVENT
    // ─────────────────────────────────────────────
    let outlookUpdated = false;
    let newOutlookEventId = iv.outlookEventId || null;

    try {
      const recToken = await getValidToken(String(recruiterId));

      if (recToken) {
        const payload = {
          title: `⏳ En attente — Entretien RH — ${iv.candidateName || "Candidat"}`,
          description:
            `Entretien RH avec ${iv.candidateName || "Candidat"} pour le poste "${iv.jobTitle || ""}".\n\n` +
            `${iv.notes || ""}\n\n` +
            `⚠️ En attente de confirmation du candidat.\n` +
            `📅 ${dateFormatted} à ${proposedTime}\n` +
            `📍 ${iv.location || "Bureau Optylab / Teams"}`,
          start: start.toISOString(),
          end: end.toISOString(),
          location: iv.location || "Bureau Optylab / Teams",
        };

        // Update existing event if possible
        if (iv.outlookEventId && graphService.updateOutlookEvent) {
          await graphService.updateOutlookEvent(
            recToken,
            iv.outlookEventId,
            payload,
          );
          outlookUpdated = true;
          newOutlookEventId = iv.outlookEventId;
        }
        // Otherwise create a new event
        else if (graphService.createOutlookEvent) {
          const created = await graphService.createOutlookEvent(
            recToken,
            payload,
          );
          newOutlookEventId = created?.outlookId || created?.id || null;
          outlookUpdated = true;
        }
      }
    } catch (e) {
      console.warn("⚠️ Outlook update/create failed:", e?.message);
    }

    // ─────────────────────────────────────────────
    // 2) DB: UPDATE INTERVIEW
    // ─────────────────────────────────────────────
    await db.collection("interviews").updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          proposedDate: start,
          proposedTime,
          status: "PENDING_CANDIDATE_CONFIRMATION",
          confirmToken: newConfirmToken,
          outlookEventId: newOutlookEventId, // ✅ keep sync
          updatedAt: new Date(),
        },
        $push: {
          history: {
            at: new Date(),
            by: "recruiter",
            type: "PROPOSE_NEW_SLOT",
            message: "Nouvelle date proposée au candidat.",
            newDate: start,
          },
        },
      },
    );

    // ─────────────────────────────────────────────
    // 3) DB: UPDATE calendar_events (IMPORTANT)
    // ─────────────────────────────────────────────
    // ✅ Update by outlookId if exists
    if (newOutlookEventId) {
      await db.collection("calendar_events").updateOne(
        { outlookId: newOutlookEventId },
        {
          $set: {
            title: `⏳ En attente — Entretien RH — ${iv.candidateName || "Candidat"}`,
            status: "scheduled",
            startDate: start,
            endDate: end,
            type: "interview_rh",
            syncedAt: new Date(),
          },
        },
        { upsert: false }, // normalement موجود من الأول عند création interview
      );
    } else {
      // ✅ Outlook غير متصل: على الأقل حدّث event DB بالـ candidatureId/type إذا تحب
      // (اختياري) نخلّيه safe: ما نعملش upsert بلا outlookId خاطر schema عندك يربط outlookId
    }

    // ─────────────────────────────────────────────
    // 4) EMAIL: confirm-only (candidat)
    // ─────────────────────────────────────────────
    if (iv.candidateEmail) {
      const FRONTEND = process.env.FRONTEND_URL || "http://localhost:3000";
      const confirmUrl = `${FRONTEND}/candidat/interview/confirm/${newConfirmToken}`;

      await sendCandidateProposedSlotConfirmOnlyEmail({
        candidateEmail: iv.candidateEmail,
        candidateName: iv.candidateName || "Candidat",
        jobTitle: iv.jobTitle || "Poste à définir",
        dateFormatted,
        timeFormatted: proposedTime,
        location: iv.location || "Optylab / Teams",
        confirmUrl,
      });
    }

    return c.json({
      success: true,
      outlookUpdated,
      outlookEventId: newOutlookEventId,
      confirmToken: newConfirmToken,
      proposedDate: start,
    });
  } catch (err) {
    console.error("❌ recruiterProposeNewSlotController:", err);
    return c.json({ error: "Erreur serveur" }, 500);
  }
}
