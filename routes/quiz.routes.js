import { Hono } from "hono";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import {
  generateQuiz,
  regenerateQuiz,
  generateMoreQuestions,
  getQuizByJob,
  getQuizById,
  updateFullQuiz,
  updateOneQuestion,
  deleteOneQuestion,
  addQuestion,
  deleteFullQuiz,
  getAllQuizzes,getMyQuizzes
} from "../controllers/quiz.controller.js";

const quizRoutes = new Hono();

// ✅ Toutes les routes nécessitent une authentification
quizRoutes.use("/*", authMiddleware);
quizRoutes.get("/", getAllQuizzes);
quizRoutes.get("/mine", authMiddleware, getMyQuizzes);
// Génération
quizRoutes.post("/generate/:jobId", generateQuiz);
quizRoutes.post("/regenerate/:jobId", regenerateQuiz);

// ✅ Générer des questions supplémentaires (append au quiz existant)
quizRoutes.post("/:id/generate-more", generateMoreQuestions);

// Lecture
quizRoutes.get("/job/:jobId", getQuizByJob);
quizRoutes.get("/:id", getQuizById);

// Modification quiz entier
quizRoutes.put("/:id", updateFullQuiz);
quizRoutes.delete("/:id", deleteFullQuiz);

// Modification par question
quizRoutes.post("/:id/questions", addQuestion);
quizRoutes.put("/:id/questions/:order", updateOneQuestion);
quizRoutes.delete("/:id/questions/:order", deleteOneQuestion);

export default quizRoutes;