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
   confirmJob,
   rejectJob,
   reactivateJob,
   getMyAssignedJobs,
   getMyJobsWithoutQuiz,
   validateJob,
   // ✅ NEW: publication LinkedIn
   publishJobToLinkedIn,
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
router.get("/jobs/without-quiz", authMiddleware, getMyJobsWithoutQuiz);
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
router.get("/my-assigned", authMiddleware, getMyAssignedJobs);


/* =========================
   ✅ LINKEDIN PUBLISH (AUTH USER)
   POST /jobs/:id/publish-linkedin
========================= */
router.post("/:id/publish-linkedin", authMiddleware, publishJobToLinkedIn);
/* ✅ DOUBLE CONFIRM */
/* =========================
   ADMIN ACTIONS (avant /:id)
========================= */
router.put("/:id/confirm", authMiddleware, adminOnly, confirmJob);
router.put("/:id/reject", authMiddleware, adminOnly, rejectJob);
router.put("/:id/reactivate", authMiddleware, reactivateJob);
router.put("/:id/validate", authMiddleware, adminOnly, validateJob);

/* =========================
   PARAM ROUTES (à la fin)
   ⚠️ is-closed AVANT :id
========================= */
router.get("/:id/is-closed", checkJobClosed);
router.get("/:id", getJobById);

router.put("/:id", authMiddleware, adminOnly, updateJob);
router.delete("/:id", authMiddleware, adminOnly, deleteJob);

export default router;