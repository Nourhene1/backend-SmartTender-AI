// src/routes/document.routes.js
import { Hono } from "hono";
import {
  generateResponseDocument,
  generateCandidateProfile,
  getDocumentHistory,
} from "../controllers/document.controller.js";

import { authMiddleware } from "../middlewares/auth.middleware.js";
import { adminOnly } from "../middlewares/admin.middleware.js";

const router = new Hono();

// Module 3 — Générer dossier de réponse complet
router.post("/generate-response", authMiddleware, adminOnly, generateResponseDocument);

// Module 3 — Générer fiche profil candidat
router.post("/generate-profile",  authMiddleware, adminOnly, generateCandidateProfile);

// Historique des documents générés
router.get("/history", authMiddleware, adminOnly, getDocumentHistory);

export default router;