import { Hono } from "hono";
import { uploadCv, confirmApplication } from "../controllers/candidature.controller.js";

const applicationRoutes = new Hono();
/* =========================================================
   UTILS
========================================================= */


/**
 * POST /api/applications/:jobId/cv
 * Upload CV → Extract → Save
 */
applicationRoutes.post("/applications/:jobId/cv", uploadCv);

/**
 * POST /api/applications/:candidatureId/confirm
 * Confirm and submit application
 */
applicationRoutes.post("/applications/:candidatureId/confirm", confirmApplication);

export default applicationRoutes;