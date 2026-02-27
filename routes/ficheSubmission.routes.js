import { Hono } from "hono";
import { authMiddleware } from "../middlewares/auth.middleware.js";
// ❌ adminOnly نحّيناه من هالـ routes خاطر recruiter/responsable يلزمهم يشوفو fiche
// import { adminOnly } from "../middlewares/admin.middleware.js";

import {
  startSubmissionController,
  addAnswerController,
  submitController,
  getSubmissionByIdController,
  getSubmissionsByCandidatureController,
} from "../controllers/ficheSubmission.controller.js";

// 🆕 Génération PDF
import { generateFichePdfController } from "../controllers/Fichesubmission.controller.generatepdf.js";

const ficheSubmissionRoutes = new Hono();

/* ─── Routes spécifiques AVANT les routes génériques ─────────────── */

ficheSubmissionRoutes.post("/start", authMiddleware, startSubmissionController);

// ✅ PDF — GET /fiche-submissions/:submissionId/pdf (auth فقط)
ficheSubmissionRoutes.get(
  "/:submissionId/pdf",
  authMiddleware,
  generateFichePdfController
);

// ✅ Toutes les soumissions d'une candidature (auth فقط)
ficheSubmissionRoutes.get(
  "/candidature/:candidatureId",
  authMiddleware,
  getSubmissionsByCandidatureController
);

/* ─── Routes génériques ─────────────────────────────────────────── */

ficheSubmissionRoutes.get("/:submissionId", authMiddleware, getSubmissionByIdController);
ficheSubmissionRoutes.post("/:submissionId/answer", authMiddleware, addAnswerController);
ficheSubmissionRoutes.post("/:submissionId/submit", authMiddleware, submitController);

export default ficheSubmissionRoutes;