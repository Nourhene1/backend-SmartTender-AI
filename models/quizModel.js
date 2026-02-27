import { ObjectId } from "mongodb";
import { getDB } from "./db.js";

const COLLECTION_NAME = "quizzes";
const collection = () => getDB().collection(COLLECTION_NAME);

/**
 * ✅ Pipeline $lookup réutilisable pour résoudre le jobTitle
 */
function jobTitleLookupStages() {
  return [
    {
      $lookup: {
        from: "job_offers",
        localField: "jobOfferId",
        foreignField: "_id",
        as: "_job",
      },
    },
    {
      $addFields: {
        jobTitle: {
          $let: {
            vars: { job: { $arrayElemAt: ["$_job", 0] } },
            in: {
              $cond: {
                if: { $ne: ["$$job", null] },
                then: {
                  $ifNull: [
                    "$$job.titre",
                    { $ifNull: ["$$job.title", "Sans titre"] },
                  ],
                },
                else: {
                  $cond: {
                    if: {
                      $and: [
                        { $ne: ["$jobTitle", null] },
                        { $ne: ["$jobTitle", "Sans titre"] },
                      ],
                    },
                    then: "$jobTitle",
                    else: "Sans titre",
                  },
                },
              },
            },
          },
        },
      },
    },
    { $project: { _job: 0 } },
  ];
}

/**
 * Créer un quiz pour une offre d'emploi
 */
export async function createQuiz({ jobOfferId, jobTitle, questions, generatedBy }) {
  const jobId =
    typeof jobOfferId === "string" ? new ObjectId(jobOfferId) : jobOfferId;

  return collection().insertOne({
    jobOfferId: jobId,
    jobTitle: jobTitle || "Sans titre",
    questions: questions || [],
    totalQuestions: questions?.length || 0,
    generatedBy: generatedBy || "auto",
    status: "ACTIVE",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

/**
 * ✅ Trouver le quiz d'une offre d'emploi (avec $lookup pour le titre)
 */
export async function findQuizByJobId(jobOfferId) {
  if (!ObjectId.isValid(jobOfferId)) return null;

  const results = await collection()
    .aggregate([
      {
        $match: {
          jobOfferId: new ObjectId(jobOfferId),
          status: "ACTIVE",
        },
      },
      ...jobTitleLookupStages(),
      { $limit: 1 },
    ])
    .toArray();

  return results[0] || null;
}

/**
 * ✅ Trouver un quiz par ID (avec $lookup pour le titre)
 */
export async function findQuizById(id) {
  if (!ObjectId.isValid(id)) return null;

  const results = await collection()
    .aggregate([
      { $match: { _id: new ObjectId(id) } },
      ...jobTitleLookupStages(),
      { $limit: 1 },
    ])
    .toArray();

  return results[0] || null;
}

/**
 * Mettre à jour tout le quiz (remplacer les questions)
 */
export async function updateQuiz(id, data) {
  if (!ObjectId.isValid(id)) throw new Error("Invalid quiz ID");

  const updateData = { ...data, updatedAt: new Date() };

  if (updateData.questions) {
    updateData.totalQuestions = updateData.questions.length;
  }

  return collection().updateOne(
    { _id: new ObjectId(id) },
    { $set: updateData }
  );
}

/**
 * Mettre à jour une seule question dans le quiz
 */
export async function updateQuizQuestion(quizId, questionOrder, questionData) {
  if (!ObjectId.isValid(quizId)) throw new Error("Invalid quiz ID");

  return collection().updateOne(
    { _id: new ObjectId(quizId), "questions.order": questionOrder },
    {
      $set: {
        "questions.$": { ...questionData, order: questionOrder },
        updatedAt: new Date(),
      },
    }
  );
}

/**
 * Supprimer une question du quiz
 */
export async function deleteQuizQuestion(quizId, questionOrder) {
  if (!ObjectId.isValid(quizId)) throw new Error("Invalid quiz ID");

  const result = await collection().updateOne(
    { _id: new ObjectId(quizId) },
    {
      $pull: { questions: { order: questionOrder } },
      $set: { updatedAt: new Date() },
    }
  );

  if (result.modifiedCount > 0) {
    const quiz = await collection().findOne({ _id: new ObjectId(quizId) });
    if (quiz) {
      const reordered = quiz.questions.map((q, i) => ({
        ...q,
        order: i + 1,
      }));
      await collection().updateOne(
        { _id: new ObjectId(quizId) },
        {
          $set: {
            questions: reordered,
            totalQuestions: reordered.length,
            updatedAt: new Date(),
          },
        }
      );
    }
  }

  return result;
}

/**
 * Ajouter une question au quiz
 */
export async function addQuizQuestion(quizId, questionData) {
  if (!ObjectId.isValid(quizId)) throw new Error("Invalid quiz ID");

  const quiz = await collection().findOne({ _id: new ObjectId(quizId) });
  if (!quiz) throw new Error("Quiz not found");

  const newOrder = (quiz.questions?.length || 0) + 1;

  return collection().updateOne(
    { _id: new ObjectId(quizId) },
    {
      $push: { questions: { ...questionData, order: newOrder } },
      $inc: { totalQuestions: 1 },
      $set: { updatedAt: new Date() },
    }
  );
}

/**
 * ✅ Ajouter plusieurs questions au quiz existant (append, pas replace)
 */
export async function appendQuestionsToQuiz(quizId, newQuestions) {
  if (!ObjectId.isValid(quizId)) throw new Error("Invalid quiz ID");

  const quiz = await collection().findOne({ _id: new ObjectId(quizId) });
  if (!quiz) throw new Error("Quiz not found");

  const currentCount = quiz.questions?.length || 0;

  // Réindexer les nouvelles questions à partir de currentCount + 1
  const reindexed = newQuestions.map((q, i) => ({
    ...q,
    order: currentCount + i + 1,
  }));

  return collection().updateOne(
    { _id: new ObjectId(quizId) },
    {
      $push: { questions: { $each: reindexed } },
      $set: {
        totalQuestions: currentCount + reindexed.length,
        updatedAt: new Date(),
      },
    }
  );
}

/**
 * Supprimer un quiz complet
 */
export async function deleteQuiz(id) {
  if (!ObjectId.isValid(id)) throw new Error("Invalid quiz ID");
  return collection().deleteOne({ _id: new ObjectId(id) });
}

/**
 * Supprimer le quiz d'une offre (quand l'offre est supprimée)
 */
export async function deleteQuizByJobId(jobOfferId) {
  if (!ObjectId.isValid(jobOfferId)) return;
  return collection().deleteMany({
    jobOfferId: new ObjectId(jobOfferId),
  });
}

/**
 * ✅ Récupérer tous les quiz (liste) avec $lookup pour le titre du job
 */
export async function findAllQuizzes({ status = "ACTIVE", includeQuestions = false } = {}) {
  const pipeline = [];

  if (status) {
    pipeline.push({ $match: { status } });
  }

  pipeline.push(...jobTitleLookupStages());

  if (!includeQuestions) {
    pipeline.push({ $project: { questions: 0 } });
  }

  pipeline.push({ $sort: { createdAt: -1 } });

  return collection().aggregate(pipeline).toArray();
}


export async function findQuizzesForUser(userId) {
  if (!ObjectId.isValid(userId)) return [];

  const uid = new ObjectId(userId);

  return collection()
    .aggregate([
      {
        $lookup: {
          from: "job_offers",
          localField: "jobOfferId",
          foreignField: "_id",
          as: "job",
        },
      },
      { $unwind: "$job" },

      // ✅ Filtre accès responsable
      {
        $match: {
          $or: [
            { "job.createdBy": uid },
            { "job.assignedUserIds": uid },
          ],
        },
      },

      // champs utiles
      {
        $addFields: {
          jobTitle: "$job.titre",
          jobStatus: "$job.status",
          jobDateCloture: "$job.dateCloture",
        },
      },

      { $project: { job: 0 } },
      { $sort: { createdAt: -1 } },
    ])
    .toArray();
}