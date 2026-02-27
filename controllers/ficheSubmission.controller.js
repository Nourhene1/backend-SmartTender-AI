import {
  findSubmissionByFicheAndCandidature,
  createSubmission,
  addAnswer,
  submitSubmission,
  findSubmissionById,
} from "../models/ficheSubmission.model.js";
import PDFDocument from "pdfkit";

import { findFicheById } from "../models/FicheRenseignement.js";
import { saveSubmissionPdf } from "../models/ficheSubmission.model.js";
// ✅ Import de la fonction PDF complète
import { buildPDF } from "./Fichesubmission.controller.generatepdf.js";
function safeUserId(c) {
  // si tu as auth middleware qui met user
  const user = c.get("user"); // { _id, role, ... } selon ton projet
  return user?._id || user?.id || null;
}

/**
 * POST /fiche-submissions/start
 * body: { ficheId, candidatureId }
 * - refuse si déjà SUBMITTED
 * - renvoie submissionId
 */
export async function startSubmissionController(c) {
  try {
    const body = await c.req.json();
    const ficheId = body?.ficheId;
    const candidatureId = body?.candidatureId;

    if (!ficheId || !candidatureId) {
      return c.json({ message: "ficheId et candidatureId requis" }, 400);
    }

    const fiche = await findFicheById(ficheId);
    if (!fiche) return c.json({ message: "Fiche not found" }, 404);

    const existing = await findSubmissionByFicheAndCandidature(
      ficheId,
      candidatureId,
    );
    if (existing?.status === "SUBMITTED") {
      return c.json({ message: "Déjà soumis (une seule tentative)" }, 403);
    }

    if (existing?.status === "IN_PROGRESS") {
      // reprise autorisée OU non: toi tu veux "une seule fois" mais tu peux autoriser reprise tant que pas soumis
      return c.json(
        { success: true, submissionId: existing._id, status: existing.status },
        200,
      );
    }

    const candidatId = safeUserId(c); // optionnel
    const created = await createSubmission({
      ficheId,
      candidatureId,
      candidatId,
    });

    return c.json(
      {
        success: true,
        submissionId: created.insertedId,
        status: "IN_PROGRESS",
      },
      201,
    );
  } catch (e) {
    console.error("startSubmissionController error:", e);
    return c.json({ message: "Server error" }, 500);
  }
}

/**
 * POST /fiche-submissions/:submissionId/answer
 * body: { questionId, value, timeSpent }
 */
export async function addAnswerController(c) {
  try {
    const { submissionId } = c.req.param();
    const body = await c.req.json();

    console.log("=== ADD ANSWER DEBUG ===");
    console.log("submissionId =", submissionId);
    console.log("body =", body);

    const sub = await findSubmissionById(submissionId);
    console.log("submission from DB =", sub);

    const questionId = String(body?.questionId || "").trim();
    const value = body?.value;
    const timeSpent = Number(body?.timeSpent ?? 0);

    if (!submissionId) {
      console.log("❌ missing submissionId");
      return c.json({ message: "submissionId requis" }, 400);
    }

    if (!questionId) {
      console.log("❌ missing questionId");
      return c.json({ message: "questionId requis" }, 400);
    }

    const answer = {
      questionId,
      value,
      timeSpent: Number.isFinite(timeSpent) ? timeSpent : 0,
      createdAt: new Date(),
    };

    console.log("answer to push =", answer);

    const updated = await addAnswer(submissionId, answer);
    console.log("updated result =", updated);

    if (!updated) {
      console.log("❌ update returned null");
      return c.json(
        { message: "Submission not found / already submitted" },
        404,
      );
    }

    console.log("✅ answer saved");

    return c.json({ success: true, submission: updated }, 200);
  } catch (e) {
    console.error("addAnswerController error:", e);
    return c.json({ message: "Server error" }, 500);
  }
}

/**
 * POST /fiche-submissions/:submissionId/submit
 */


export async function submitController(c) {
  try {
    const { submissionId } = c.req.param();
    if (!submissionId) return c.json({ message: "submissionId requis" }, 400);

    const updated = await submitSubmission(submissionId);
    if (!updated) return c.json({ message: "Submission not found / already submitted" }, 404);

    // ✅ توليد + تخزين PDF مباشرة بعد submit
    await buildPdfBuffer(submissionId);

    // ✅ رجّع submission بعد التخزين
    const finalSub = await findSubmissionById(submissionId);

    return c.json({ success: true, submission: finalSub }, 200);
  } catch (e) {
    console.error("submitController error:", e);
    return c.json({ message: "Server error" }, 500);
  }
}
/**
 * GET /fiche-submissions/:submissionId
 */
export async function getSubmissionByIdController(c) {
  try {
    const { submissionId } = c.req.param();
    const sub = await findSubmissionById(submissionId);
    if (!sub) return c.json({ message: "Not found" }, 404);
    return c.json({ success: true, submission: sub }, 200);
  } catch (e) {
    console.error("getSubmissionByIdController error:", e);
    return c.json({ message: "Server error" }, 500);
  }
}

/**
 * 🆕 GET /fiche-submissions/candidature/:candidatureId
 * Admin — toutes les soumissions d'une candidature avec answers
 */
export async function getSubmissionsByCandidatureController(c) {
  try {
    const { candidatureId } = c.req.param();

    const { ObjectId } = await import("mongodb");
    const { getDB } = await import("../models/db.js");

    if (!ObjectId.isValid(candidatureId)) {
      return c.json([], 200);
    }

    const col = getDB().collection("fiche_submissions");
    const candObjId = new ObjectId(candidatureId);

    const submissions = await col
      .aggregate([
        {
          $match: {
            $or: [
              { candidatureId: candObjId }, // إذا stored كـ ObjectId
              { candidatureId: candidatureId }, // إذا stored كـ string
            ],
          },
        },
        {
          $lookup: {
            from: "fiches_renseignement",
            localField: "ficheId",
            foreignField: "_id",
            as: "_fiche",
          },
        },
        {
          $addFields: {
            ficheTitle: {
              $ifNull: [{ $arrayElemAt: ["$_fiche.title", 0] }, "—"],
            },
            ficheQuestions: {
              $ifNull: [{ $arrayElemAt: ["$_fiche.questions", 0] }, []],
            },
          },
        },
        { $project: { _fiche: 0 } },
        { $sort: { createdAt: -1 } },
      ])
      .toArray();

    // Enrichir les answers avec les labels des questions
    const enriched = submissions.map((sub) => {
      const questions = sub.ficheQuestions || [];
      const answers = (sub.answers || []).map((a) => {
        const q = questions.find(
          (q) =>
            String(q._id) === String(a.questionId) || q.id === a.questionId,
        );
        return {
          ...a,
          label: q?.label || q?.text || q?.question || a.questionId,
        };
      });
      return { ...sub, answers, ficheQuestions: undefined };
    });

    return c.json(enriched, 200);
  } catch (e) {
    console.error("getSubmissionsByCandidatureController error:", e);
    return c.json([], 200);
  }
}

/**
 * ✅ Génère le PDF et le stocke dans MongoDB après chaque submission
 */
async function buildPdfBuffer(submissionId) {
  const submission = await findSubmissionById(submissionId);
  if (!submission) return null;

  // Si PDF déjà stocké → retourner directement
  if (submission?.pdf?.data) {
    return {
      buffer: submission.pdf.data,
      filename: submission.pdf.filename || `fiche_${submissionId}.pdf`,
      contentType: "application/pdf",
      alreadyStored: true,
    };
  }

  // Charger la fiche pour les labels des questions
  const fiche = await findFicheById(submission.ficheId.toString());

  // Construire la map des questions
  const qMap = {};
  (fiche?.questions || []).forEach(q => { qMap[q.id] = q; });

  // Enrichir answers avec labels
  const answers = (submission.answers || []).map(a => ({
    ...a,
    label: qMap[a.questionId]?.label || a.label || a.questionId,
    type:  qMap[a.questionId]?.type  || "text",
  }));

  // Récupérer nom du candidat depuis DB
  let candidateName = "";
  try {
    const { getDB } = await import("../models/db.js");
    const { ObjectId } = await import("mongodb");
    const cand = await getDB().collection("candidatures").findOne(
      { _id: new ObjectId(submission.candidatureId) },
      { projection: { fullName: 1, prenom: 1, nom: 1, "extracted.parsed": 1 } }
    );
    if (cand) {
      candidateName = cand.fullName
        || cand?.extracted?.parsed?.full_name
        || `${cand.prenom || ""} ${cand.nom || ""}`.trim()
        || "";
    }
  } catch {}

  // Générer PDF en mémoire avec pdfkit
  const doc = new PDFDocument({ size: "A4", margin: 0 });
  const chunks = [];
  doc.on("data", chunk => chunks.push(chunk));

  const endPromise = new Promise((resolve, reject) => {
    doc.on("end", resolve);
    doc.on("error", reject);
  });

  buildPDF(doc, { answers, fiche, candidateName, submission });
  doc.end();
  await endPromise;

  const buffer = Buffer.concat(chunks);

  // Stocker le PDF dans MongoDB
  await saveSubmissionPdf(submissionId, buffer);

  return {
    buffer,
    filename: `fiche_${candidateName.replace(/\s+/g, "_") || submissionId}.pdf`,
    contentType: "application/pdf",
    alreadyStored: false,
  };
}