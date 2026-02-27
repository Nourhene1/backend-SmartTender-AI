// src/routes/application.routes.js
// ✅ REFACTO: Routes candidatures → tenders (plus de jobs)

import { Hono } from "hono";
import { uploadCv, confirmApplication } from "../controllers/candidature.controller.js";

const applicationRoutes = new Hono();

/**
 * POST /api/applications/:tenderId/cv
 * Upload CV → Extract FastAPI → Save DRAFT dans tender_applications
 *
 * ✅ Le param s'appelle tenderId — le controller lit aussi :jobId pour compat frontend
 */
applicationRoutes.post("/applications/:tenderId/cv", uploadCv);

/**
 * POST /api/applications/:candidatureId/confirm
 * Finaliser la candidature → status SUBMITTED → trigger matching workers
 */
applicationRoutes.post("/applications/:candidatureId/confirm", confirmApplication);

export default applicationRoutes;