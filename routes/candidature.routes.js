import { Hono } from "hono";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { adminOnly } from "../middlewares/admin.middleware.js";

import {
  extractCandidature,
  getCandidatureCount,
  updatePersonalInfo,
  getCandidaturesWithJob,
  getCandidaturesAnalysis,
  sendFicheController,
  getMyCandidaturesUsers,
  getMatchingStatsController,
  getAcademicStatsController,
  getCandidatureById,
} from "../controllers/candidature.controller.js";

import {
  getPreInterviewListController,
  togglePreInterviewController,
} from "../controllers/Candidature.controller.preinterview.js";

// 🆕 Envoyer fiche + quiz au candidat
import { sendDocumentsController } from "../controllers/Candidature.controller.senddocuments.js";
import {
  saveEntretienNoteController,
  getEntretienNotesController,
  getEntretienNoteByTypeController,
  updateEntretienNoteController,
  deleteEntretienNoteController,
} from "../controllers/Candidature.entretien.controller.js";
const router = new Hono();

/* ================================================
   ✅ IMPORTANT: في Hono ترتيب الـ routes مهم
   خَلّي routes spécifiques قبل routes paramétrées مثل /:id
================================================ */

// ...

// GET
router.get("/:id/entretien-notes", authMiddleware, getEntretienNotesController);

// POST (create)
router.post("/:id/entretien-note", authMiddleware, saveEntretienNoteController);

// PATCH (update)
router.patch(
  "/:id/entretien-note/:noteId",
  authMiddleware,
  updateEntretienNoteController
);

// DELETE
router.delete(
  "/:id/entretien-note/:noteId",
  authMiddleware,
  deleteEntretienNoteController
);


router.post("/extract", authMiddleware, extractCandidature);

// ملاحظة: إذا تحبها protected زيد authMiddleware/adminOnly حسب حاجتك
router.post("/:candidatureId/send-form", sendFicheController);

// 🆕 Envoyer fiche + quiz ensemble
router.post(
  "/:candidatureId/send-documents",
  authMiddleware,
  adminOnly,
  sendDocumentsController
);

/* ===============================
   2️⃣ GET ROUTES SPÉCIFIQUES
   (لازم يجيوا قبل /:id)
=============================== */
router.get("/stats/matching", getMatchingStatsController);

router.get("/stats/academic", authMiddleware, adminOnly, getAcademicStatsController);

router.get("/count", authMiddleware, adminOnly, getCandidatureCount);

router.get("/my", authMiddleware, getMyCandidaturesUsers);

router.get("/pre-interview", authMiddleware, adminOnly, getPreInterviewListController);

// ✅ هاذم كانو يطيحو 400 خاطر /:id كان يبلعهم
router.get("/with-job", authMiddleware, adminOnly, getCandidaturesWithJob);

router.get("/analysis", authMiddleware, adminOnly, getCandidaturesAnalysis);

/* ===============================
   3️⃣ GET ROUTE PARAMÉTRÉE
   (خليها في الآخر)
=============================== */
router.get("/:id", authMiddleware, getCandidatureById);

/* ===============================
   4️⃣ PATCH ROUTES
=============================== */
// إذا تحبها protected زيد authMiddleware (حسب مشروعك)
router.patch("/:id/personal-info", updatePersonalInfo);

router.patch("/:id/pre-interview", authMiddleware, adminOnly, togglePreInterviewController);

export default router;