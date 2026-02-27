import { Hono } from "hono";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { adminOnly } from "../middlewares/admin.middleware.js";
import {
  submitQuizController,
  getSubmissionByIdController,
  getSubmissionsByQuizController,
  getSubmissionsByCandidatureController,
  checkQuizAlreadySubmittedController,
} from "../controllers/Quizsubmission.controller.js";

const router = new Hono();

router.get("/merci", (c) => c.json({ ok: true }));
router.post("/", submitQuizController);
router.get("/check", checkQuizAlreadySubmittedController);

// 🆕 Admin — toutes les soumissions d'une candidature (AVANT /:id)
router.get(
  "/candidature/:candidatureId",
  authMiddleware,
  adminOnly,
  getSubmissionsByCandidatureController
);

router.get("/quiz/:quizId", authMiddleware, adminOnly, getSubmissionsByQuizController);
router.get("/:id", getSubmissionByIdController);

export default router;