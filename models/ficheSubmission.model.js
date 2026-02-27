import { ObjectId } from "mongodb";
import { getDB } from "./db.js";

const COLLECTION_NAME = "fiche_submissions";
const collection = () => getDB().collection(COLLECTION_NAME);

export async function findSubmissionByFicheAndCandidature(ficheId, candidatureId) {
  return collection().findOne({
    ficheId: new ObjectId(ficheId),
    candidatureId: new ObjectId(candidatureId),
  });
}

export async function createSubmission({ ficheId, candidatureId, candidatId }) {
  const doc = {
    ficheId: new ObjectId(ficheId),
    candidatureId: new ObjectId(candidatureId),
    candidatId: candidatId ? new ObjectId(candidatId) : null,

    answers: [], // { questionId, value, timeSpent }
    status: "IN_PROGRESS",

    startedAt: new Date(),
    finishedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const res = await collection().insertOne(doc);
  return { insertedId: res.insertedId, submission: doc };
}
export async function addAnswer(submissionId, answer) {
  await collection().updateOne(
    { _id: new ObjectId(submissionId) },
    {
      $push: { answers: answer },
      $set: { updatedAt: new Date() },
    }
  );

  // 🔥 on relit le document après update
  return collection().findOne({ _id: new ObjectId(submissionId) });
}



export async function submitSubmission(submissionId) {
  await collection().updateOne(
    { _id: new ObjectId(submissionId) },
    {
      $set: {
        status: "SUBMITTED",
        finishedAt: new Date(),
        updatedAt: new Date(),
      },
    }
  );

  return collection().findOne({ _id: new ObjectId(submissionId) });
}


export async function findSubmissionById(submissionId) {
  return collection().findOne({ _id: new ObjectId(submissionId) });
}
export async function saveSubmissionPdf(submissionId, pdfBuffer) {
  await collection().updateOne(
    { _id: new ObjectId(submissionId) },
    {
      $set: {
        pdf: {
          data: pdfBuffer, // Buffer
          contentType: "application/pdf",
          filename: `fiche_${submissionId}.pdf`,
        },
        pdfStoredAt: new Date(),
        updatedAt: new Date(),
      },
    }
  );

  return collection().findOne({ _id: new ObjectId(submissionId) });
}