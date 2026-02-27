import fs from "node:fs/promises";
import { ObjectId } from "mongodb";
import fsSync from "fs"; 
import path from "node:path";
import axios from "axios";
import FormData from "form-data";
import transporter from "../config/mailer.js";
import {
  createCandidature,
  updateCandidaturePersonalInfoForm,
  countCandidatures, getCandidaturesWithJobDetails,getCandidatureJob,getMyCandidaturesWithJob,
  updateCandidatureExtracted,
  findPendingJobMatch,
  findPendingAiDetection,
  lockJobMatch,
  lockAiDetection,
  markJobMatchDone,
  markJobMatchFailed,
  markAiDetectionDone,
  markAiDetectionFailed,
  getMatchingStats , getAcademicStats,
  alreadySubmittedForJob,findCandidatureById,
} from "../models/candidature.model.js";
import { findJobOfferById } from "../models/job.model.js";
import { findUserById } from "../models/user.model.js";
import { createNotificationForAdmins, NOTIFICATION_TYPES } from "../models/Notification.model.js";

import {
  createSubmission,
  findSubmissionByFicheAndCandidature,
} from "../models/ficheSubmission.model.js";
import { findFicheById } from "../models/FicheRenseignement.js";
const UPLOAD_DIR = path.join(process.cwd(), "uploads", "cvs");

const FASTAPI_URL = process.env.ML_SERVICE_URL;

/* =========================================================
   UTILS
========================================================= */

// Simple sleep utility (anti rate-limit)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Worker locks (avoid parallel runs)
let aiDetectionWorkerRunning = false;
let jobMatchWorkerRunning = false;

/* =========================================================
   HELPER: Extract CV Text
========================================================= */
function extractCvText(extracted) {
  if (!extracted) {
    console.warn("⚠️ No extracted data");
    return null;
  }

  console.log("🔍 Extracting from structure with keys:", Object.keys(extracted));

  // ✅ FIX: Check if data is nested in 'parsed' field
  let data = extracted;
  if (extracted.parsed && typeof extracted.parsed === 'object') {
    console.log("📦 Using extracted.parsed");
    data = extracted.parsed;
  }

  let parts = [];

  // ===== STRATEGY 1: Direct fields =====
  const directFields = [
    'nom', 'email', 'telephone', 'adresse', 'titre_poste', 'profil',
    'name', 'phone', 'address', 'title', 'summary', 'profile'
  ];

  directFields.forEach(field => {
    if (data[field] && typeof data[field] === 'string') {
      parts.push(data[field]);
    }
  });

  // ===== STRATEGY 2: Nested personal_info =====
  if (data.personal_info) {
    const pi = data.personal_info;
    ['full_name', 'name', 'email', 'phone', 'telephone', 'address', 'adresse'].forEach(field => {
      if (pi[field] && typeof pi[field] === 'string') {
        parts.push(pi[field]);
      }
    });
  }

  // ===== STRATEGY 3: Experience =====
  const expFields = ['experience_professionnelle', 'experience', 'work_experience', 'experiences'];
  expFields.forEach(field => {
    if (Array.isArray(data[field])) {
      data[field].forEach((exp) => {
        ['poste', 'position', 'title', 'role', 'entreprise', 'company', 'description'].forEach(subfield => {
          if (exp[subfield]) parts.push(String(exp[subfield]));
        });
      });
    }
  });

  // ===== STRATEGY 4: Formation =====
  const eduFields = ['formation', 'education', 'formations', 'educations'];
  eduFields.forEach(field => {
    if (Array.isArray(data[field])) {
      data[field].forEach((f) => {
        ['diplome', 'degree', 'diploma', 'etablissement', 'institution', 'school'].forEach(subfield => {
          if (f[subfield]) parts.push(String(f[subfield]));
        });
      });
    }
  });

  // ===== STRATEGY 5: Competences/Skills =====
  const skillFields = ['competences', 'skills', 'competencies'];
  skillFields.forEach(field => {
    if (data[field]) {
      const comp = data[field];
      Object.values(comp).forEach(value => {
        if (Array.isArray(value)) {
          parts.push(...value.map(String));
        } else if (typeof value === 'string') {
          parts.push(value);
        }
      });
    }
  });

  // ===== STRATEGY 6: Projects =====
  const projFields = ['projets', 'projects', 'projet', 'project'];
  projFields.forEach(field => {
    if (Array.isArray(data[field])) {
      data[field].forEach((p) => {
        ['nom', 'name', 'title', 'description'].forEach(subfield => {
          if (p[subfield]) parts.push(String(p[subfield]));
        });
        if (Array.isArray(p.technologies)) {
          parts.push(...p.technologies.map(String));
        }
      });
    }
  });

  // ===== STRATEGY 7: Languages =====
  const langFields = ['langues', 'languages', 'langue', 'language'];
  langFields.forEach(field => {
    if (Array.isArray(data[field])) {
      data[field].forEach((l) => {
        if (l.langue || l.language) {
          parts.push(String(l.langue || l.language));
        }
      });
    }
  });

  // ===== STRATEGY 8: Certifications =====
  if (Array.isArray(data.certifications)) {
    data.certifications.forEach((cert) => {
      if (cert.nom || cert.name) {
        parts.push(String(cert.nom || cert.name));
      }
    });
  }

  // Filter and clean
  const cleanedParts = parts
    .filter(Boolean)
    .filter(p => typeof p === 'string')
    .filter(p => p.trim().length > 0)
    .map(p => p.trim());

  const result = cleanedParts.join(" ");
  
  console.log(`✅ Extracted ${cleanedParts.length} parts, total ${result.length} chars`);
  
  return result.length > 0 ? result : null;
}

/* =========================================================
   CONTROLLER: Upload CV
========================================================= */
export const uploadCv = async (c) => {
  let filePath = null;

  try {
    console.log("📥 Upload CV route called");

    const body = await c.req.parseBody();
    console.log("📦 Body keys:", Object.keys(body));

    const file = body.cv;
    console.log("📄 File received:", file?.name);

    if (!file || typeof file.arrayBuffer !== "function") {
      return c.json({ message: "CV required" }, 400);
    }

    /* ===== SAVE FILE ===== */
    const buffer = Buffer.from(await file.arrayBuffer());
    const uploadDir = path.join(process.cwd(), "uploads", "cvs");

    if (!fsSync.existsSync(uploadDir)) {
      fsSync.mkdirSync(uploadDir, { recursive: true });
    }

    const safeName = file.name.replace(/\s+/g, "_");
    const fileName = `${Date.now()}-${safeName}`;
    filePath = path.join(uploadDir, fileName);

    fsSync.writeFileSync(filePath, buffer);

    /* ===== SEND TO FASTAPI (EXTRACT) ===== */
    const form = new FormData();
    form.append("cv", fsSync.createReadStream(filePath), {
      filename: fileName,
      contentType: "application/pdf",
    });

    const startRes = await axios.post(`${FASTAPI_URL}/cv/extract`, form, {
      headers: form.getHeaders(),
      timeout: 300000,
    });

    const extractionJobId = startRes.data.job_id;
    if (!extractionJobId) {
      throw new Error("FastAPI did not return job_id");
    }

    /* ===== POLLING ===== */
    let extracted = null;

    for (let i = 0; i < 60; i++) {
      const statusRes = await axios.get(
        `${FASTAPI_URL}/cv/status/${extractionJobId}`,
        { timeout: 30000 },
      );

      if (statusRes.data.status === "COMPLETED") {
        extracted = statusRes.data.result;
        break;
      }

      if (statusRes.data.status === "FAILED") {
        throw new Error(statusRes.data.error || "Extraction failed");
      }

      await sleep(2000);
    }

    if (!extracted) throw new Error("Extraction timeout");

    /* ===== ✅ VÉRIF DOUBLON AVANT CRÉATION ===== */
    // On extrait l'email depuis le CV extrait pour bloquer AVANT de créer un doc inutile
    const emailFromCv =
      extracted?.email ||
      extracted?.personal_info?.email ||
      extracted?.parsed?.email ||
      extracted?.parsed?.personal_info?.email ||
      null;

    const jobId = c.req.param("jobId");

    if (emailFromCv) {
      const { alreadySubmittedForJob } = await import("../models/candidature.model.js");
      const isDuplicate = await alreadySubmittedForJob(jobId, { email: emailFromCv });
      if (isDuplicate) {
        // Supprimer le fichier uploadé inutilement
        if (filePath && fsSync.existsSync(filePath)) fsSync.unlinkSync(filePath);
        console.log(`🚫 Upload bloqué - doublon détecté pour: ${emailFromCv}`);
        return c.json(
          {
            message: "Vous avez déjà soumis une candidature pour cette offre.",
            code: "ALREADY_SUBMITTED",
          },
          409
        );
      }
    }

    /* ===== SAVE CANDIDATURE ===== */
    const result = await createCandidature({
      jobOfferId: c.req.param("jobId"),
      cv: {
        fileUrl: `/uploads/cvs/${fileName}`,
        originalName: file.name,
      },
      status: "DRAFT",
      extracted,
    });

    // ⚠️ NE PAS déclencher l'analyse ici !
    // L'analyse (AI detection + job match) se déclenche seulement dans confirmApplication
    // APRÈS vérification que l'email n'a pas déjà postulé à cette offre.
    // Si on trigger ici → analyse inutile pour les doublons.

    return c.json({
      candidatureId: result.insertedId.toString(),
      cvFileUrl: `/uploads/cvs/${fileName}`,
      extracted,
    });
  } catch (err) {
    console.error("❌ CV processing failed:", err);

    if (filePath && fsSync.existsSync(filePath)) {
      fsSync.unlinkSync(filePath);
    }

    return c.json(
      {
        success: false,
        message: "Échec du traitement du CV",
        error: err.message,
      },
      500,
    );
  }
};

/* =========================================================
   CONTROLLER: Confirm Application
========================================================= */
export const confirmApplication = async (c) => {
  try {
    const candidatureId = c.req.param("candidatureId");
    const body = await c.req.json();

    // ✅ Vérification email — empêche la double candidature sur la même offre
    // Le frontend envoie { parsed, manual, personalInfoForm } donc on cherche dans toutes les structures
    const email =
      body?.parsed?.personal_info?.email ||   // ← structure frontend réelle
      body?.parsed?.email ||
      body?.manual?.personal_info?.email ||
      body?.personalInfoForm?.email ||
      body?.personal_info?.email ||           // ← fallback ancienne structure
      body?.extracted?.personal_info?.email ||
      body?.extracted?.email ||
      null;
    
    console.log("🔍 Email détecté pour vérif doublon:", email);

    // ✅ Récupérer le doc pour avoir jobOfferId + candidatId
    const { getDB: _getDB } = await import("../models/db.js");
    const candidDoc = await _getDB()
      .collection("candidatures")
      .findOne({ _id: new ObjectId(candidatureId) });

    if (candidDoc?.jobOfferId) {
      const alreadySubmitted = await alreadySubmittedForJob(
        candidDoc.jobOfferId.toString(),
        {
          candidatId: candidDoc.candidatId?.toString() || null,
          email,
        }
      );

      if (alreadySubmitted) {
        return c.json(
          {
            message: "Vous avez déjà soumis une candidature pour cette offre.",
            code: "ALREADY_SUBMITTED",
          },
          409
        );
      }
    }

    // ✅ Met à jour le extracted avec les données du formulaire
    await updateCandidatureExtracted(candidatureId, body);

    // ✅ FIX DOUBLON: Met status="SUBMITTED" à la RACINE du document candidature
    // AVANT ce fix, alreadySubmittedForJob ne trouvait jamais de doublon car
    // { status: "SUBMITTED" } était écrit dans extracted.status et non à la racine
    const { getDB: _getDB2 } = await import("../models/db.js");
    await _getDB2().collection("candidatures").updateOne(
      { _id: new ObjectId(candidatureId) },
      { $set: { status: "SUBMITTED", updatedAt: new Date() } }
    );

    // ✅ Notifier les admins d'une nouvelle candidature
    try {
      let jobTitle = "Offre inconnue";
      let candidatName = "Candidat";

      // ✅ Récupérer la candidature en base pour avoir le jobOfferId
      const { getDB } = await import("../models/db.js");
      const candidatureDoc = await getDB()
        .collection("candidatures")
        .findOne({ _id: new ObjectId(candidatureId) });

      const jobId = candidatureDoc?.jobOfferId;
      if (jobId) {
        const job = await findJobOfferById(jobId.toString());
        if (job) jobTitle = job.titre;
      }

      // Récupérer le nom du candidat depuis user ou extracted
      const user = c.get("user");
      if (user?.id) {
        const userDoc = await findUserById(user.id);
        if (userDoc) {
          candidatName = [userDoc.prenom, userDoc.nom].filter(Boolean).join(" ") || userDoc.email;
        }
      }
      if (candidatName === "Candidat") {
        const ext = candidatureDoc?.extracted || body.extracted;
        const pi = ext?.personal_info || ext?.parsed?.personal_info;
        if (pi) {
          candidatName = pi.full_name || pi.name || pi.nom || "Candidat";
        }
      }

      await createNotificationForAdmins({
        type: NOTIFICATION_TYPES.NEW_CANDIDATURE,
        message: `Nouvelle candidature de ${candidatName} pour "${jobTitle}"`,
        link: `/recruiter/candidatures`,
        metadata: {
          candidatureId,
          candidatName,
          jobTitle,
        },
      });
    } catch (notifErr) {
      console.error("⚠️ Erreur notification nouvelle candidature:", notifErr.message);
    }

    // ✅ TRIGGER BOTH WORKERS
    triggerAiDetectionWorker();
    triggerJobMatchWorker();

    return c.json({
      message: "Candidature envoyée avec succès. Analyse en cours.",
    });
  } catch (err) {
    console.error(err);
    return c.json({ message: "Submit failed", error: err.message }, 500);
  }
};

/* =========================================================
   AI DETECTION WORKER
========================================================= */
function triggerAiDetectionWorker() {
  if (aiDetectionWorkerRunning) return;

  aiDetectionWorkerRunning = true;

  processPendingAiDetections(1)
    .catch((err) => console.error("❌ AI detection worker failed:", err))
    .finally(() => {
      aiDetectionWorkerRunning = false;
    });
}

export async function processPendingAiDetections(limit = 1) {
  const candidatures = await findPendingAiDetection(limit);

  for (const c of candidatures) {
    await lockAiDetection(c._id);
    console.log("🤖 Processing AI detection for:", c._id);

    try {
      // ✅ IMPROVED: Extract CV text with better fallbacks
      const cvText = extractCvText(c.extracted);

      console.log("📝 Extracted CV text length:", cvText?.length || 0);
      console.log("📦 Extracted structure:", JSON.stringify(c.extracted, null, 2).substring(0, 500));

      if (!cvText || cvText.trim().length < 50) {
        throw new Error(`CV text too short or empty (${cvText?.length || 0} chars). Check extracted structure.`);
      }

      const payload = {
        candidatureId: c._id.toString(),
        cvText: cvText,
      };

      const res = await axios.post(
        `${FASTAPI_URL}/analyze/ai-detection`,
        payload,
        { timeout: 60000 },
      );

      await markAiDetectionDone(
        c._id,
        res.data.isAIGenerated,
        res.data.confidence,
      );

      console.log("✅ AI detection done:", res.data);

      await sleep(2000); // Anti rate-limit
    } catch (err) {
      console.error("❌ AI detection failed:", err.message);
      await markAiDetectionFailed(c._id, err.response?.data || err.message);
      await sleep(3000);
    }
  }
}

/* =========================================================
   JOB MATCH WORKER
========================================================= */
function triggerJobMatchWorker() {
  if (jobMatchWorkerRunning) return;

  jobMatchWorkerRunning = true;

  processPendingJobMatches(1)
    .catch((err) => console.error("❌ Job match worker failed:", err))
    .finally(() => {
      jobMatchWorkerRunning = false;
    });
}

export async function processPendingJobMatches(limit = 1) {
  const candidatures = await findPendingJobMatch(limit);

  for (const c of candidatures) {
    await lockJobMatch(c._id);
    console.log("💼 Processing job match for:", c._id);

    try {
      // ✅ VALIDATION: Vérifier que job existe
      if (!c.job) {
        throw new Error(`No job found for candidature ${c._id}. Check jobOfferId and job_offers collection.`);
      }

      if (!c.job.titre && !c.job.description) {
        throw new Error(`Job ${c.job._id} has no titre or description. Cannot analyze match.`);
      }

      const cvText = extractCvText(c.extracted);

      console.log("📝 Extracted CV text length:", cvText?.length || 0);
      console.log("📋 Job info:", { 
        jobId: c.job._id, 
        titre: c.job.titre, 
        hasDescription: !!c.job.description,
        hardSkillsCount: c.job.hardSkills?.length || 0,
        softSkillsCount: c.job.softSkills?.length || 0,
        hasScores: !!c.job.scores,
        scores: c.job.scores
      });

      if (!cvText || cvText.trim().length < 50) {
        throw new Error(`CV text too short or empty (${cvText?.length || 0} chars). Check extracted structure.`);
      }

      const payload = {
        candidatureId: c._id.toString(),
        cvText: cvText,
        job: {
          titre: c.job.titre || "",
          description: c.job.description || "",
          hardSkills: Array.isArray(c.job?.hardSkills) ? c.job.hardSkills : [],
          softSkills: Array.isArray(c.job?.softSkills) ? c.job.softSkills : [],
        },
        extracted: c.extracted || {},
      };

      // ✅ envoyer scores SEULEMENT s'ils existent
      if (c.job?.scores && Object.keys(c.job.scores).length > 0) {
        payload.job.scores = c.job.scores;
      }

      const res = await axios.post(
        `${FASTAPI_URL}/analyze/job-match`,
        payload,
        { timeout: 120000 },
      );

      await markJobMatchDone(c._id, res.data);

      console.log("✅ Job match done:", res.data.score);

      await sleep(2000); // Anti rate-limit
    } catch (err) {
      console.error("❌ Job match failed:", err.message);
      await markJobMatchFailed(c._id, err.response?.data || err.message);
      await sleep(3000);
    }
  }
}








async function ensureUploadDir() {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
}

/* ================================
   POST /api/candidatures/extract
================================ */
/* ================================
   POST /api/candidatures/extract
   ✅ FIXED: FormData with fs.createReadStream
================================ */
export async function extractCandidature(c) {
  try {
    await ensureUploadDir();

    const body = await c.req.parseBody();
    const jobOfferId = body.jobOfferId;
    const cvFile = body.cv;

    // ✅ Separate validation messages for better test compatibility
    if (!jobOfferId) {
      return c.json({ message: "jobOfferId est requis" }, 400);
    }

    if (!cvFile) {
      return c.json({ message: "Fichier CV requis" }, 400);
    }

    if (cvFile.size > 5 * 1024 * 1024) {
      return c.json({ message: "Fichier trop grand (max 5MB)" }, 413);
    }

    const user = c.get("user");
    if (!user?.id) {
      return c.json({ message: "Utilisateur non authentifié" }, 401);
    }

    // ===== SAVE FILE =====
    const ext = cvFile.name?.split(".").pop() || "pdf";
    const filename = `cv_${user.id}_${Date.now()}.${ext}`;
    const filepath = path.join(UPLOAD_DIR, filename);

    const arrayBuffer = await cvFile.arrayBuffer();
    await fs.writeFile(filepath, Buffer.from(arrayBuffer));

    // ===== CREATE CANDIDATURE =====
    const created = await createCandidature({
      jobOfferId,
      candidatId: user.id,
      cv: {
        filename,
        path: filepath,
        mimetype: cvFile.type,
        size: cvFile.size,
      },
      status: "DRAFT",
    });

    // ===== CALL ML SERVICE =====
    const mlUrl = process.env.ML_SERVICE_URL || "http://localhost:8000/extract";

    // ✅ FIX: Use fs.createReadStream instead of Blob for Node.js
    const form = new FormData();
    const fileStream = fsSync.createReadStream(filepath);
    form.append("cv", fileStream, {
      filename: filename,
      contentType: cvFile.type || "application/pdf",
    });

    let mlRes;
    let extracted = {};

    try {
      mlRes = await fetch(mlUrl, {
        method: "POST",
        body: form,
        headers: form.getHeaders(),
      });

      if (mlRes.ok) {
        extracted = await mlRes.json();
      } else {
        const errText = await mlRes.text();
        console.error("❌ ML Service error:", errText);
        // Continue even if ML fails
      }
    } catch (fetchErr) {
      console.error("❌ ML Service fetch error:", fetchErr);
      // Continue even if ML service is down
    }

    // ===== SAVE extracted =====
    if (Object.keys(extracted).length > 0) {
      await updateCandidatureExtracted(created.insertedId, extracted);
    }

    // ===== AUTOFILL personalInfoForm =====
    const pi = extracted?.personal_info || {};

    const personalInfoForm = {
      dateNaissance: pi.date_naissance || null,
      lieuNaissance: pi.lieu_naissance || null,
      telephone: pi.telephone || null,
    };

    // ===== SAVE personalInfoForm in DB =====
    if (Object.values(personalInfoForm).some(v => v !== null)) {
      await updateCandidaturePersonalInfoForm(created.insertedId, personalInfoForm);
    }

    return c.json({
      candidatureId: String(created.insertedId),
      extracted,
      personalInfoForm,
    });
  } catch (err) {
    console.error("extractCandidature error:", err);
    return c.json(
      { message: "Erreur serveur", error: err?.message || "Unknown error" },
      500
    );
  }
}

/* ================================
   PATCH /api/candidatures/:id/personal-info
================================ */
export async function updatePersonalInfo(c) {
  try {
    const id = c.req.param("id");
    const body = await c.req.json();

    // body = personalInfoForm venant du front
    await updateCandidaturePersonalInfoForm(id, body);

    return c.json({ message: "Informations personnelles mises à jour" });
  } catch (err) {
    console.error("updatePersonalInfo error:", err);
    return c.json(
      { message: "Erreur serveur", error: err?.message || "Unknown error" },
      500
    );
  }
}

/* ================================
   GET /api/candidatures/count
================================ */
export async function getCandidatureCount(c) {
  try {
    const count = await countCandidatures();
    return c.json({ count });
  } catch (err) {
    console.error("getCandidatureCount error:", err);
    return c.json(
      { message: "Erreur serveur", error: err?.message || "Unknown error" },
      500
    );
  }
}
export async function getCandidaturesWithJob(c) {
  try {
    const data = await getCandidaturesWithJobDetails();
    return c.json(data);
  } catch (err) {
    console.error("getCandidaturesWithJob error:", err);
    return c.json({ message: "Server error" }, 500);
  }
}
export async function getCandidaturesAnalysis(c) {
  const list = await getCandidatureJob();
  return c.json(list);
}
export async function sendFicheController(c) {
  try {
    const candidatureId = c.req.param("candidatureId");
    const { ficheId, email } = await c.req.json();

    /* ========= VALIDATION ========= */
    if (!ObjectId.isValid(candidatureId)) {
      return c.json({ message: "candidatureId invalide" }, 400);
    }
    if (!ObjectId.isValid(ficheId)) {
      return c.json({ message: "ficheId invalide" }, 400);
    }
    if (!email) {
      return c.json({ message: "email requis" }, 400);
    }

    /* ========= FICHE ========= */
    const fiche = await findFicheById(ficheId);
    if (!fiche) {
      return c.json({ message: "Fiche introuvable" }, 404);
    }

    /* ========= SUBMISSION ========= */
    let submission = await findSubmissionByFicheAndCandidature(
      ficheId,
      candidatureId
    );

    if (!submission) {
      const created = await createSubmission({
        ficheId,
        candidatureId,
        candidatId: null,
      });
      submission = { _id: created.insertedId };
    }

    /* ========= LINK ========= */
    const FRONT_URL = process.env.FRONT_URL;
  const link = `${process.env.FRONT_URL}/candidat/${submission._id}`;


    /* ========= EMAIL ========= */
    const info = await transporter.sendMail({
      from: `"Recrutement" <${process.env.MAIL_USER}>`,
      to: email,
      subject: `Fiche de renseignement – ${fiche.title}`,
      html: `
        <p>Bonjour,</p>
        <p>Merci de compléter la fiche de renseignement suivante :</p>
        <p>
          <a href="${link}" target="_blank"
             style="padding:10px 16px;background:#4E8F2F;color:#fff;border-radius:20px;text-decoration:none">
            Accéder à la fiche
          </a>
        </p>
        <p>Cordialement.</p>
      `,
    });

    console.log("📧 Mail envoyé :", info.accepted);

    return c.json({
      success: true,
      message: "Fiche envoyée par email",
      submissionId: submission._id,
    });
  } catch (err) {
    console.error("sendFicheController error:", err);
    return c.json({ message: "Server error" }, 500);
  }
}

/* ================================
   GET /api/candidatures/my
================================ */
export async function getMyCandidaturesUsers(c) {
  try {
    const user = c.get("user");
    if (!user?.id) {
      return c.json({ message: "Utilisateur non authentifié" }, 401);
    }

    const data = await getMyCandidaturesWithJob(user.id);
    return c.json(data);
  } catch (err) {
    console.error("getMyCandidatures error:", err);
    return c.json({ message: "Server error" }, 500);
  }
}





export async function getMatchingStatsController(c) {
  try {
    const [result] = await getMatchingStats();

    const metrics = result?.metrics?.[0] || {
      avgScore: 0,
      percentAbove80: 0,
      percentBelow50: 0,
    };

    const histogram = (result?.histogram || []).map((b) => ({
      range: b._id === "100+" ? "100" : `${b._id}-${Number(b._id) + 20}`,
      count: b.count,
    }));

    return c.json({
      averageScore: metrics.avgScore,
      percentAbove80: metrics.percentAbove80,
      percentBelow50: metrics.percentBelow50,
      histogram,
    });
  } catch (err) {
    console.error("❌ getMatchingStats error:", err);
    return c.json(
      { message: "Erreur statistiques matching", error: err.message },
      500
    );
  }
}



export async function getAcademicStatsController(c) {
  try {
    const [result] = await getAcademicStats();

    return c.json({
      topUniversities: result.topUniversities || [],
      degreeDistribution: result.degreeDistribution || [],
      averageLevel: result.averageLevel?.[0]?.avgLevel || 0
    });
  } catch (err) {
    console.error("❌ Academic stats error:", err);
    return c.json(
      { message: "Erreur statistiques académiques", error: err.message },
      500
    );
  }
}
// candidature.controller.js


export async function getCandidatureById(c) {
  try {
    const id = c.req.param("id");

    if (!ObjectId.isValid(id)) {
      return c.json({ message: "ID candidature invalide" }, 400);
    }

    const doc = await findCandidatureById(id);

    if (!doc) {
      return c.json({ message: "Candidature introuvable" }, 404);
    }

    return c.json(doc);
  } catch (err) {
    console.error("getCandidatureById error:", err);
    return c.json({ message: "Server error" }, 500);
  }
}