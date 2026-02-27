import { Hono } from "hono";
import {
   createJob,
   getJobs,
   getAllJobs,
   getActiveJobs,
   getPendingJobs,
   getJobById,
   updateJob,
   updateMyJob,
   deleteJob,
   getJobCount,
   getJobsWithCandidatureCount,
   getJobsByUser,
   getMyOffers,
   checkJobClosed,
} from "../controllers/job.controller.js";

import { authMiddleware } from "../middlewares/auth.middleware.js";
import { adminOnly } from "../middlewares/admin.middleware.js";

const router = new Hono();

/* =========================================================
   ⚠️ CRITICAL: ORDER MATTERS!
========================================================= */

/* =========================
   PUBLIC ROUTES
========================= */
router.get("/", getJobs);
router.get("/active", getActiveJobs);

/* =========================
   ADMIN-ONLY ROUTES (avant /:id)
========================= */
router.get("/all", authMiddleware, adminOnly, getAllJobs);
router.get("/pending", authMiddleware, adminOnly, getPendingJobs);
router.get("/count", authMiddleware, adminOnly, getJobCount);
router.get(
   "/with-candidatures-count",
   authMiddleware,
   adminOnly,
   getJobsWithCandidatureCount
);
router.get("/user/:userId", authMiddleware, adminOnly, getJobsByUser);

/* =========================
   AUTH ROUTES
========================= */
router.get("/my-offers", authMiddleware, getMyOffers);
router.post("/", authMiddleware, createJob);
router.put("/my-offers/:id", authMiddleware, updateMyJob);




/* =========================
   PARAM ROUTES (à la fin)
   ⚠️ is-closed AVANT :id
========================= */
router.get("/:id/is-closed", checkJobClosed);
router.get("/:id", getJobById);

router.put("/:id", authMiddleware, adminOnly, updateJob);
router.delete("/:id", authMiddleware, adminOnly, deleteJob);

export default router;