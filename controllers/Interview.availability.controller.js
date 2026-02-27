// ================================================================
// interview.availability.controller.js
//
// GET  /interviews/availability
//      → Créneaux libres communs Recruteur + ResponsableMetier (7j)
//
// POST /interviews/schedule  (extension du controller existant)
//      → Supporte maintenant interviewType + createCalendarEvent
//
// POST /candidatures/:id/entretien-note
// GET  /candidatures/:id/entretien-notes
// PATCH /candidatures/:id/entretien-notes/:noteId
// DELETE /candidatures/:id/entretien-notes/:noteId
// ================================================================

import { ObjectId } from "mongodb";
import { getDB } from "../models/db.js";
import { findJobOfferById } from "../models/job.model.js";
import { findUserById } from "../models/user.model.js";
import * as graphService from "../services/Microsoftgraphservice.js";

// ── Helper : récupère l'access token Microsoft d'un user ────────
async function getAccessTokenForUser(userId) {
  const db = getDB();
  const tokenRecord = await db.collection("user_calendar_tokens").findOne({
    userId: String(userId),
    provider: "microsoft",
    connected: true,
  });
  if (!tokenRecord) return null;

  // Refresh si expiré
  const MARGIN_MS = 5 * 60 * 1000;
  const expired =
    !tokenRecord.expiresAt ||
    new Date(tokenRecord.expiresAt).getTime() - Date.now() < MARGIN_MS;

  if (!expired) return tokenRecord.accessToken;

  try {
    const result = await graphService.refreshAccessToken(tokenRecord.refreshToken);
    await db.collection("user_calendar_tokens").updateOne(
      { userId: String(userId), provider: "microsoft" },
      {
        $set: {
          accessToken:  result.accessToken,
          refreshToken: result.refreshToken,
          expiresAt: new Date(Date.now() + (result.expiresIn || 3600) * 1000),
        },
      }
    );
    return result.accessToken;
  } catch {
    return null;
  }
}

// ── Génère les créneaux de travail sur N jours ──────────────────
function generateWorkSlots(days = 7) {
  const slots = [];
  const now = new Date();
  const START_HOUR = 9;
  const END_HOUR = 17;
  const STEP_MIN = 60; // créneaux de 1h

  for (let d = 0; d < days; d++) {
    const day = new Date(now);
    day.setDate(now.getDate() + d + 1); // commence demain
    day.setHours(0, 0, 0, 0);

    // Ignorer week-end
    if (day.getDay() === 0 || day.getDay() === 6) continue;

    for (let h = START_HOUR; h < END_HOUR; h += STEP_MIN / 60) {
      const start = new Date(day);
      start.setHours(h, 0, 0, 0);
      const end = new Date(start);
      end.setMinutes(end.getMinutes() + 60);

      slots.push({ start, end });
    }
  }
  return slots;
}

// ── Vérifie si un créneau chevauche des événements Outlook ──────
function isSlotBusy(slot, events) {
  return events.some((ev) => {
    const evStart = new Date(ev.start || ev.startDate);
    const evEnd   = new Date(ev.end   || ev.endDate);
    return slot.start < evEnd && slot.end > evStart;
  });
}

// ================================================================
//  GET /interviews/availability
//  Query: candidatureId, jobOfferId, days (default 7)
// ================================================================
export async function getAvailabilityController(c) {
  try {
    const { candidatureId, jobOfferId, days = "7" } = c.req.query();
    const recruiterId = c.get("user")?.id;

    if (!candidatureId || !jobOfferId) {
      return c.json({ error: "candidatureId et jobOfferId requis" }, 400);
    }

    // ── Trouver le responsable métier ──
    let responsableId = null;
    try {
      const job = await findJobOfferById(jobOfferId);
      if (job?.assignedUserIds?.length > 0) {
        responsableId = String(job.assignedUserIds[0]);
      }
    } catch {}

    // ── Générer tous les créneaux de travail ──
    const allSlots = generateWorkSlots(parseInt(days));

    // ── Récupérer les événements du recruteur ──
    let recruiterEvents = [];
    if (recruiterId) {
      const token = await getAccessTokenForUser(String(recruiterId));
      if (token) {
        try {
          const start = new Date();
          const end   = new Date();
          end.setDate(end.getDate() + parseInt(days) + 1);
          recruiterEvents = await graphService.getOutlookEvents(
            token,
            start.toISOString(),
            end.toISOString()
          );
        } catch (e) {
          console.warn("⚠️ Could not fetch recruiter calendar:", e?.message);
        }
      }
    }

    // ── Récupérer les événements du responsable ──
    let responsableEvents = [];
    if (responsableId) {
      const token = await getAccessTokenForUser(responsableId);
      if (token) {
        try {
          const start = new Date();
          const end   = new Date();
          end.setDate(end.getDate() + parseInt(days) + 1);
          responsableEvents = await graphService.getOutlookEvents(
            token,
            start.toISOString(),
            end.toISOString()
          );
        } catch (e) {
          console.warn("⚠️ Could not fetch responsable calendar:", e?.message);
        }
      }
    }

    // ── Filtrer les créneaux libres pour LES DEUX ──
    const freeSlots = allSlots.filter(
      (slot) =>
        !isSlotBusy(slot, recruiterEvents) &&
        !isSlotBusy(slot, responsableEvents)
    );

    // ── Formater la réponse ──
    const slots = freeSlots.map((s) => ({
      date: s.start.toISOString().split("T")[0],
      time: s.start.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }),
      startISO: s.start.toISOString(),
      endISO:   s.end.toISOString(),
    }));

    return c.json({
      slots,
      recruiterCalendarConnected:   recruiterEvents.length >= 0,
      responsableCalendarConnected: responsableId
        ? responsableEvents.length >= 0
        : false,
      responsableFound: !!responsableId,
      total: slots.length,
    });
  } catch (err) {
    console.error("❌ getAvailabilityController:", err);
    return c.json({ error: "Erreur serveur", slots: [] }, 500);
  }
}

// ================================================================
//  NOTES ENTRETIEN TÉLÉPHONIQUE — CRUD complet
// ================================================================

// POST /candidatures/:id/entretien-note
export async function addEntretienNoteController(c) {
  try {
    const { id } = c.req.param();
    if (!ObjectId.isValid(id)) return c.json({ error: "ID invalide" }, 400);

    const { type = "telephonique", note, stars = 0 } = await c.req.json();
    if (!note?.trim()) return c.json({ error: "Note vide" }, 400);

    const noteDoc = {
      _id:       new ObjectId(),
      type,
      note:      note.trim(),
      stars:     Number(stars) || 0,
      createdBy: c.get("user")?._id || null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await getDB().collection("candidatures").updateOne(
      { _id: new ObjectId(id) },
      {
        $push: { "entretiens.notes": noteDoc },
        $set:  {
          "entretiens.lastType":   type,
          "entretiens.lastNoteAt": noteDoc.createdAt,
          updatedAt: new Date(),
        },
      }
    );

    if (result.matchedCount === 0) return c.json({ error: "Candidature introuvable" }, 404);
    return c.json({ success: true, note: noteDoc }, 201);
  } catch (err) {
    console.error("❌ addEntretienNote:", err);
    return c.json({ error: "Erreur serveur" }, 500);
  }
}

// GET /candidatures/:id/entretien-notes
export async function getEntretienNotesController(c) {
  try {
    const { id } = c.req.param();
    if (!ObjectId.isValid(id)) return c.json([], 200);

    const cand = await getDB().collection("candidatures").findOne(
      { _id: new ObjectId(id) },
      { projection: { "entretiens.notes": 1 } }
    );

    const notes = (cand?.entretiens?.notes || [])
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      // Sérialiser _id ObjectId → string pour le frontend
      .map(n => ({ ...n, _id: n._id?.toString?.() || String(n._id || "") }));

    return c.json(notes, 200);
  } catch (err) {
    console.error("❌ getEntretienNotes:", err);
    return c.json([], 200);
  }
}

// PATCH /candidatures/:id/entretien-notes/:noteId
export async function updateEntretienNoteController(c) {
  try {
    const { id, noteId } = c.req.param();
    if (!ObjectId.isValid(id) || !ObjectId.isValid(noteId)) {
      return c.json({ error: "ID invalide" }, 400);
    }

    const { note, stars } = await c.req.json();
    if (!note?.trim()) return c.json({ error: "Note vide" }, 400);

    const updates = { "entretiens.notes.$.note": note.trim(), "entretiens.notes.$.updatedAt": new Date() };
    if (stars !== undefined) updates["entretiens.notes.$.stars"] = Number(stars);

    const result = await getDB().collection("candidatures").updateOne(
      { _id: new ObjectId(id), "entretiens.notes._id": new ObjectId(noteId) },
      { $set: updates }
    );

    if (result.matchedCount === 0) return c.json({ error: "Note introuvable" }, 404);
    return c.json({ success: true });
  } catch (err) {
    console.error("❌ updateEntretienNote:", err);
    return c.json({ error: "Erreur serveur" }, 500);
  }
}

// DELETE /candidatures/:id/entretien-notes/:noteId
export async function deleteEntretienNoteController(c) {
  try {
    const { id, noteId } = c.req.param();
    if (!ObjectId.isValid(id) || !ObjectId.isValid(noteId)) {
      return c.json({ error: "ID invalide" }, 400);
    }

    const result = await getDB().collection("candidatures").updateOne(
      { _id: new ObjectId(id) },
      { $pull: { "entretiens.notes": { _id: new ObjectId(noteId) } } }
    );

    if (result.matchedCount === 0) return c.json({ error: "Candidature introuvable" }, 404);
    return c.json({ success: true });
  } catch (err) {
    console.error("❌ deleteEntretienNote:", err);
    return c.json({ error: "Erreur serveur" }, 500);
  }
}