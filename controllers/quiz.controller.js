import { ObjectId } from "mongodb";
import axios from "axios";
import {
  createQuiz,
  findQuizByJobId,
  findQuizById,
  updateQuiz,
  updateQuizQuestion,
  deleteQuizQuestion,
  addQuizQuestion,
  deleteQuiz,
  findAllQuizzes,
  appendQuestionsToQuiz,findQuizzesForUser
} from "../models/quizModel.js";
import { findJobOfferById } from "../models/job.model.js";

const FASTAPI_URL = process.env.ML_SERVICE_URL || "http://localhost:8000";

export const getAllQuizzes = async (c) => {
  try {
    const quizzes = await findAllQuizzes({
      status: "ACTIVE",
      includeQuestions: false,
    });
    return c.json(quizzes, 200);
  } catch (err) {
    console.error("getAllQuizzes error:", err);
    return c.json({ message: "Erreur récupération des quiz" }, 500);
  }
};

/* =========================================================
   POST /quizzes/generate/:jobId
========================================================= */
export async function generateQuiz(c) {
  try {
    const { jobId } = c.req.param();

    if (!ObjectId.isValid(jobId)) {
      return c.json({ message: "ID offre invalide" }, 400);
    }

    const job = await findJobOfferById(jobId);
    if (!job) {
      return c.json({ message: "Offre non trouvée" }, 404);
    }

    const existing = await findQuizByJobId(jobId);
    if (existing) {
      return c.json(
        {
          message: "Un quiz existe déjà pour cette offre",
          quizId: existing._id.toString(),
          quiz: existing,
        },
        409,
      );
    }

    console.log(`🔍 Generating quiz for job: ${job.titre}`);

    const mlResponse = await axios.post(
      `${FASTAPI_URL}/quiz/generate`,
      {
        jobId: jobId,
        titre: job.titre || "",
        description: job.description || "",
        technologies: Array.isArray(job.technologies) ? job.technologies : [],
        scores: job.scores || null,
        numQuestions: 25,
        existingQuestions: [], // ✅ Pas de questions existantes (premier quiz)
      },
      { timeout: 120000 },
    );

    const questions = mlResponse.data.questions || [];

    if (questions.length === 0) {
      return c.json({ message: "Aucune question générée" }, 500);
    }

    const result = await createQuiz({
      jobOfferId: jobId,
      jobTitle: job?.title || job?.titre,
      questions,
      generatedBy: "auto",
    });

    console.log(
      `✅ Quiz created: ${result.insertedId} (${questions.length} questions)`,
    );

    return c.json(
      {
        message: `Quiz généré avec ${questions.length} questions`,
        quizId: result.insertedId.toString(),
        totalQuestions: questions.length,
      },
      201,
    );
  } catch (err) {
    console.error("❌ Generate quiz error:", err.message);

    if (err.response?.status === 429) {
      return c.json(
        { message: "Service IA surchargé. Réessayez dans quelques minutes." },
        429,
      );
    }

    return c.json(
      { message: "Erreur lors de la génération du quiz", error: err.message },
      500,
    );
  }
}

/* =========================================================
   POST /quizzes/regenerate/:jobId
========================================================= */
export async function regenerateQuiz(c) {
  try {
    const { jobId } = c.req.param();

    if (!ObjectId.isValid(jobId)) {
      return c.json({ message: "ID offre invalide" }, 400);
    }

    const job = await findJobOfferById(jobId);
    if (!job) {
      return c.json({ message: "Offre non trouvée" }, 404);
    }

    const existing = await findQuizByJobId(jobId);
    if (existing) {
      await deleteQuiz(existing._id);
    }

    const mlResponse = await axios.post(
      `${FASTAPI_URL}/quiz/generate`,
      {
        jobId,
        titre: job.titre || "",
        description: job.description || "",
        technologies: Array.isArray(job.technologies) ? job.technologies : [],
        scores: job.scores || null,
        numQuestions: 25,
        existingQuestions: [], // ✅ Regénération = on repart de zéro
      },
      { timeout: 120000 },
    );

    const questions = mlResponse.data.questions || [];

    const result = await createQuiz({
      jobOfferId: jobId,
      jobTitle: job?.title || job?.titre,
      questions,
      generatedBy: "regenerated",
    });

    return c.json(
      {
        message: `Quiz regénéré avec ${questions.length} questions`,
        quizId: result.insertedId.toString(),
        totalQuestions: questions.length,
      },
      201,
    );
  } catch (err) {
    console.error("❌ Regenerate quiz error:", err.message);
    return c.json(
      { message: "Erreur lors de la regénération du quiz", error: err.message },
      500,
    );
  }
}

/* =========================================================
   POST /quizzes/:id/generate-more
   ✅ Générer des questions supplémentaires sans doublons
========================================================= */
export async function generateMoreQuestions(c) {
  try {
    const { id } = c.req.param();
    const body = await c.req.json();
    const numQuestions = body.numQuestions ;

    if (!ObjectId.isValid(id)) {
      return c.json({ message: "ID invalide" }, 400);
    }

    const quiz = await findQuizById(id);
    if (!quiz) {
      return c.json({ message: "Quiz non trouvé" }, 404);
    }

    const job = await findJobOfferById(quiz.jobOfferId);
    if (!job) {
      return c.json({ message: "Offre liée non trouvée" }, 404);
    }

    // ✅ Extraire les questions existantes (juste le texte) pour éviter les doublons
    const existingQuestions = (quiz.questions || []).map((q) => q.question);

    console.log(`🔍 Generating ${numQuestions} more questions for quiz ${id} (${existingQuestions.length} existing to avoid)`);

    const mlResponse = await axios.post(
      `${FASTAPI_URL}/quiz/generate`,
      {
        jobId: quiz.jobOfferId.toString(),
        titre: job.titre || "",
        description: job.description || "",
        technologies: Array.isArray(job.technologies) ? job.technologies : [],
        scores: job.scores || null,
        numQuestions,
        existingQuestions, // ✅ Envoyer les questions existantes
      },
      { timeout: 120000 },
    );

    const newQuestions = mlResponse.data.questions || [];

    if (newQuestions.length === 0) {
      return c.json({ message: "Aucune question générée" }, 500);
    }

    await appendQuestionsToQuiz(id, newQuestions);

    const updatedQuiz = await findQuizById(id);

    return c.json({
      message: `${newQuestions.length} questions ajoutées`,
      totalQuestions: updatedQuiz.totalQuestions,
      quiz: updatedQuiz,
    });
  } catch (err) {
    console.error("❌ Generate more questions error:", err.message);

    if (err.response?.status === 429) {
      return c.json(
        { message: "Service IA surchargé. Réessayez dans quelques minutes." },
        429,
      );
    }

    return c.json(
      { message: "Erreur lors de la génération", error: err.message },
      500,
    );
  }
}

/* =========================================================
   GET /quizzes/job/:jobId
========================================================= */
export async function getQuizByJob(c) {
  try {
    const { jobId } = c.req.param();

    if (!ObjectId.isValid(jobId)) {
      return c.json({ message: "ID offre invalide" }, 400);
    }

    const quiz = await findQuizByJobId(jobId);

    if (!quiz) {
      return c.json({ message: "Aucun quiz pour cette offre" }, 404);
    }

    return c.json(quiz);
  } catch (err) {
    console.error("❌ Get quiz error:", err);
    return c.json({ message: "Erreur serveur", error: err.message }, 500);
  }
}

/* =========================================================
   GET /quizzes/:id
========================================================= */
export async function getQuizById(c) {
  try {
    const { id } = c.req.param();

    if (!ObjectId.isValid(id)) {
      return c.json({ message: "ID invalide" }, 400);
    }

    const quiz = await findQuizById(id);
    if (!quiz) {
      return c.json({ message: "Quiz non trouvé" }, 404);
    }

    return c.json(quiz);
  } catch (err) {
    console.error("❌ Get quiz by ID error:", err);
    return c.json({ message: "Erreur serveur", error: err.message }, 500);
  }
}

/* =========================================================
   PUT /quizzes/:id
========================================================= */
export async function updateFullQuiz(c) {
  try {
    const { id } = c.req.param();
    const body = await c.req.json();

    if (!ObjectId.isValid(id)) {
      return c.json({ message: "ID invalide" }, 400);
    }

    const quiz = await findQuizById(id);
    if (!quiz) {
      return c.json({ message: "Quiz non trouvé" }, 404);
    }

    await updateQuiz(id, { questions: body.questions });

    return c.json({
      message: "Quiz mis à jour",
      totalQuestions: body.questions?.length || 0,
    });
  } catch (err) {
    console.error("❌ Update quiz error:", err);
    return c.json({ message: "Erreur serveur", error: err.message }, 500);
  }
}

/* =========================================================
   PUT /quizzes/:id/questions/:order
========================================================= */
export async function updateOneQuestion(c) {
  try {
    const { id, order } = c.req.param();
    const body = await c.req.json();

    if (!ObjectId.isValid(id)) {
      return c.json({ message: "ID invalide" }, 400);
    }

    await updateQuizQuestion(id, parseInt(order), body);

    return c.json({ message: "Question mise à jour" });
  } catch (err) {
    console.error("❌ Update question error:", err);
    return c.json({ message: "Erreur serveur", error: err.message }, 500);
  }
}

/* =========================================================
   DELETE /quizzes/:id/questions/:order
========================================================= */
export async function deleteOneQuestion(c) {
  try {
    const { id, order } = c.req.param();

    if (!ObjectId.isValid(id)) {
      return c.json({ message: "ID invalide" }, 400);
    }

    await deleteQuizQuestion(id, parseInt(order));

    return c.json({ message: "Question supprimée" });
  } catch (err) {
    console.error("❌ Delete question error:", err);
    return c.json({ message: "Erreur serveur", error: err.message }, 500);
  }
}

/* =========================================================
   POST /quizzes/:id/questions
========================================================= */
export async function addQuestion(c) {
  try {
    const { id } = c.req.param();
    const body = await c.req.json();

    if (!ObjectId.isValid(id)) {
      return c.json({ message: "ID invalide" }, 400);
    }

    if (!body.question || !body.options || !body.correctAnswer) {
      return c.json(
        { message: "question, options et correctAnswer sont requis" },
        400,
      );
    }

    await addQuizQuestion(id, body);

    const updatedQuiz = await findQuizById(id);

    return c.json({ message: "Question ajoutée", quiz: updatedQuiz }, 201);
  } catch (err) {
    console.error("❌ Add question error:", err);
    return c.json({ message: "Erreur serveur", error: err.message }, 500);
  }
}

/* =========================================================
   DELETE /quizzes/:id
========================================================= */
export async function deleteFullQuiz(c) {
  try {
    const { id } = c.req.param();

    if (!ObjectId.isValid(id)) {
      return c.json({ message: "ID invalide" }, 400);
    }

    const quiz = await findQuizById(id);
    if (!quiz) {
      return c.json({ message: "Quiz non trouvé" }, 404);
    }

    await deleteQuiz(id);

    return c.json({ message: "Quiz supprimé" });
  } catch (err) {
    console.error("❌ Delete quiz error:", err);
    return c.json({ message: "Erreur serveur", error: err.message }, 500);
  }
}

/* =========================================================
   HELPER: Auto-generate quiz
========================================================= */
export async function autoGenerateQuiz(jobId, numQuestions = 25) {
  try {
    const job = await findJobOfferById(jobId);
    if (!job) {
      console.error(`⚠️ Auto quiz: Job ${jobId} not found`);
      return null;
    }

    const existing = await findQuizByJobId(jobId);
    if (existing) {
      console.log(`ℹ️ Quiz already exists for job ${jobId}`);
      return existing._id;
    }

    const mlResponse = await axios.post(
      `${FASTAPI_URL}/quiz/generate`,
      {
        jobId,
        titre: job.titre || "",
        description: job.description || "",
        technologies: Array.isArray(job.technologies) ? job.technologies : [],
        scores: job.scores || null,
        numQuestions,
        existingQuestions: [],
      },
      { timeout: 120000 },
    );

    const questions = mlResponse.data.questions || [];

    if (questions.length === 0) {
      console.error(`⚠️ Auto quiz: No questions generated for job ${jobId}`);
      return null;
    }

    const result = await createQuiz({
      jobOfferId: jobId,
      jobTitle: job?.title || job?.titre,
      questions,
      generatedBy: "auto",
    });

    console.log(`✅ Auto quiz created for job ${jobId}: ${result.insertedId}`);
    return result.insertedId;
  } catch (err) {
    console.error(
      `⚠️ Auto quiz generation failed for job ${jobId}:`,
      err.message,
    );
    return null;
  }
}




function getUserIdFromContext(c) {
  // cas 1 (souvent) : le middleware met user dans c.get("user")
  const u = c.get?.("user");
  const id = u?._id || u?.id || u?.userId;

  // cas 2 : tu stockes direct userId
  if (id) return String(id);

  const direct = c.get?.("userId");
  return direct ? String(direct) : "";
}

/**
 * ✅ GET /quizzes/mine
 */
export async function getMyQuizzes(c) {
  try {
    const userId = getUserIdFromContext(c);
    if (!userId || !ObjectId.isValid(userId)) {
      return c.json({ message: "Non authentifié" }, 401);
    }

    const quizzes = await findQuizzesForUser(userId);
    return c.json(quizzes, 200);
  } catch (err) {
    console.error("getMyQuizzes error:", err);
    return c.json({ message: "Erreur serveur" }, 500);
  }
}

async function assertCanAccessJobOffer(c, jobOfferId) {
  const userId = getUserIdFromContext(c);

  if (!ObjectId.isValid(jobOfferId)) {
    return c.json({ message: "jobOfferId invalide" }, 400);
  }
  if (!userId || !ObjectId.isValid(userId)) {
    return c.json({ message: "Non authentifié" }, 401);
  }

  const job = await findJobOfferById(jobOfferId);
  if (!job) return c.json({ message: "Offre introuvable" }, 404);

  const uid = String(userId);
  const createdByOk = job?.createdBy?.toString?.() === uid;
  const assignedOk = Array.isArray(job?.assignedUserIds)
    ? job.assignedUserIds.some((x) => x?.toString?.() === uid)
    : false;

  if (!createdByOk && !assignedOk) {
    return c.json({ message: "Accès refusé" }, 403);
  }

  return true;
}
