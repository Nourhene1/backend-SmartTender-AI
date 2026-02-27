// ================================================================
// quizSubmission.model.js
// ================================================================
import { ObjectId } from "mongodb";
import { getDB } from "./db.js";

const COLLECTION = "quiz_submissions";
const col = () => getDB().collection(COLLECTION);

/**
 * Créer une soumission de quiz
 */
export async function createQuizSubmission({ quizId, candidatureId, answers, score, totalQuestions, submittedAt }) {
  return col().insertOne({
    quizId: ObjectId.isValid(quizId) ? new ObjectId(quizId) : quizId,
    candidatureId: candidatureId && ObjectId.isValid(candidatureId) ? new ObjectId(candidatureId) : null,
    answers: answers || [],      // [{ order, question, selectedAnswer, correctAnswer, isCorrect }]
    score,                       // nombre de bonnes réponses
    totalQuestions,
    percentage: totalQuestions > 0 ? Math.round((score / totalQuestions) * 100) : 0,
    status: "SUBMITTED",
    submittedAt: submittedAt || new Date(),
    createdAt: new Date(),
  });
}

/**
 * Trouver une soumission par ID
 */
export async function findQuizSubmissionById(id) {
  if (!ObjectId.isValid(id)) return null;
  return col().findOne({ _id: new ObjectId(id) });
}

/**
 * Toutes les soumissions d'un quiz
 */
export async function findSubmissionsByQuizId(quizId) {
  if (!ObjectId.isValid(quizId)) return [];
  return col()
    .find({ quizId: new ObjectId(quizId) })
    .sort({ submittedAt: -1 })
    .toArray();
}

/**
 * Soumissions liées à une candidature
 */
export async function findSubmissionsByCandidatureId(candidatureId) {
  if (!ObjectId.isValid(candidatureId)) return [];
  return col()
    .find({ candidatureId: new ObjectId(candidatureId) })
    .sort({ submittedAt: -1 })
    .toArray();
}
export async function findSubmissionById(id) {
  if (!ObjectId.isValid(id)) return null; // ✅ يحمي من BSONError
  return col().findOne({ _id: new ObjectId(id) });
}
// ✅ NEW: find by quiz + candidature


// ✅ NEW: check already submitted (quizId + candidatureId)
export async function findSubmissionByQuizAndCandidature(quizId, candidatureId) {
  if (!ObjectId.isValid(quizId) || !ObjectId.isValid(candidatureId)) return null;

  return col().findOne({
    quizId: new ObjectId(quizId),
    candidatureId: new ObjectId(candidatureId),
    status: "SUBMITTED",
  });
}