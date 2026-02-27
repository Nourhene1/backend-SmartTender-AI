import { Hono } from "hono";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { adminOnly } from "../middlewares/admin.middleware.js";

import {
  extractCandidature,
  getCandidatureCount,
  updatePersonalInfo,
  getCandidaturesWithJob,
  getCandidaturesAnalysis,
  getMyCandidaturesUsers,
  getMatchingStatsController,
  getAcademicStatsController,
  getCandidatureById,
  // ✅ FIX: importer depuis le controller principal (même collection tender_applications)
  togglePreInterviewController,
  getPreInterviewListController,
} from "../controllers/candidature.controller.js";


const router = new Hono();

/* ================================================
   ✅ IMPORTANT: في Hono ترتيب الـ routes مهم
   خَلّي routes spécifiques قبل routes paramétrées مثل /:id
================================================ */

// ...




router.post("/extract", authMiddleware, extractCandidature);

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