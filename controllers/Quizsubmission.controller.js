// ================================================================
// quizSubmission.controller.js
// ================================================================
import { ObjectId } from "mongodb";
import { findQuizById } from "../models/quizModel.js";
import {
  createQuizSubmission,
  findQuizSubmissionById,
  findSubmissionsByQuizId,
  findSubmissionsByCandidatureId,
  findSubmissionByQuizAndCandidature, // ✅ NEW (exists in your model)
} from "../models/Quizsubmission.model.js";
// controllers/Quizsubmission.controller.js


export async function checkQuizAlreadySubmittedController(c) {
  try {
    const quizId = c.req.query("quizId");
    const candidatureId = c.req.query("candidatureId");

    if (!quizId || !candidatureId) {
      return c.json({ alreadySubmitted: false }, 200);
    }

    if (!ObjectId.isValid(quizId) || !ObjectId.isValid(candidatureId)) {
      return c.json({ alreadySubmitted: false }, 200);
    }

    const found = await findSubmissionByQuizAndCandidature(
      quizId,
      candidatureId
    );

    return c.json({ alreadySubmitted: !!found }, 200);
  } catch (err) {
    console.error("checkQuizAlreadySubmittedController error:", err);
    return c.json({ alreadySubmitted: false }, 200);
  }
}

/**
 * POST /quiz-submissions
 * Body: { quizId, candidatureId, answers: [{ order, selectedAnswer }] }
 * Public — accessible par le candidat sans authentification
 */
export async function submitQuizController(c) {
  try {
    const body = await c.req.json();
    const { quizId, candidatureId, answers } = body;

    if (!quizId || !ObjectId.isValid(quizId)) {
      return c.json({ message: "quizId invalide" }, 400);
    }

    // ✅ IMPORTANT: obligatoire pour bloquer 2ème soumission
    if (!candidatureId || !ObjectId.isValid(candidatureId)) {
      return c.json({ message: "candidatureId requis" }, 400);
    }

    if (!Array.isArray(answers) || answers.length === 0) {
      return c.json({ message: "answers est requis" }, 400);
    }

    // ✅ Bloquer si déjà soumis
    const already = await findSubmissionByQuizAndCandidature(quizId, candidatureId);
    if (already) {
      return c.json(
        { message: "Quiz déjà soumis. Vous ne pouvez pas soumettre une deuxième fois." },
        409
      );
    }

    // Charger le quiz pour corriger les réponses
    const quiz = await findQuizById(quizId);
    if (!quiz) {
      return c.json({ message: "Quiz introuvable" }, 404);
    }

    // Correction automatique (score محفوظ في DB فقط)
    let score = 0;
    const gradedAnswers = answers.map((a) => {
      const question = quiz.questions.find((q) => q.order === a.order);
      if (!question) return { ...a, correctAnswer: null, isCorrect: false };

      const correct = String(question.correctAnswer ?? "").trim().toLowerCase();
      const selected = String(a.selectedAnswer ?? "").trim().toLowerCase();
      const isCorrect = correct !== "" && correct === selected;

      if (isCorrect) score++;

      return {
        order: a.order,
        question: question.question,
        selectedAnswer: a.selectedAnswer,
        correctAnswer: question.correctAnswer,
        isCorrect,
      };
    });

    const totalQuestions = quiz.questions.length;

    const result = await createQuizSubmission({
      quizId,
      candidatureId,
      answers: gradedAnswers,
      score,
      totalQuestions,
      submittedAt: new Date(),
    });

    // ✅ On ne renvoie PAS score/percentage au candidat
    return c.json(
      {
        success: true,
        submissionId: result.insertedId.toString(),
        message: "Soumission enregistrée",
      },
      201
    );
  } catch (err) {
    console.error("❌ submitQuiz error:", err);
    return c.json({ message: "Erreur serveur", error: err?.message }, 500);
  }
}

/**
 * GET /quiz-submissions/:id
 * Récupérer une soumission par ID
 */
export async function getSubmissionByIdController(c) {
  try {
    const id = c.req.param("id");

    if (!id || !ObjectId.isValid(id)) {
      return c.json({ message: "Invalid submission id" }, 400);
    }

    // ✅ FIX: استعمل function اللي موجودة و importée
    const submission = await findQuizSubmissionById(id);

    if (!submission) {
      return c.json({ message: "Submission not found" }, 404);
    }

    return c.json(submission, 200);
  } catch (err) {
    console.error("getSubmissionByIdController error:", err);
    return c.json({ message: "Internal server error" }, 500);
  }
}

/**
 * GET /quiz-submissions/quiz/:quizId
 * Toutes les soumissions d'un quiz (admin)
 */
export async function getSubmissionsByQuizController(c) {
  try {
    const { quizId } = c.req.param();
    const submissions = await findSubmissionsByQuizId(quizId);
    return c.json(submissions);
  } catch (err) {
    return c.json({ message: "Erreur serveur" }, 500);
  }
}

/**
 * GET /quiz-submissions/candidature/:candidatureId
 * Toutes les soumissions d'une candidature (admin)
 */
export async function getSubmissionsByCandidatureController(c) {
  try {
    const { candidatureId } = c.req.param();
    const submissions = await findSubmissionsByCandidatureId(candidatureId);
    return c.json(submissions);
  } catch (err) {
    return c.json({ message: "Erreur serveur" }, 500);
  }
}