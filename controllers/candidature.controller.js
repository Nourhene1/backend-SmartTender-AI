// src/controllers/candidature.controller.js
// ✅ REFACTO COMPLET: Fini les jobs — candidats postulent aux TENDERS uniquement
// Collection: tender_applications (au lieu de candidatures)

import fs from "node:fs/promises";
import fsSync from "fs";
import path from "node:path";
import { ObjectId } from "mongodb";
import axios from "axios";
import FormData from "form-data";
import { getDB } from "../models/db.js";
import { createNotificationForAdmins, NOTIFICATION_TYPES } from "../models/Notification.model.js";
import { findUserByEmail, createUser } from "../models/user.model.js";
import { sendCandidateWelcomeEmail } from "../services/mail.service.js";

/* ── Config ──────────────────────────────────────────────── */
const UPLOAD_DIR  = path.join(process.cwd(), "uploads", "cvs");
const FASTAPI_URL = process.env.ML_SERVICE_URL || "http://localhost:8000";
if (!process.env.ML_SERVICE_URL) {
  console.warn("⚠️  ML_SERVICE_URL not set in .env — using http://localhost:8000");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── Collections ─────────────────────────────────────────── */
const tenderCol = () => getDB().collection("tenders");
const applyCol  = () => getDB().collection("tender_applications");

/* ── Worker locks ────────────────────────────────────────── */
let aiDetectionWorkerRunning = false;
let tenderMatchWorkerRunning = false;

/* =========================================================
   HELPER: Extract CV Text
   Priorité: texte_brut sauvé par cv_tasks.py → reconstruction fragments
========================================================= */
function extractCvText(extracted) {
  if (!extracted) return null;

  // ✅ Source la plus fiable — sauvegardée par cv_tasks.py
  const brut =
    extracted?.texte_brut ||
    extracted?.parsed?.texte_brut ||
    extracted?.raw_text ||
    null;

  if (brut && brut.trim().length >= 100) return brut.trim();

  // Fallback: reconstruction depuis structure parsée
  let data = extracted;
  if (extracted.parsed && typeof extracted.parsed === "object") {
    data = extracted.parsed;
  }

  const parts = [];
  const pi = data.personal_info || data;

  ["full_name", "nom", "name", "email", "titre_poste", "profil", "summary"].forEach((f) => {
    if (pi[f] && typeof pi[f] === "string") parts.push(pi[f]);
  });

  ["experience_professionnelle", "experience", "work_experience", "experiences"].forEach((f) => {
    if (Array.isArray(data[f])) {
      data[f].forEach((e) => {
        ["poste", "position", "title", "role", "entreprise", "company", "description"].forEach((sf) => {
          if (e[sf]) parts.push(String(e[sf]));
        });
      });
    }
  });

  ["competences", "skills"].forEach((f) => {
    if (data[f] && typeof data[f] === "object") {
      Object.values(data[f]).forEach((v) => {
        if (Array.isArray(v)) parts.push(...v.map(String));
        else if (typeof v === "string") parts.push(v);
      });
    }
  });

  ["formation", "education", "formations"].forEach((f) => {
    if (Array.isArray(data[f])) {
      data[f].forEach((e) => {
        ["diplome", "degree", "etablissement", "institution"].forEach((sf) => {
          if (e[sf]) parts.push(String(e[sf]));
        });
      });
    }
  });

  const result = parts.filter(Boolean).map((p) => p.trim()).join(" ");
  return result.length > 0 ? result : null;
}

/* =========================================================
   CONTROLLER: Upload CV
   POST /applications/:tenderId/cv
   (ancienne route: /applications/:jobId/cv → compatible via param alias)
========================================================= */
export const uploadCv = async (c) => {
  let filePath = null;

  try {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });

    const body     = await c.req.parseBody();
    const file     = body.cv;
    const tenderId = c.req.param("tenderId") || c.req.param("jobId");

    if (!file || typeof file.arrayBuffer !== "function") {
      return c.json({ message: "CV requis (PDF)" }, 400);
    }
    if (!tenderId || !ObjectId.isValid(tenderId)) {
      return c.json({ message: "tenderId invalide" }, 400);
    }

    // Vérifier que le tender existe
    const tender = await tenderCol().findOne({
      _id: new ObjectId(tenderId),
      status: { $ne: "ARCHIVED" },
    });
    if (!tender) return c.json({ message: "Tender non disponible" }, 404);

    // Sauvegarder le fichier
    const safeName = file.name.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9._-]/g, "");
    const fileName = `${Date.now()}-${safeName}`;
    filePath = path.join(UPLOAD_DIR, fileName);
    fsSync.writeFileSync(filePath, Buffer.from(await file.arrayBuffer()));

    // Envoyer à FastAPI pour extraction async
    const form = new FormData();
    form.append("cv", fsSync.createReadStream(filePath), {
      filename:    fileName,
      contentType: "application/pdf",
    });

    const startRes = await axios.post(`${FASTAPI_URL}/cv/extract`, form, {
      headers: form.getHeaders(),
      timeout: 30000,
    });

    const jobId = startRes.data?.job_id;
    if (!jobId) throw new Error("FastAPI n'a pas retourné de job_id");

    // Polling
    let extracted = null;
    for (let i = 0; i < 60; i++) {
      const statusRes = await axios.get(`${FASTAPI_URL}/cv/status/${jobId}`, { timeout: 15000 });
      if (statusRes.data.status === "COMPLETED") { extracted = statusRes.data.result || {}; break; }
      if (statusRes.data.status === "FAILED")    { throw new Error(statusRes.data.error || "Extraction échouée"); }
      await sleep(2000);
    }
    if (!extracted) throw new Error("Extraction timeout (120s)");

    // Extraire email pour vérif doublon
    const email = (
      extracted?.parsed?.personal_info?.email ||
      extracted?.personal_info?.email ||
      extracted?.email ||
      ""
    ).toLowerCase();

    if (email) {
      const existing = await applyCol().findOne({
        tenderId: new ObjectId(tenderId),
        email,
        status:   { $ne: "DRAFT" },
      });
      if (existing) {
        fsSync.unlinkSync(filePath);
        return c.json({ message: "Vous avez déjà postulé à cet appel d'offres.", code: "ALREADY_SUBMITTED" }, 409);
      }
    }

    // Créer la candidature DRAFT
    const result = await applyCol().insertOne({
      tenderId:    new ObjectId(tenderId),
      tenderTitre: tender.titre || "",
      cv: { fileUrl: `/uploads/cvs/${fileName}`, originalName: file.name },
      extracted,
      email:       email || null,
      status:      "DRAFT",
      aiDetection: { status: "PENDING" },
      tenderMatch: { status: "PENDING" },
      matchScore:  null,
      createdAt:   new Date(),
      updatedAt:   new Date(),
    });

    return c.json({
      candidatureId: result.insertedId.toString(),
      cvFileUrl:     `/uploads/cvs/${fileName}`,
      extracted,
    });
  } catch (err) {
    console.error("❌ uploadCv error:", err.message);
    if (filePath && fsSync.existsSync(filePath)) fsSync.unlinkSync(filePath);
    return c.json({ success: false, message: "Échec du traitement du CV", error: err.message }, 500);
  }
};

/* =========================================================
   CONTROLLER: Confirm Application
   POST /applications/:candidatureId/confirm
========================================================= */
export const confirmApplication = async (c) => {
  try {
    const candidatureId = c.req.param("candidatureId");
    const body = await c.req.json();

    if (!ObjectId.isValid(candidatureId)) {
      return c.json({ message: "candidatureId invalide" }, 400);
    }

    const doc = await applyCol().findOne({ _id: new ObjectId(candidatureId) });
    if (!doc) return c.json({ message: "Candidature introuvable" }, 404);

    // Extraire infos finales du formulaire
    const parsed = body?.parsed || body?.extracted?.parsed || {};
    const pi     = parsed?.personal_info || parsed || {};

    const fullName   = pi.full_name || pi.nom || pi.name || body?.fullName || doc.fullName || "";
    const email      = (pi.email || body?.email || doc.email || "").toLowerCase();
    const phone      = pi.telephone || pi.phone || body?.phone || doc.phone || "";
    const motivation = body?.motivation || doc.motivation || "";

    // Vérif doublon
    if (email && doc.tenderId) {
      const existing = await applyCol().findOne({
        tenderId: doc.tenderId,
        email,
        status:   { $ne: "DRAFT" },
        _id:      { $ne: new ObjectId(candidatureId) },
      });
      if (existing) {
        return c.json({ message: "Vous avez déjà postulé à cet appel d'offres.", code: "ALREADY_SUBMITTED" }, 409);
      }
    }

    // Fusionner extracted
    const mergedExtracted = { ...(doc.extracted || {}), ...(body?.extracted || {}) };
    if (body?.parsed) mergedExtracted.parsed = body.parsed;

    await applyCol().updateOne(
      { _id: new ObjectId(candidatureId) },
      {
        $set: {
          fullName, email, phone, motivation,
          extracted:  mergedExtracted,
          status:     "SUBMITTED",
          updatedAt:  new Date(),
        },
      }
    );

    // Notification admins
    try {
      await createNotificationForAdmins({
        type:    NOTIFICATION_TYPES.NEW_CANDIDATURE,
        message: `Nouvelle candidature de ${fullName || email || "Candidat"} pour "${doc.tenderTitre || "Tender"}"`,
        link:    `/recruiter/tenders`,
        metadata: { candidatureId, candidatName: fullName, tenderTitre: doc.tenderTitre },
      });
    } catch (notifErr) {
      console.error("⚠️ Notification error:", notifErr.message);
    }

    // ✅ Création compte candidat automatique
    if (email) {
      try {
        const existingUser = await findUserByEmail(email);
        if (!existingUser) {
          // Générer un mot de passe temporaire
          const tempPassword = Math.random().toString(36).slice(-8) + "A1!";
          const { hashPassword } = await import("../utils/password.js");
          const hashed = await hashPassword(tempPassword);

          const nameParts = fullName.trim().split(" ");
          const prenom = nameParts[0] || "";
          const nom    = nameParts.slice(1).join(" ") || "";

          await createUser({
            nom, prenom, email,
            password: hashed,
            role: "CANDIDATE",
          });

          // Envoyer email de bienvenue avec identifiants
          await sendCandidateWelcomeEmail(email, {
            fullName: fullName || email,
            email,
            password: tempPassword,
            loginUrl: `${process.env.FRONT_URL}/candidate/login`,
          });

          console.log("✅ Compte candidat créé pour:", email);
        }
      } catch (accountErr) {
        // Ne pas bloquer la candidature si la création du compte échoue
        console.error("⚠️ Erreur création compte candidat:", accountErr.message);
      }
    }

    // Déclencher les workers
    triggerAiDetectionWorker();
    triggerTenderMatchWorker();

    return c.json({ message: "Candidature envoyée avec succès. Analyse en cours." });
  } catch (err) {
    console.error("❌ confirmApplication error:", err);
    return c.json({ message: "Submit failed", error: err.message }, 500);
  }
};

/* =========================================================
   WORKER: AI Detection
========================================================= */
function triggerAiDetectionWorker() {
  if (aiDetectionWorkerRunning) return;
  aiDetectionWorkerRunning = true;
  processPendingAiDetections(1)
    .catch((err) => console.error("❌ AI detection worker:", err))
    .finally(() => { aiDetectionWorkerRunning = false; });
}

export async function processPendingAiDetections(limit = 1) {
  const docs = await applyCol()
    .find({ status: "SUBMITTED", "aiDetection.status": "PENDING" })
    .limit(limit).toArray();

  for (const doc of docs) {
    await applyCol().updateOne({ _id: doc._id }, { $set: { "aiDetection.status": "PROCESSING" } });
    try {
      const cvText = extractCvText(doc.extracted);
      if (!cvText || cvText.trim().length < 50) throw new Error("CV text trop court");

      const res = await axios.post(
        `${FASTAPI_URL}/analyze/ai-detection`,
        { candidatureId: doc._id.toString(), cvText },
        { timeout: 60000 }
      );

      await applyCol().updateOne({ _id: doc._id }, {
        $set: {
          "aiDetection.status":      "DONE",
          "aiDetection.isAI":        res.data.isAIGenerated,
          "aiDetection.confidence":  res.data.confidence,
          "aiDetection.explanation": res.data.explanation,
          updatedAt: new Date(),
        },
      });
      console.log("✅ AI detection:", doc._id, "isAI:", res.data.isAIGenerated);
      await sleep(2000);
    } catch (err) {
      console.error("❌ AI detection failed:", err.message);
      await applyCol().updateOne({ _id: doc._id }, {
        $set: { "aiDetection.status": "FAILED", "aiDetection.error": err.message }
      });
      await sleep(3000);
    }
  }
}

/* =========================================================
   WORKER: Tender Match
   ✅ Compare CV du candidat vs exigences du TENDER
   Réutilise /analyze/job-match en passant tender.resume + competences comme "job"
========================================================= */
function triggerTenderMatchWorker() {
  if (tenderMatchWorkerRunning) return;
  tenderMatchWorkerRunning = true;
  processPendingTenderMatches(1)
    .catch((err) => console.error("❌ Tender match worker:", err))
    .finally(() => { tenderMatchWorkerRunning = false; });
}

export async function processPendingTenderMatches(limit = 1) {
  const docs = await applyCol()
    .find({ status: "SUBMITTED", "tenderMatch.status": "PENDING" })
    .limit(limit).toArray();

  for (const doc of docs) {
    await applyCol().updateOne({ _id: doc._id }, { $set: { "tenderMatch.status": "PROCESSING" } });
    try {
      const tender = await tenderCol().findOne({ _id: doc.tenderId });
      if (!tender) throw new Error(`Tender ${doc.tenderId} introuvable`);

      const cvText = extractCvText(doc.extracted);
      if (!cvText || cvText.trim().length < 50) throw new Error("CV text trop court");

      console.log("💼 Tender match:", doc._id, "→", tender.titre, "| CV:", cvText.length, "chars");

      // ✅ On envoie le tender comme "job" à FastAPI /analyze/job-match
      const payload = {
        candidatureId: doc._id.toString(),
        cvText,
        job: {
          titre:       tender.titre  || "Appel d'offres",
          description: tender.resume || "",
          hardSkills:  Array.isArray(tender.competences_requises) ? tender.competences_requises : [],
          softSkills:  Array.isArray(tender.keywords)             ? tender.keywords             : [],
        },
      };

      // Ajouter exigences techniques comme contexte si dispo
      const techReqs = tender.requirements?.technical;
      if (Array.isArray(techReqs) && techReqs.length > 0) {
        payload.job.description += `\n\nExigences techniques:\n${techReqs.join("\n")}`;
      }

      const res = await axios.post(`${FASTAPI_URL}/analyze/job-match`, payload, { timeout: 120000 });

      if (!res.data || res.data.status === "FAILED") {
        throw new Error(res.data?.error || "ML returned FAILED");
      }

      const score100 = Math.round((res.data.score || 0) * 100);

      await applyCol().updateOne({ _id: doc._id }, {
        $set: {
          "tenderMatch.status":             "DONE",
          "tenderMatch.score":              res.data.score,
          "tenderMatch.recommendation":     res.data.recommendation,
          "tenderMatch.detailedScores":     res.data.detailedScores,
          "tenderMatch.experienceAnalysis": res.data.experienceAnalysis,
          "tenderMatch.skillsAnalysis":     res.data.skillsAnalysis,
          "tenderMatch.summary":            res.data.summary,
          "tenderMatch.strengths":          res.data.strengths,
          "tenderMatch.weaknesses":         res.data.weaknesses,
          "tenderMatch.nextSteps":          res.data.nextSteps,
          matchScore:   score100,
          updatedAt:    new Date(),
        },
      });

      console.log("✅ Tender match done:", doc._id, "| score:", score100 + "%");
      await sleep(2000);
    } catch (err) {
      const errMsg = err.response?.data?.detail || err.response?.data || err.message;
      console.error("❌ Tender match failed:", errMsg);
      await applyCol().updateOne({ _id: doc._id }, {
        $set: { "tenderMatch.status": "FAILED", "tenderMatch.error": String(errMsg) }
      });
      await sleep(3000);
    }
  }
}

/* =========================================================
   CONTROLLER: Pre-Interview List
   GET /candidatures/pre-interview
   → Candidatures avec score ≥ 50% ou manuellement pré-sélectionnées
========================================================= */
export async function getPreInterviewListController(c) {
  try {
    const docs = await applyCol()
      .find({
        status: { $in: ["SUBMITTED", "REVIEWED", "ACCEPTED"] },
        $or: [
          { preInterview: true },
          { matchScore: { $gte: 50 } },
        ],
      })
      .sort({ matchScore: -1, createdAt: -1 })
      .toArray();

    return c.json(docs);
  } catch (err) {
    console.error("❌ getPreInterviewList error:", err);
    return c.json({ message: "Erreur serveur", error: err.message }, 500);
  }
}

export async function togglePreInterviewController(c) {
  try {
    const id   = c.req.param("id");
    const body = await c.req.json().catch(() => ({})); // ✅ évite le crash si body vide
    if (!ObjectId.isValid(id)) return c.json({ message: "ID invalide" }, 400);

    const doc = await applyCol().findOne({ _id: new ObjectId(id) });
    if (!doc) return c.json({ message: "Candidature introuvable" }, 404);

    // ✅ Si preInterview non fourni dans body → toggle la valeur actuelle
    const newValue = body.preInterview !== undefined
      ? !!body.preInterview
      : !doc.preInterview;

    await applyCol().updateOne(
      { _id: new ObjectId(id) },
      { $set: { preInterview: newValue, updatedAt: new Date() } }
    );
    return c.json({ message: "Mis à jour", preInterview: newValue });
  } catch (err) {
    console.error("❌ togglePreInterview error:", err);
    return c.json({ message: "Erreur serveur", error: err.message }, 500);
  }
}

/* =========================================================
   CONTROLLERS: Stats / CRUD
========================================================= */

export async function getCandidatureCount(c) {
  try {
    const count = await applyCol().countDocuments();
    return c.json({ count });
  } catch (err) {
    return c.json({ message: "Erreur serveur", error: err.message }, 500);
  }
}

export async function getCandidaturesWithJob(c) {
  try {
    const docs = await applyCol()
      .aggregate([
        { $lookup: { from: "tenders", localField: "tenderId", foreignField: "_id", as: "tender" } },
        { $unwind: { path: "$tender", preserveNullAndEmptyArrays: true } },
        { $sort: { createdAt: -1 } },
        // ✅ FIX CRITIQUE: convertir _id en string pure pour éviter {$oid:"..."} côté frontend
        { $addFields: { _id: { $toString: "$_id" } } },
      ])
      .toArray();
    return c.json(docs);
  } catch (err) {
    return c.json({ message: "Erreur serveur", error: err.message }, 500);
  }
}

export async function getCandidaturesAnalysis(c) {
  return getCandidaturesWithJob(c);
}

export async function getMyCandidaturesUsers(c) {
  try {
    const user = c.get("user");
    if (!user?.id) return c.json({ message: "Non authentifié" }, 401);
    const docs = user.email
      ? await applyCol().find({ email: user.email }).sort({ createdAt: -1 }).toArray()
      : [];
    return c.json(docs);
  } catch (err) {
    return c.json({ message: "Erreur serveur", error: err.message }, 500);
  }
}

export async function getMatchingStatsController(c) {
  try {
    const result = await applyCol().aggregate([
      { $match: { "tenderMatch.status": "DONE" } },
      {
        $group: {
          _id:            null,
          avgScore:       { $avg: "$matchScore" },
          percentAbove80: { $avg: { $cond: [{ $gte: ["$matchScore", 80] }, 1, 0] } },
          percentBelow50: { $avg: { $cond: [{ $lt:  ["$matchScore", 50] }, 1, 0] } },
        },
      },
    ]).toArray();

    const m = result[0] || {};
    return c.json({
      averageScore:   Math.round(m.avgScore    || 0),
      percentAbove80: Math.round((m.percentAbove80 || 0) * 100),
      percentBelow50: Math.round((m.percentBelow50 || 0) * 100),
    });
  } catch (err) {
    return c.json({ message: "Erreur stats", error: err.message }, 500);
  }
}

export async function getAcademicStatsController(c) {
  try {
    const result = await applyCol().aggregate([
      { $match: { "extracted.parsed.formation": { $exists: true } } },
      { $unwind: "$extracted.parsed.formation" },
      { $group: { _id: "$extracted.parsed.formation.etablissement", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]).toArray();
    return c.json({
      topUniversities: result.map((r) => ({ name: r._id || "Inconnu", count: r.count })),
      degreeDistribution: [],
      averageLevel: 0,
    });
  } catch (err) {
    return c.json({ message: "Erreur stats académiques", error: err.message }, 500);
  }
}

export async function extractCandidature(c) {
  // Alias pour compatibilité routes /extract
  return uploadCv(c);
}

export async function getCandidatureById(c) {
  try {
    const id = c.req.param("id");
    if (!ObjectId.isValid(id)) return c.json({ message: "ID invalide" }, 400);
    const doc = await applyCol().findOne({ _id: new ObjectId(id) });
    if (!doc) return c.json({ message: "Candidature introuvable" }, 404);
    return c.json(doc);
  } catch (err) {
    return c.json({ message: "Erreur serveur", error: err.message }, 500);
  }
}

export async function updatePersonalInfo(c) {
  try {
    const id   = c.req.param("id");
    const body = await c.req.json();
    if (!ObjectId.isValid(id)) return c.json({ message: "ID invalide" }, 400);
    await applyCol().updateOne(
      { _id: new ObjectId(id) },
      { $set: { personalInfoForm: body, updatedAt: new Date() } }
    );
    return c.json({ message: "Informations mises à jour" });
  } catch (err) {
    return c.json({ message: "Erreur serveur", error: err.message }, 500);
  }
}