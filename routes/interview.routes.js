// ================================================================
// interview.routes.js — VERSION COMPLÈTE
// ================================================================
import { Hono } from "hono";
import { verifyToken } from "../middlewares/auth.js";

// Controller existant
import {
  scheduleInterview,
  getInterviewByToken,
  confirmInterviewByToken,
  modifyInterviewByToken,
  getInterviewsByCandidature,
  getInterviewsByJobOffer,
  getInterviewsByUser,
  getUpcomingInterviewsController,
  cancelInterviewById,
  getCandidateInterviewByToken,
  candidateConfirmInterviewController,
  candidateRescheduleController,
  adminApproveModificationController,
  adminRejectModificationController,
  getInterviewByIdController,
} from "../controllers/interview.controller.js";

// Nouveaux controllers
import {
  getAvailabilityController,
  addEntretienNoteController,
  getEntretienNotesController,
  updateEntretienNoteController,
  deleteEntretienNoteController,
} from "../controllers/Interview.availability.controller.js";

const interviewRouter = new Hono();

/* ══════════════════════════════════════════════════════════════
 *  FLOW 1 : ENTRETIEN RH
 *  POST /interviews/schedule  { interviewType: "rh", createCalendarEvent: true }
 *  → Crée dans MongoDB + Outlook + envoie email au responsable
 *  → Responsable confirme → email au candidat
 * ══════════════════════════════════════════════════════════════ */

// ─── Étape 1 : Recruteur planifie ──────────────────────────────
interviewRouter.post("/schedule", verifyToken, scheduleInterview);

// ─── Étape 2 : ResponsableMetier ───────────────────────────────
interviewRouter.get("/confirm/:token", getInterviewByToken);
interviewRouter.post("/confirm/:token", confirmInterviewByToken);
interviewRouter.post("/modify/:token", modifyInterviewByToken);

// ─── Étape 3 : Candidat ────────────────────────────────────────
interviewRouter.get("/candidate/:candidateToken", getCandidateInterviewByToken);
interviewRouter.post("/candidate/:candidateToken/confirm", candidateConfirmInterviewController);
interviewRouter.post("/candidate/:candidateToken/reschedule", candidateRescheduleController);

// ─── Admin : Approbation/Rejet de modification ─────────────────
interviewRouter.post("/admin/approve/:interviewId", verifyToken, adminApproveModificationController);
interviewRouter.post("/admin/reject/:interviewId",  verifyToken, adminRejectModificationController);

/* ══════════════════════════════════════════════════════════════
 *  FLOW 2 : ENTRETIEN RH + TECHNIQUE
 *  GET /interviews/availability  → créneaux libres communs (7j)
 *  POST /interviews/schedule     { interviewType: "rh_technique", notifyResponsable: true }
 *  → Email responsable pour accepter ou proposer autre date
 *  → Si accepté → email candidat
 *  → Si modifié → email recruteur pour valider → calendar mis à jour
 * ══════════════════════════════════════════════════════════════ */

// ─── Disponibilités croisées ────────────────────────────────────
interviewRouter.get("/availability", verifyToken, getAvailabilityController);

/* ══════════════════════════════════════════════════════════════
 *  NOTES ENTRETIEN TÉLÉPHONIQUE — CRUD
 *  Ces routes sont sur /candidatures/:id/entretien-notes
 *  (ajoutées dans candidature.routes.js — voir ci-dessous)
 * ══════════════════════════════════════════════════════════════ */

// ─── Consultation ───────────────────────────────────────────────
interviewRouter.get("/candidature/:candidatureId", verifyToken, getInterviewsByCandidature);
interviewRouter.get("/job/:jobOfferId",             verifyToken, getInterviewsByJobOffer);
interviewRouter.get("/user/:userId",                verifyToken, getInterviewsByUser);
interviewRouter.get("/upcoming",                    verifyToken, getUpcomingInterviewsController);

// ─── Détail par ID ──────────────────────────────────────────────
interviewRouter.get("/:id", verifyToken, getInterviewByIdController);

// ─── Annulation ─────────────────────────────────────────────────
interviewRouter.delete("/:id", verifyToken, cancelInterviewById);

export default interviewRouter;

/* ================================================================
   À AJOUTER dans candidature.routes.js :
   ================================================================

   import {
     addEntretienNoteController,
     getEntretienNotesController,
     updateEntretienNoteController,
     deleteEntretienNoteController,
   } from "../controllers/interview.availability.controller.js";

   // Notes entretien téléphonique CRUD
   candidatureRouter.post("/:id/entretien-note",            verifyToken, addEntretienNoteController);
   candidatureRouter.get("/:id/entretien-notes",            verifyToken, getEntretienNotesController);
   candidatureRouter.patch("/:id/entretien-notes/:noteId",  verifyToken, updateEntretienNoteController);
   candidatureRouter.delete("/:id/entretien-notes/:noteId", verifyToken, deleteEntretienNoteController);

   ================================================================
   À AJOUTER dans interview.controller.js scheduleInterview() :
   ================================================================

   // Après createInterview(), si createCalendarEvent: true :
   if (body.createCalendarEvent) {
     try {
       const token = await getAccessTokenForUser(String(adminUserId));
       if (token) {
         await graphService.createOutlookEvent(token, {
           title: `Entretien ${body.interviewType?.toUpperCase() || "RH"} — ${candidateName}`,
           description: `Entretien avec ${candidateName} pour le poste "${job.titre}".\n\n${notes || ""}`,
           start: `${proposedDate}T${proposedTime}:00`,
           end:   new Date(new Date(`${proposedDate}T${proposedTime}:00`).getTime() + 60*60*1000).toISOString(),
           location: "En présentiel / Teams",
         });
       }
     } catch (e) {
       console.warn("⚠️ Outlook event creation failed (non bloquant):", e?.message);
     }
   }
   ================================================================ */