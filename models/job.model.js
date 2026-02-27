import { ObjectId } from "mongodb";
import { getDB } from "./db.js";
import { deleteQuizByJobId } from "./quizModel.js";

const COLLECTION_NAME = "job_offers";
const collection = () => getDB().collection(COLLECTION_NAME);

export const JOB_STATUS = {
  EN_ATTENTE: "EN_ATTENTE",   // créée
  VALIDEE: "VALIDEE",         // validation interne admin
  CONFIRMEE: "CONFIRMEE",     // publique + LinkedIn autorisé
  REJETEE: "REJETEE",
};
function pickOptionalFields(obj) {
  const out = {};
  if (!obj || typeof obj !== "object") return out;

  for (const [k, v] of Object.entries(obj)) {
    // garder 0 et false, enlever seulement undefined/null/""
    if (v !== undefined && v !== null && v !== "") {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Create a new job offer
 */
export async function createJobOffer({
  titre,
  description,
  softSkills,
  hardSkills,
  dateCloture,
  scores,
  status,
  createdBy,
  lieu = "",
  generateQuiz = true,
  numQuestions = 25,

  // ✅ champs optionnels (root)
  salaire,
  typeContrat,
  motif,
  sexe,
  typeDiplome,

  // ✅ si jamais le front les envoie dans un objet
  optionalFields,
}) {
  const creatorId = createdBy
    ? typeof createdBy === "string"
      ? new ObjectId(createdBy)
      : createdBy
    : null;

  // ✅ supporte 2 formats: root OU optionalFields
  const mergedOptional = {
    salaire: salaire ?? optionalFields?.salaire,
    typeContrat: typeContrat ?? optionalFields?.typeContrat,
    motif: motif ?? optionalFields?.motif,
    sexe: sexe ?? optionalFields?.sexe,
    typeDiplome: typeDiplome ?? optionalFields?.typeDiplome,
  };

  const normalizedOptionals = pickOptionalFields({
    salaire: normalizeSalaire(mergedOptional.salaire),
    typeContrat: normalizeText(mergedOptional.typeContrat),
    motif: normalizeText(mergedOptional.motif),
    sexe: normalizeText(mergedOptional.sexe),
    typeDiplome: normalizeText(mergedOptional.typeDiplome),
  });

  // ✅ DEBUG: enlève après test
  console.log("CREATE JOB optional fields received:", mergedOptional);
  console.log("CREATE JOB optional fields saved:", normalizedOptionals);

  return collection().insertOne({
    titre,
    description,
    lieu: lieu || "",
    softSkills: softSkills || [],
    hardSkills: hardSkills || [],
    dateCloture: dateCloture ? new Date(dateCloture) : null,

    scores: scores,

    assignedUserIds: creatorId ? [creatorId] : [],
    createdBy: creatorId,

    status: status || JOB_STATUS.EN_ATTENTE,

    generateQuiz: generateQuiz !== false,
    numQuestions:
      typeof numQuestions === "number" && numQuestions >= 1 && numQuestions <= 30
        ? numQuestions
        : 25,

    // ✅ champs optionnels (sauvegardés si définis)
    ...normalizedOptionals,

    reactivations: [],
    createdAt: new Date(),
  });
}
function normalizeText(value) {
  if (value == null) return undefined;
  const s = String(value).trim();
  return s.length ? s : undefined;
}
function normalizeSalaire(value) {
  if (value == null) return undefined;
  if (typeof value === "number") return value; // ex: 2500
  const s = String(value).trim(); // ex: "2500 TND" / "2000-2500"
  return s.length ? s : undefined;
}
/* ===================== UPDATE ===================== */
export async function updateJobOffer(id, data) {
  if (!ObjectId.isValid(id)) throw new Error("Invalid job ID");

  const updateData = { ...data };

  // date
  if (updateData.dateCloture) {
    updateData.dateCloture = new Date(updateData.dateCloture);
  }

  // assignedUserIds
  if (updateData.assignedUserIds && Array.isArray(updateData.assignedUserIds)) {
    updateData.assignedUserIds = updateData.assignedUserIds.map((uid) =>
      typeof uid === "string" ? new ObjectId(uid) : uid
    );
  }

  // ✅ nouveaux champs (optionnels)
  if ("salaire" in updateData) {
    const v = normalizeSalaire(updateData.salaire);
    if (v === undefined) delete updateData.salaire;
    else updateData.salaire = v;
  }

  if ("typeContrat" in updateData) {
    const v = normalizeText(updateData.typeContrat);
    if (v === undefined) delete updateData.typeContrat;
    else updateData.typeContrat = v;
  }

  if ("motif" in updateData) {
    const v = normalizeText(updateData.motif);
    if (v === undefined) delete updateData.motif;
    else updateData.motif = v;
  }

  if ("sexe" in updateData) {
    const v = normalizeText(updateData.sexe);
    if (v === undefined) delete updateData.sexe;
    else updateData.sexe = v;
  }

  if ("typeDiplome" in updateData) {
    const v = normalizeText(updateData.typeDiplome);
    if (v === undefined) delete updateData.typeDiplome;
    else updateData.typeDiplome = v;
  }

  updateData.updatedAt = new Date();

  return collection().updateOne(
    { _id: new ObjectId(id) },
    { $set: updateData }
  );
}

/**
 * Find all job offers (admin)
 */
export async function findAllJobOffers() {
  return collection().find().sort({ createdAt: -1 }).toArray();
}

/**
 * ✅ OFFRES PUBLIQUES (candidats)
 * On accepte PUBLIEE + legacy CONFIRMEE (pour ne rien casser)
 */
export async function findPublicJobOffers() {
  return collection()
    .find({ status: JOB_STATUS.CONFIRMEE })
    .sort({ createdAt: -1 })
    .toArray();
}
/**
 * ✅ Find pending job offers (admin – offres à valider)
 */
export async function findPendingJobOffers() {
  return collection()
    .find({ status: JOB_STATUS.EN_ATTENTE })
    .sort({ createdAt: -1 })
    .toArray();
}

/**
 * ✅ Find validated offers (admin – prêtes à publier)
 */
export async function findValidatedJobOffers() {
  return collection()
    .find({ status: JOB_STATUS.VALIDEE })
    .sort({ createdAt: -1 })
    .toArray();
}

/**
 * Find job offer by ID
 */
export async function findJobOfferById(id) {
  if (!ObjectId.isValid(id)) return null;
  return collection().findOne({ _id: new ObjectId(id) });
}

/**
 * Update job offer
 */


/**
 * ✅ Update status (valider/publier/rejeter)
 */
export async function updateJobOfferStatus(id, status, actorId) {
  if (!ObjectId.isValid(id)) throw new Error("Invalid job ID");

  const updateData = { status, updatedAt: new Date() };

  // ✅ Historique simple par étape
  if (actorId) {
    const oid = typeof actorId === "string" ? new ObjectId(actorId) : actorId;

    if (status === JOB_STATUS.VALIDEE) {
      updateData.validatedBy = oid;
      updateData.validatedAt = new Date();
    }

    if (status === JOB_STATUS.PUBLIEE || status === JOB_STATUS.CONFIRMEE) {
      updateData.publishedBy = oid;
      updateData.publishedAt = new Date();
    }

    if (status === JOB_STATUS.REJETEE) {
      updateData.rejectedBy = oid;
      updateData.rejectedAt = new Date();
    }
  }

  return collection().updateOne({ _id: new ObjectId(id) }, { $set: updateData });
}

/**
 * Delete job offer
 */
export async function deleteJobOffer(id) {
  if (!ObjectId.isValid(id)) throw new Error("Invalid job ID");
  return collection().deleteOne({ _id: new ObjectId(id) });
}

/**
 * Count total job offers
 */
export async function countJobOffers() {
  return collection().countDocuments();
}

/**
 * Count by status
 */
export async function countJobOffersByStatus(status) {
  return collection().countDocuments({ status });
}

/**
 * Find all job offers with candidature count
 */
export async function findAllJobOffersWithCandidatureCount() {
  return collection()
    .aggregate([
      {
        $lookup: {
          from: "candidatures",
          localField: "_id",
          foreignField: "jobOfferId",
          as: "candidatures",
        },
      },
      { $addFields: { candidaturesCount: { $size: "$candidatures" } } },
      { $project: { candidatures: 0 } },
      { $sort: { createdAt: -1 } },
    ])
    .toArray();
}

/**
 * Find job offers by assigned user
 */
export async function findJobOffersByUser(userId) {
  if (!ObjectId.isValid(userId)) return [];
  return collection()
    .find({ assignedUserIds: new ObjectId(userId) })
    .sort({ createdAt: -1 })
    .toArray();
}

/**
 * Find job offers created by a specific user
 */
export async function findJobOffersByCreator(userId) {
  if (!ObjectId.isValid(userId)) return [];
  return collection()
    .find({ createdBy: new ObjectId(userId) })
    .sort({ createdAt: -1 })
    .toArray();
}

/**
 * Check if job offer is closed
 */
export async function isJobOfferClosed(id) {
  if (!ObjectId.isValid(id)) return true;
  const job = await collection().findOne({ _id: new ObjectId(id) });
  if (!job) return true;
  if (!job.dateCloture) return false;
  return new Date() > new Date(job.dateCloture);
}

/**
 * ✅ Find active AND PUBLIC job offers
 */
export async function findActiveJobOffers() {
  return collection()
    .find({
      status: JOB_STATUS.CONFIRMEE,
      $or: [
        { dateCloture: null },
        { dateCloture: { $gte: new Date() } },
      ],
    })
    .sort({ createdAt: -1 })
    .toArray();
}

/**
 * ✅ Reactivate an expired public job offer
 */
export async function reactivateJobOffer(id, newDateCloture, reactivatedBy) {
  if (!ObjectId.isValid(id)) throw new Error("Invalid job ID");

  const newDate = new Date(newDateCloture);

  return collection().updateOne(
    { _id: new ObjectId(id) },
    {
      $set: {
        dateCloture: newDate,
        status: JOB_STATUS.CONFIRMEE,
        updatedAt: new Date(),
      },
      $push: {
        reactivations: {
          date: new Date(),
          newDateCloture: newDate,
          reactivatedBy: reactivatedBy ? new ObjectId(reactivatedBy) : null,
        },
      },
    }
  );
}
export async function findMyJobOffersWithoutQuiz(userId) {
  if (!ObjectId.isValid(userId)) return [];

  const uid = new ObjectId(userId);

  return collection()
    .aggregate([
      // ✅ jobs accessibles par le user (créateur OU assigné)
      {
        $match: {
          $or: [{ createdBy: uid }, { assignedUserIds: uid }],
        },
      },

      // ✅ lookup quizzes ACTIVE liés à ce job
      {
        $lookup: {
          from: "quizzes",
          let: { jobId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ["$jobOfferId", "$$jobId"] },
                status: "ACTIVE",
              },
            },
            { $project: { _id: 1 } },
            { $limit: 1 },
          ],
          as: "_quiz",
        },
      },

      // ✅ garder seulement ceux sans quiz
      {
        $match: {
          $expr: { $eq: [{ $size: "$_quiz" }, 0] },
        },
      },

      { $project: { _quiz: 0 } },
      { $sort: { createdAt: -1 } },
    ])
    .toArray();
}
