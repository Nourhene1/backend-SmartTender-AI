import {
  createJobOffer,
  findAllJobOffers,
  findPendingJobOffers,
  findJobOfferById,
  updateJobOffer,
  updateJobOfferStatus,
  deleteJobOffer,
  countJobOffers,
  countJobOffersByStatus,
  findAllJobOffersWithCandidatureCount,
  findJobOffersByUser,
  findJobOffersByCreator,
  isJobOfferClosed,
  findActiveJobOffers,
  reactivateJobOffer,
  JOB_STATUS,
  findPublicJobOffers,
  findValidatedJobOffers,
} from "../models/job.model.js";

import { deleteQuizByJobId } from "../models/quizModel.js";
import { findUserById } from "../models/user.model.js";
import { getDB } from "../models/db.js";
import { ObjectId } from "mongodb";
import {
  sendNewJobNotificationEmail,
  sendJobConfirmedEmail,
  sendJobRejectedEmail,
} from "../services/mail.service.js";
import {
  createNotificationForAdmins,
  createNotification,
  NOTIFICATION_TYPES,
} from "../models/Notification.model.js";
import { autoGenerateQuiz } from "../controllers/quiz.controller.js";
import { Buffer } from "buffer";

/* ===========================
   ✅ LINKEDIN
=========================== */
import axios from "axios";
import crypto from "crypto";

/**
 * Clamp score value between 0 and 100
 */

import { findMyJobOffersWithoutQuiz } from "../models/job.model.js";

function getUserIdFromContext(c) {
  const u = c.get?.("user");
  const id = u?._id || u?.id || u?.userId;
  if (id) return String(id);

  const direct = c.get?.("userId");
  return direct ? String(direct) : "";
}

/**
 * ✅ GET /jobs/without-quiz
 * Retourne les jobs du user qui n'ont pas de quiz ACTIVE
 */
export async function getMyJobsWithoutQuiz(c) {
  try {
    const userId = getUserIdFromContext(c);
    if (!userId || !ObjectId.isValid(userId)) {
      return c.json({ message: "Non authentifié" }, 401);
    }

    const jobs = await findMyJobOffersWithoutQuiz(userId);
    return c.json(jobs, 200);
  } catch (err) {
    console.error("getMyJobsWithoutQuiz error:", err);
    return c.json({ message: "Erreur serveur" }, 500);
  }
}
function clampScore(v) {
  const n = Number(v);
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return n;
}

/**
 * Normalize scores object
 */
function normalizeScores(scores) {
  if (!scores || typeof scores !== "object") {
    return {
      skillsFit: 0,
      experienceFit: 0,
      projectsFit: 0,
      educationFit: 0,
      communicationFit: 0,
    };
  }

  return {
    skillsFit: clampScore(scores.skillsFit),
    experienceFit: clampScore(scores.experienceFit),
    projectsFit: clampScore(scores.projectsFit),
    educationFit: clampScore(scores.educationFit),
    communicationFit: clampScore(scores.communicationFit),
  };
}

/**
 * Parse skills: accepts string (comma-separated) or array
 */
function parseSkillsField(value) {
  if (Array.isArray(value))
    return value.map((s) => String(s).trim()).filter(Boolean);
  if (typeof value === "string")
    return value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  return [];
}

/* ===========================
   ✅ LINKEDIN HELPERS
=========================== */
const LI_AUTH = "https://www.linkedin.com/oauth/v2";
const LI_API = "https://api.linkedin.com/v2";

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function safeStr(v) {
  if (v === null || v === undefined) return "";
  return typeof v === "string" ? v.trim() : String(v).trim();
}

/**
 * Build a clean LinkedIn post text from job
 */
function buildJobPostText(job) {
  const title = safeStr(job?.titre || job?.title || "Offre d'emploi");
  const lieu = safeStr(job?.lieu || job?.location || "");
  const desc = safeStr(job?.description || "");

  const hard = Array.isArray(job?.hardSkills) ? job.hardSkills : [];
  const soft = Array.isArray(job?.softSkills) ? job.softSkills : [];

  const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";
  const applyLink = `${FRONTEND_URL}/jobs/${job?._id?.toString?.() || ""}`;

  let text = `🚀 ${title}`;
  if (lieu) text += `\n📍 ${lieu}`;
  if (desc) text += `\n\n${desc.slice(0, 900)}`;

  if (hard.length) text += `\n\n🧩 Hard skills: ${hard.slice(0, 12).join(", ")}`;
  if (soft.length) text += `\n🤝 Soft skills: ${soft.slice(0, 12).join(", ")}`;


  text += `
#recrutement #hiring #wearehiring 
#emploi #jobopportunity 
#carrière #opportunité 
#talent #talentacquisition 
#RH
`; return text;
}

/**
 * Store LinkedIn token per user in MongoDB
 */
async function saveLinkedInToken({ userId, accessToken, expiresAt, scope }) {
  await getDB().collection("linkedin_tokens").updateOne(
    { userId: new ObjectId(userId) },
    {
      $set: {
        accessToken,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        scope: scope || null,
        updatedAt: new Date(),
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true }
  );
}

async function getLinkedInToken(userId) {
  return getDB()
    .collection("linkedin_tokens")
    .findOne({ userId: new ObjectId(userId) });
}

async function exchangeCodeForToken(code) {
  const client_id = mustEnv("LINKEDIN_CLIENT_ID");
  const client_secret = mustEnv("LINKEDIN_CLIENT_SECRET");
  const redirect_uri = mustEnv("LINKEDIN_REDIRECT_URI");

  // 🔍 DEBUG CRITIQUE: voir quelle redirect_uri est utilisée
  console.log("🔴 [EXCHANGE] redirect_uri utilisé:", redirect_uri);
  console.log("🔴 [EXCHANGE] client_id:", client_id.slice(0, 6) + "...");
  console.log("🔴 [EXCHANGE] code:", code.slice(0, 20) + "...");

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri,
    client_id,
    client_secret,
  });

  const { data } = await axios.post(`${LI_AUTH}/accessToken`, body.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  return data; // { access_token, expires_in }
}

function buildLinkedInAuthUrl({ state }) {
  const client_id = mustEnv("LINKEDIN_CLIENT_ID");
  const redirect_uri = mustEnv("LINKEDIN_REDIRECT_URI");
  const scope = "openid profile email w_member_social";

  const params = new URLSearchParams({
    response_type: "code",
    client_id,
    redirect_uri,
    state,
    scope,
  });

  return `${LI_AUTH}/authorization?${params.toString()}`;
}

async function getMemberId(accessToken) {
  // ✅ OIDC: récupérer l'identifiant via /userinfo (évite /me qui exige d'autres permissions)
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "X-Restli-Protocol-Version": "2.0.0",
  };

  // Optionnel: certaines apps utilisent un version header
  if (process.env.LINKEDIN_VERSION) {
    headers["LinkedIn-Version"] = process.env.LINKEDIN_VERSION;
  }

  const { data } = await axios.get(`${LI_API}/userinfo`, { headers });

  // data.sub peut être "urn:li:person:XXXX" ou juste "XXXX"
  const sub = data?.sub;
  if (!sub) return null;

  const s = String(sub).trim();
  if (s.startsWith("urn:li:person:")) return s.replace("urn:li:person:", "").trim();
  return s;
}


async function publishMemberPost({ accessToken, memberId, text, imageFile }) {
  const author = `urn:li:person:${memberId}`;

  let media = [];
  let category = "NONE";

  if (imageFile) {
    const asset = await uploadImageToLinkedIn(
      accessToken,
      imageFile,
      author
    );

    media = [
      {
        media: asset,
        status: "READY",
      },
    ];
    category = "IMAGE";
  }

  const payload = {
    author,
    lifecycleState: "PUBLISHED",
    specificContent: {
      "com.linkedin.ugc.ShareContent": {
        shareCommentary: { text },
        shareMediaCategory: category,
        media,
      },
    },
    visibility: {
      "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC",
    },
  };

  return axios.post("https://api.linkedin.com/v2/ugcPosts", payload, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });
}
/* =========================================================
   POST /jobs
========================================================= */
export async function createJob(c) {
  try {
    const body = await c.req.json();
    const user = c.get("user");

    const missingFields = [];
    if (!body.titre?.trim()) missingFields.push("titre");
    if (!body.description?.trim()) missingFields.push("description");
    if (!body.lieu?.trim()) missingFields.push("lieu");
    if (!body.dateCloture) missingFields.push("dateCloture");

    const softSkills = parseSkillsField(body.softSkills);
    const hardSkills = parseSkillsField(body.hardSkills);

    if (missingFields.length > 0) {
      return c.json(
        {
          message: `Champs obligatoires manquants : ${missingFields.join(", ")}`,
        },
        400
      );
    }

    const userId = user._id || user.id;
    const existingUser = await findUserById(userId);
    if (!existingUser) {
      return c.json({ message: "Utilisateur introuvable" }, 404);
    }

    const scores = normalizeScores(body.scores);
    const isAdmin = existingUser.role === "ADMIN";
    const status = isAdmin ? JOB_STATUS.CONFIRMEE : JOB_STATUS.EN_ATTENTE;

    // ✅ AJOUT: champs optionnels envoyés au model
    const result = await createJobOffer({
      titre: body.titre.trim(),
      description: body.description.trim(),
      softSkills,
      hardSkills,
      lieu: body.lieu.trim(),
      dateCloture: body.dateCloture,
      scores,
      status,
      createdBy: userId,
      generateQuiz: body.generateQuiz !== false,
      numQuestions:
        typeof body.numQuestions === "number" &&
        body.numQuestions >= 1 &&
        body.numQuestions <= 30
          ? body.numQuestions
          : 25,

      // ✅ CHAMPS OPTIONNELS
      salaire: body.salaire,
      typeContrat: body.typeContrat,
      motif: body.motif,
      sexe: body.sexe,
      typeDiplome: body.typeDiplome,
    });

    const message = isAdmin
      ? "Offre créée et publiée avec succès"
      : "Offre créée avec succès. En attente de confirmation par l'administrateur.";

    if (!isAdmin) {
      try {
        const creatorFullName =
          [existingUser.prenom, existingUser.nom].filter(Boolean).join(" ") ||
          existingUser.email;

        await createNotificationForAdmins({
          type: NOTIFICATION_TYPES.NEW_JOB_PENDING,
          message: `Nouvelle offre "${body.titre}" créée par ${creatorFullName}`,
          link: `/recruiter/jobs`,
          metadata: {
            jobId: result.insertedId.toString(),
            jobTitle: body.titre,
            creatorName: creatorFullName,
          },
        });

        const admins = await getDB()
          .collection("users")
          .find({ role: "ADMIN" })
          .project({ email: 1 })
          .toArray();

        const adminEmails = admins.map((a) => a.email).filter(Boolean);

        if (adminEmails.length > 0) {
          await sendNewJobNotificationEmail(adminEmails.join(","), {
            jobId: result.insertedId.toString(),
            jobTitle: body.titre,
            creatorName: creatorFullName,
            creatorEmail: existingUser.email,
          });
        }
      } catch (emailErr) {
        console.error("⚠️ Erreur envoi notification admin:", emailErr.message);
      }
    }

    const shouldGenerateQuiz = isAdmin && body.generateQuiz !== false;

    if (shouldGenerateQuiz) {
      const numQuestions =
        typeof body.numQuestions === "number" &&
        body.numQuestions >= 1 &&
        body.numQuestions <= 30
          ? body.numQuestions
          : 25;

      autoGenerateQuiz(result.insertedId.toString(), numQuestions).catch((err) =>
        console.error("⚠️ Auto quiz generation failed:", err.message)
      );
    }

    return c.json({ id: result.insertedId.toString(), status, message }, 201);
  } catch (err) {
    console.error("❌ Create job error:", err);
    return c.json(
      { message: "Erreur lors de la création de l'offre", error: err.message },
      500
    );
  }
}
/* =========================================================
   GET /jobs
========================================================= */
export async function getJobs(c) {
  try {
    const jobs = await findPublicJobOffers(); // ✅ فقط published
    return c.json(jobs);
  } catch (err) {
    console.error("❌ Get jobs error:", err);
    return c.json(
      { message: "Erreur lors de la récupération des offres", error: err.message },
      500
    );
  }
}

/* =========================================================
   GET /jobs/all
========================================================= */
export async function getAllJobs(c) {
  try {
    const jobs = await findAllJobOffers();
    return c.json(jobs);
  } catch (err) {
    console.error("❌ Get all jobs error:", err);
    return c.json(
      { message: "Erreur lors de la récupération des offres", error: err.message },
      500
    );
  }
}

/* =========================================================
   GET /jobs/pending
========================================================= */
export async function getPendingJobs(c) {
  try {
    const jobs = await findPendingJobOffers();
    return c.json(jobs);
  } catch (err) {
    console.error("❌ Get pending jobs error:", err);
    return c.json(
      { message: "Erreur lors de la récupération des offres en attente", error: err.message },
      500
    );
  }
}

/* =========================================================
   PUT /jobs/:id/confirm
========================================================= */
export async function confirmJob(c) {
  try {
    const { id } = c.req.param();
    const user = c.get("user");
    const adminId = user?._id || user?.id;

    if (!ObjectId.isValid(id)) {
      return c.json({ message: "ID invalide" }, 400);
    }

    const job = await findJobOfferById(id);
    if (!job) {
      return c.json({ message: "Offre non trouvée" }, 404);
    }

    // ⛔ doit être VALIDEE avant confirmation
    if (job.status !== JOB_STATUS.VALIDEE) {
      return c.json(
        { message: "L'offre doit être validée (étape 1) avant publication" },
        400
      );
    }

    // ✅ ÉTAPE 2 : passage en CONFIRMEE (publique)
    await updateJobOfferStatus(id, JOB_STATUS.CONFIRMEE, adminId);

    // 🔔 Notification au responsable
    try {
      const assigned = Array.isArray(job.assignedUserIds)
        ? job.assignedUserIds
        : [];

      for (const uid of assigned) {
        await createNotification({
          userId: uid.toString(),
          type: NOTIFICATION_TYPES.JOB_CONFIRMED,
          message: `Votre offre "${job.titre}" est publiée et visible pour les candidats.`,
          link: `/ResponsableMetier/jobs`,
          metadata: {
            jobId: id,
            jobTitle: job.titre,
            step: "CONFIRMEE",
          },
        });
      }
    } catch (notifErr) {
      console.error("⚠️ Erreur notification confirmation:", notifErr.message);
    }

    return c.json(
      {
        message: "Offre publiée avec succès.",
        id,
        status: JOB_STATUS.CONFIRMEE,
      },
      200
    );
  } catch (err) {
    console.error("❌ Confirm job error:", err);
    return c.json(
      {
        message: "Erreur lors de la confirmation de l'offre",
        error: err.message,
      },
      500
    );
  }
}

/* =========================================================
   PUT /jobs/:id/reject
========================================================= */
export async function rejectJob(c) {
  try {
    const { id } = c.req.param();
    const user = c.get("user");
    const body = await c.req.json().catch(() => ({}));

    if (!ObjectId.isValid(id)) {
      return c.json({ message: "ID invalide" }, 400);
    }

    const job = await findJobOfferById(id);
    if (!job) {
      return c.json({ message: "Offre non trouvée" }, 404);
    }

    if (job.status === JOB_STATUS.REJETEE) {
      return c.json({ message: "L'offre est déjà rejetée" }, 400);
    }

    const adminId = user._id || user.id;
    await updateJobOfferStatus(id, JOB_STATUS.REJETEE, adminId);

    try {
      if (job.createdBy) {
        const creator = await findUserById(job.createdBy.toString());
        if (creator?.email) {
          await sendJobRejectedEmail(creator.email, {
            jobTitle: job.titre,
            reason: body.reason || "",
          });
        }
        await createNotification({
          userId: job.createdBy.toString(),
          type: NOTIFICATION_TYPES.JOB_REJECTED,
          message: `Votre offre "${job.titre}" a été rejetée.`,
          link: `/recruiter/jobs`,
          metadata: { jobId: id, jobTitle: job.titre },
        });
      }
    } catch (notifErr) {
      console.error("⚠️ Erreur notification rejet:", notifErr.message);
    }

    return c.json({ message: "Offre rejetée", id }, 200);
  } catch (err) {
    console.error("❌ Reject job error:", err);
    return c.json(
      { message: "Erreur lors du rejet de l'offre", error: err.message },
      500
    );
  }
}

/* =========================================================
   GET /jobs/:id
========================================================= */
export async function getJobById(c) {
  try {
    const { id } = c.req.param();

    if (!ObjectId.isValid(id)) {
      return c.json({ message: "ID invalide" }, 400);
    }

    const job = await findJobOfferById(id);
    if (!job) {
      return c.json({ message: "Offre non trouvée" }, 404);
    }

    return c.json(job);
  } catch (err) {
    console.error("❌ Get job by id error:", err);
    return c.json(
      { message: "Erreur lors de la récupération de l'offre", error: err.message },
      500
    );
  }
}

/* =========================================================
   PUT /jobs/:id
========================================================= */
export async function updateJob(c) {
  try {
    const { id } = c.req.param();
    const body = await c.req.json();

    if (!ObjectId.isValid(id)) {
      return c.json({ message: "ID invalide" }, 400);
    }

    const existingJob = await findJobOfferById(id);
    if (!existingJob) {
      return c.json({ message: "Offre non trouvée" }, 404);
    }

    const missingFields = [];

    // ✅ Champs "vraiment obligatoires" seulement si tu les modifies
    if (body.titre !== undefined && !String(body.titre).trim())
      missingFields.push("titre");

    if (body.description !== undefined && !String(body.description).trim())
      missingFields.push("description");

    if (body.lieu !== undefined && !String(body.lieu).trim())
      missingFields.push("lieu");

    if (body.dateCloture !== undefined && !body.dateCloture)
      missingFields.push("dateCloture");

    // ✅ softSkills NON obligatoire
    if (body.softSkills !== undefined) {
      const parsed = parseSkillsField(body.softSkills);

      if (parsed.length === 0) {
        // 1) soit tu acceptes vide => body.softSkills = []
        // body.softSkills = [];

        // 2) soit tu ignores complètement si vide (recommandé pour update partiel)
        delete body.softSkills;
      } else {
        body.softSkills = parsed;
      }
    }

    // ✅ hardSkills NON obligatoire
    if (body.hardSkills !== undefined) {
      const parsed = parseSkillsField(body.hardSkills);

      if (parsed.length === 0) {
        // body.hardSkills = [];
        delete body.hardSkills;
      } else {
        body.hardSkills = parsed;
      }
    }

    if (missingFields.length > 0) {
      return c.json(
        { message: `Champs obligatoires manquants : ${missingFields.join(", ")}` },
        400
      );
    }

    if (body.scores) {
      body.scores = normalizeScores(body.scores);
    }

    await updateJobOffer(id, body);

    return c.json({ message: "Offre mise à jour", id }, 200);
  } catch (err) {
    console.error("❌ Update job error:", err);
    return c.json(
      { message: "Erreur lors de la mise à jour de l'offre", error: err.message },
      500
    );
  }
}
/* =========================================================
   GET /jobs/my-offers
========================================================= */
export async function getMyOffers(c) {
  try {
    const user = c.get("user");
    const userId = user._id || user.id;

    if (!ObjectId.isValid(userId)) {
      return c.json({ message: "ID utilisateur invalide" }, 400);
    }

    const jobs = await findJobOffersByCreator(userId);
    return c.json(jobs);
  } catch (err) {
    console.error("❌ Get my offers error:", err);
    return c.json(
      { message: "Erreur lors de la récupération de vos offres", error: err.message },
      500
    );
  }
}

/* =========================================================
   GET /jobs/active
========================================================= */
export async function getActiveJobs(c) {
  try {
    const jobs = await findActiveJobOffers();
    return c.json(jobs);
  } catch (err) {
    console.error("❌ Get active jobs error:", err);
    return c.json(
      { message: "Erreur lors de la récupération des offres actives", error: err.message },
      500
    );
  }
}

/* =========================================================
   DELETE /jobs/:id
========================================================= */
export async function deleteJob(c) {
  try {
    const { id } = c.req.param();

    if (!ObjectId.isValid(id)) {
      return c.json({ message: "ID invalide" }, 400);
    }

    const existingJob = await findJobOfferById(id);
    if (!existingJob) {
      return c.json({ message: "Offre non trouvée" }, 404);
    }

    await deleteQuizByJobId(id);
    await deleteJobOffer(id);

    return c.json({ message: "Offre + quiz supprimés", id }, 200);
  } catch (err) {
    console.error("❌ Delete job error:", err);
    return c.json({ message: "Erreur suppression", error: err.message }, 500);
  }
}

/* =========================================================
   GET /jobs/count
========================================================= */
export async function getJobCount(c) {
  try {
    const count = await countJobOffers();
    const pendingCount = await countJobOffersByStatus(JOB_STATUS.EN_ATTENTE);
    const confirmedCount = await countJobOffersByStatus(JOB_STATUS.CONFIRMEE);
    const rejectedCount = await countJobOffersByStatus(JOB_STATUS.REJETEE);

    return c.json({ count, pendingCount, confirmedCount, rejectedCount });
  } catch (err) {
    console.error("❌ Get job count error:", err);
    return c.json(
      { message: "Erreur lors du comptage des offres", error: err.message },
      500
    );
  }
}

/* =========================================================
   GET /jobs/with-candidatures-count
========================================================= */
export async function getJobsWithCandidatureCount(c) {
  try {
    const jobs = await findAllJobOffersWithCandidatureCount();
    return c.json(jobs);
  } catch (err) {
    console.error("❌ Get jobs with candidature count error:", err);
    return c.json(
      { message: "Erreur lors de la récupération", error: err.message },
      500
    );
  }
}

/* =========================================================
   GET /jobs/user/:userId
========================================================= */
export async function getJobsByUser(c) {
  try {
    const { userId } = c.req.param();

    if (!ObjectId.isValid(userId)) {
      return c.json({ message: "ID utilisateur invalide" }, 400);
    }

    const jobs = await findJobOffersByUser(userId);
    return c.json(jobs);
  } catch (err) {
    console.error("❌ Get jobs by user error:", err);
    return c.json(
      { message: "Erreur lors de la récupération des offres assignées", error: err.message },
      500
    );
  }
}

/* =========================================================
   PUT /jobs/my-offers/:id
========================================================= */
export async function updateMyJob(c) {
  try {
    const { id } = c.req.param();
    const body = await c.req.json();
    const user = c.get("user");
    const userId = (user._id || user.id).toString();

    if (!ObjectId.isValid(id)) {
      return c.json({ message: "ID invalide" }, 400);
    }

    const existingJob = await findJobOfferById(id);
    if (!existingJob) {
      return c.json({ message: "Offre non trouvée" }, 404);
    }

    const creatorId = existingJob.createdBy ? existingJob.createdBy.toString() : null;
    if (creatorId !== userId) {
      return c.json({ message: "Vous ne pouvez modifier que vos propres offres" }, 403);
    }

    if (existingJob.status && existingJob.status !== JOB_STATUS.EN_ATTENTE) {
      return c.json(
        { message: "Vous ne pouvez modifier qu'une offre en attente de confirmation" },
        403
      );
    }

    delete body.status;
    delete body.createdBy;
    delete body.assignedUserIds;
    delete body.confirmedBy;
    delete body.confirmedAt;

    if (body.softSkills !== undefined) body.softSkills = parseSkillsField(body.softSkills);
    if (body.hardSkills !== undefined) body.hardSkills = parseSkillsField(body.hardSkills);

    if (body.scores) body.scores = normalizeScores(body.scores);

    await updateJobOffer(id, body);

    return c.json({ message: "Offre mise à jour", id }, 200);
  } catch (err) {
    console.error("❌ Update my job error:", err);
    return c.json(
      { message: "Erreur lors de la mise à jour de l'offre", error: err.message },
      500
    );
  }
}

/* =========================================================
   GET /jobs/:id/is-closed
========================================================= */
export async function checkJobClosed(c) {
  try {
    const { id } = c.req.param();

    if (!ObjectId.isValid(id)) {
      return c.json({ message: "ID invalide" }, 400);
    }

    const isClosed = await isJobOfferClosed(id);
    return c.json({ jobId: id, isClosed });
  } catch (err) {
    console.error("❌ Check job closed error:", err);
    return c.json(
      { message: "Erreur lors de la vérification de l'offre", error: err.message },
      500
    );
  }
}

// ✅ Alias to avoid casing issues in some imports
export const checkJobclosed = checkJobClosed;


/* =========================================================
   PUT /jobs/:id/reactivate
========================================================= */
export async function reactivateJob(c) {
  try {
    const { id } = c.req.param();
    const body = await c.req.json();
    const user = c.get("user");
    const userId = user._id || user.id;

    if (!ObjectId.isValid(id)) {
      return c.json({ message: "ID invalide" }, 400);
    }

    if (!body.newDateCloture) {
      return c.json(
        { message: "Nouvelle date de clôture obligatoire" },
        400
      );
    }

    const job = await findJobOfferById(id);
    if (!job) {
      return c.json({ message: "Offre non trouvée" }, 404);
    }

    const currentUser = await findUserById(userId);
    if (!currentUser) {
      return c.json({ message: "Utilisateur non trouvé" }, 404);
    }

    const isAdmin = currentUser.role === "ADMIN";
    const creatorId = job.createdBy?.toString();
    const isCreator = creatorId === userId.toString();

    // 🔒 autorisation
    if (!isAdmin && !isCreator) {
      return c.json(
        { message: "Vous n'êtes pas autorisé à réactiver cette offre" },
        403
      );
    }

    // ⛔ doit être expirée
    const now = new Date();
    if (!job.dateCloture || new Date(job.dateCloture) >= now) {
      return c.json(
        { message: "Cette offre n'est pas expirée" },
        400
      );
    }

    // 📅 nouvelle date valide
    const newDate = new Date(body.newDateCloture);
    if (Number.isNaN(newDate.getTime()) || newDate <= now) {
      return c.json(
        { message: "La nouvelle date doit être dans le futur" },
        400
      );
    }

    // 🔁 RÉACTIVATION = CONFIRMEE
    await reactivateJobOffer(id, newDate, userId);

    return c.json(
      {
        message:
          "Offre réactivée avec succès. Elle est de nouveau publique et publiable sur LinkedIn.",
        id,
        newDateCloture: newDate.toISOString(),
        status: JOB_STATUS.CONFIRMEE,
      },
      200
    );
  } catch (err) {
    console.error("❌ Reactivate job error:", err);
    return c.json(
      {
        message: "Erreur lors de la réactivation de l'offre",
        error: err.message,
      },
      500
    );
  }
}

/* =========================================================
   GET /linkedin/auth-url
   Retourne l'URL OAuth LinkedIn à afficher côté front
========================================================= */
export async function linkedinAuthUrl(c) {
  const user = c.get("user");
  const userId = user?._id || user?.id;
  if (!userId) return c.json({ message: "Non autorisé" }, 401);

  // ✅ FIX: inclure jobId dans state pour rediriger vers la bonne page après OAuth
  const returnJobId = c.req.query("returnJobId") || "";
  const randomPart = crypto.randomBytes(16).toString("hex");
  const state = returnJobId ? `${randomPart}__${returnJobId}` : randomPart;

  const url = buildLinkedInAuthUrl({ state });
  return c.json({ url });
}

/* =========================================================
   GET /linkedin/callback?code=...
   Échange le code OAuth contre un access token et sauvegarde
========================================================= */
export async function linkedinCallback(c) {
  try {
    // ⚠️ Note: LinkedIn redirige sans JWT, donc on ne peut pas utiliser authMiddleware
    // Solution: récupérer le userId via le state (si stocké en session/DB)
    // En développement simple, on utilise une autre méthode (voir ci-dessous)

    const code = c.req.query("code");
    const error = c.req.query("error");
    const error_description = c.req.query("error_description");

    if (error) {
      const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";
      return c.redirect(
        `${FRONTEND_URL}/recruiter/jobs?linkedin=error&reason=${encodeURIComponent(error_description || error)}`
      );
    }

    if (!code) {
      return c.json({ message: "Code OAuth manquant" }, 400);
    }

    const tokenData = await exchangeCodeForToken(code);
    const accessToken = tokenData.access_token;
    const expiresIn = Number(tokenData.expires_in || 0);
    const expiresAt = Date.now() + expiresIn * 1000;

    // ✅ Récupérer le memberId LinkedIn pour identifier l'utilisateur
    const memberId = await getMemberId(accessToken);

    // ✅ Trouver l'utilisateur en base via son linkedinMemberId (si déjà stocké)
    // OU stocker le token de façon temporaire avec le memberId comme clé
    // Ici on stocke dans une collection temporaire, le front devra ensuite appeler
    // /linkedin/confirm-token avec son JWT pour lier le token à son compte
    await getDB().collection("linkedin_tokens_pending").updateOne(
      { memberId },
      {
        $set: {
          accessToken,
          expiresAt: new Date(expiresAt),
          scope: tokenData.scope || "openid profile email w_member_social",
          memberId,
          updatedAt: new Date(),
        },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true }
    );

    // ✅ FIX: Extraire le jobId depuis le state pour rediriger vers la bonne page
    const stateParam = c.req.query("state") || "";
    const stateParts = stateParam.split("__");
    const returnJobId = stateParts.length > 1 ? stateParts[1] : "";

    const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";
    // Rediriger vers /recruiter/jobs/:id si jobId présent, sinon page liste
    const redirectBase = returnJobId
      ? `${FRONTEND_URL}/recruiter/jobs/${returnJobId}`
      : `${FRONTEND_URL}/recruiter/jobs`;

    return c.redirect(
      `${redirectBase}?linkedin=connected&memberId=${memberId}`
    );
  } catch (err) {
    console.error("❌ LinkedIn callback error:", err?.response?.data || err);
    const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";
    return c.redirect(
      `${FRONTEND_URL}/recruiter/jobs?linkedin=error&reason=${encodeURIComponent(err.message)}`
    );
  }
}

/* =========================================================
   POST /linkedin/confirm-token
   ✅ NOUVEAU: Lier le token LinkedIn pending à l'utilisateur connecté
   Body: { memberId: string }
   Le front appelle cet endpoint après le callback avec son JWT
========================================================= */
export async function linkedinConfirmToken(c) {
  try {
    const user = c.get("user");
    const userId = user?._id || user?.id;
    if (!userId) return c.json({ message: "Non autorisé" }, 401);

    const body = await c.req.json();
    const { memberId } = body;

    if (!memberId) {
      return c.json({ message: "memberId manquant" }, 400);
    }

    // Récupérer le token pending
    const pending = await getDB()
      .collection("linkedin_tokens_pending")
      .findOne({ memberId });

    if (!pending) {
      return c.json(
        {
          message: "Token LinkedIn non trouvé. Reconnecte-toi via LinkedIn.",
          code: "NEED_LINKEDIN_CONNECT",
        },
        404
      );
    }

    // Vérifier non expiré
    if (pending.expiresAt && new Date(pending.expiresAt).getTime() < Date.now()) {
      return c.json(
        {
          message: "Token LinkedIn expiré. Reconnecte-toi.",
          code: "LINKEDIN_TOKEN_EXPIRED",
        },
        401
      );
    }

    // Sauvegarder le token lié à l'utilisateur
    await saveLinkedInToken({
      userId,
      accessToken: pending.accessToken,
      expiresAt: pending.expiresAt,
      scope: pending.scope,
    });

    // Supprimer le pending
    await getDB()
      .collection("linkedin_tokens_pending")
      .deleteOne({ memberId });

    return c.json({ message: "LinkedIn connecté avec succès ✅", connected: true }, 200);
  } catch (err) {
    console.error("❌ LinkedIn confirm token error:", err);
    return c.json(
      { message: "Erreur liaison token LinkedIn", error: err.message },
      500
    );
  }
}

/* =========================================================
   ✅ NOUVEAU: GET /linkedin/status
   Vérifier si l'utilisateur a un token LinkedIn valide
   Retourne: { connected: boolean, expiresAt: string|null }
========================================================= */
/* =========================================================
   ✅ NOUVEAU: POST /linkedin/exchange-code
   Le FRONT appelle cet endpoint avec le code OAuth reçu de LinkedIn
   (car LINKEDIN_REDIRECT_URI pointe vers le front, pas le backend)
   Body: { code: string, state: string }
   Retourne: { memberId: string }
========================================================= */
export async function linkedinExchangeCode(c) {
  try {
    const user = c.get("user");
    const userId = user?._id || user?.id;
    if (!userId) return c.json({ message: "Non autorisé" }, 401);

    const body = await c.req.json().catch(() => ({}));
    const { code, state } = body;

    if (!code) return c.json({ message: "code OAuth manquant" }, 400);

    // Échanger le code contre un access token
    const tokenData = await exchangeCodeForToken(code);
    const accessToken = tokenData.access_token;
    const expiresIn = Number(tokenData.expires_in || 0);
    const expiresAt = Date.now() + expiresIn * 1000;

    // Récupérer le memberId LinkedIn
    const memberId = await getMemberId(accessToken);
    if (!memberId) return c.json({ message: "Impossible de récupérer le profil LinkedIn" }, 500);

    // Sauvegarder directement le token lié à l'utilisateur (on a le JWT ici !)
    await saveLinkedInToken({
      userId,
      accessToken,
      expiresAt,
      scope: tokenData.scope || "openid profile email w_member_social",
    });

    // Extraire le returnJobId depuis le state (format: random__jobId)
    const stateParts = (state || "").split("__");
    const returnJobId = stateParts.length > 1 ? stateParts[1] : null;

    return c.json({
      message: "LinkedIn connecté avec succès ✅",
      connected: true,
      memberId,
      returnJobId,
    });
  } catch (err) {
    console.error("❌ LinkedIn exchange-code error:", err?.response?.data || err);
    return c.json(
      { message: "Erreur échange code LinkedIn", error: err.message, details: err?.response?.data },
      500
    );
  }
}

export async function linkedinStatus(c) {
  try {
    const user = c.get("user");
    const userId = user?._id || user?.id;
    if (!userId) return c.json({ message: "Non autorisé" }, 401);

    const tokenDoc = await getLinkedInToken(userId);

    if (!tokenDoc?.accessToken) {
      return c.json({ connected: false, expiresAt: null });
    }

    // Vérifier expiration
    if (tokenDoc.expiresAt && new Date(tokenDoc.expiresAt).getTime() < Date.now()) {
      return c.json({
        connected: false,
        expiresAt: tokenDoc.expiresAt,
        reason: "LINKEDIN_TOKEN_EXPIRED",
      });
    }

    return c.json({
      connected: true,
      expiresAt: tokenDoc.expiresAt || null,
    });
  } catch (err) {
    console.error("❌ LinkedIn status error:", err);
    return c.json(
      { message: "Erreur vérification statut LinkedIn", error: err.message },
      500
    );
  }
}

/* =========================================================
   POST /jobs/:id/publish-linkedin
========================================================= */
export async function publishJobToLinkedIn(c) {
  try {
    const user = c.get("user");
    const userId = user?._id || user?.id;
    if (!userId) return c.json({ message: "Non autorisé" }, 401);

    const { id } = c.req.param();
    if (!ObjectId.isValid(id)) {
      return c.json({ message: "ID invalide" }, 400);
    }

    const job = await findJobOfferById(id);
    if (!job) {
      return c.json({ message: "Offre non trouvée" }, 404);
    }

    /* ===============================
       🔐 TOKEN LINKEDIN
    =============================== */
    const tokenDoc = await getLinkedInToken(userId);
    if (!tokenDoc?.accessToken) {
      return c.json(
        {
          message: "LinkedIn non connecté. Veuillez vous connecter d'abord.",
          code: "NEED_LINKEDIN_CONNECT",
          connectUrl: "/linkedin/auth-url",
        },
        401
      );
    }

    if (
      tokenDoc.expiresAt &&
      new Date(tokenDoc.expiresAt).getTime() < Date.now()
    ) {
      return c.json(
        {
          message: "Token LinkedIn expiré. Reconnecte-toi.",
          code: "LINKEDIN_TOKEN_EXPIRED",
          connectUrl: "/linkedin/auth-url",
        },
        401
      );
    }

    /* ===============================
       📦 LECTURE multipart/form-data
       (texte + image)
    =============================== */
    const body = await c.req.parseBody();

    const customText = safeStr(body?.text);
    const imageFile = body?.image; // File | undefined

    const text = customText || buildJobPostText(job);

    /* ===============================
       👤 LINKEDIN MEMBER ID (OIDC)
    =============================== */
    const memberId = await getMemberId(tokenDoc.accessToken);
    if (!memberId) {
      return c.json(
        { message: "Impossible de récupérer le profil LinkedIn (userinfo)." },
        500
      );
    }

    /* ===============================
       🚀 PUBLISH LINKEDIN
       (avec / sans image)
    =============================== */
    const res = await publishMemberPost({
      accessToken: tokenDoc.accessToken,
      memberId,
      text,
      imageFile, // 👈 IMPORTANT
    });
    // res = { data, usedAuthor }

    /* ===============================
       💾 SAUVEGARDE DB
    =============================== */
    try {
      await getDB().collection("job_offers").updateOne(
        { _id: new ObjectId(id) },
        {
          $set: {
            linkedinLastPostId: res?.data?.id || null,
            linkedinLastPublishedAt: new Date(),
            linkedinLastPublishedBy: new ObjectId(userId),
            linkedinLastAuthor: res?.usedAuthor || null,
          },
        }
      );
    } catch (e) {
      console.error(
        "⚠️ Save LinkedIn publish info failed:",
        e?.message || e
      );
      // on ne casse pas la publication si la sauvegarde échoue
    }

    return c.json(
      {
        message: "Offre publiée sur LinkedIn ✅",
        post: res.data,
        usedAuthor: res.usedAuthor,
      },
      200
    );
  } catch (err) {
    console.error("❌ Publish LinkedIn error:", err?.response?.data || err);
    return c.json(
      {
        message: "Erreur publication LinkedIn",
        error: err.message,
        details: err?.response?.data,
      },
      500
    );
  }
}

async function uploadImageToLinkedIn(accessToken, imageFile, ownerUrn) {
  /* ===============================
     1️⃣ Register upload
  =============================== */
  const registerRes = await axios.post(
    "https://api.linkedin.com/v2/assets?action=registerUpload",
    {
      registerUploadRequest: {
        owner: ownerUrn,
        recipes: ["urn:li:digitalmediaRecipe:feedshare-image"],
        serviceRelationships: [
          {
            relationshipType: "OWNER",
            identifier: "urn:li:userGeneratedContent",
          },
        ],
      },
    },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    }
  );

  const uploadUrl =
    registerRes.data.value.uploadMechanism[
      "com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"
    ].uploadUrl;

  const assetUrn = registerRes.data.value.asset;

  /* ===============================
     2️⃣ CONVERT File -> Buffer 🔥
  =============================== */
  const arrayBuffer = await imageFile.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  /* ===============================
     3️⃣ Upload binary (CORRECT)
  =============================== */
  await axios.put(uploadUrl, buffer, {
    headers: {
      "Content-Type": imageFile.type || "image/png",
      "Content-Length": buffer.length,
    },
    maxBodyLength: Infinity,
  });

  return assetUrn;
}



/* =========================================================
   GET /jobs/my-assigned
   Retourne les offres assignées à l'utilisateur connecté
========================================================= */
export async function getMyAssignedJobs(c) {
  try {
    const user = c.get("user");
    const userId = user?._id || user?.id;

    if (!userId || !ObjectId.isValid(userId)) {
      return c.json({ message: "ID utilisateur invalide" }, 400);
    }

    const jobs = await findJobOffersByUser(userId); // ✅ utilise assignedUserIds
    return c.json(jobs);
  } catch (err) {
    console.error("❌ Get my assigned jobs error:", err);
    return c.json(
      { message: "Erreur lors de la récupération des offres assignées", error: err.message },
      500
    );
  }
}



export async function validateJob(c) {
  try {
    const { id } = c.req.param();
    const user = c.get("user");
    const adminId = user?._id || user?.id;

    if (!ObjectId.isValid(id)) {
      return c.json({ message: "ID invalide" }, 400);
    }

    const job = await findJobOfferById(id);
    if (!job) {
      return c.json({ message: "Offre non trouvée" }, 404);
    }

    // ⛔ déjà validée ou confirmée
    if (job.status !== JOB_STATUS.EN_ATTENTE) {
      return c.json(
        { message: "L’offre n’est plus en attente de validation" },
        400
      );
    }

    // ✅ ÉTAPE 1 : EN_ATTENTE → VALIDEE
    await updateJobOfferStatus(id, JOB_STATUS.VALIDEE, adminId);

    // 🔔 notification responsable
    try {
      const assigned = Array.isArray(job.assignedUserIds)
        ? job.assignedUserIds
        : [];

      for (const uid of assigned) {
        await createNotification({
          userId: uid.toString(),
          type: NOTIFICATION_TYPES.JOB_VALIDATED,
          message: `Votre offre "${job.titre}" a été validée (étape 1).`,
          link: `/ResponsableMetier/jobs`,
          metadata: {
            jobId: id,
            step: "VALIDEE",
          },
        });
      }
    } catch (e) {
      console.error("Notification validation échouée:", e.message);
    }

    return c.json(
      { message: "Offre validée (étape 1)", id, status: JOB_STATUS.VALIDEE },
      200
    );
  } catch (err) {
    console.error("Validate job error:", err);
    return c.json(
      { message: "Erreur lors de la validation", error: err.message },
      500
    );
  }
}