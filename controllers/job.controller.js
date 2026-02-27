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
} from "../models/job.model.js";

import { findUserById } from "../models/user.model.js";
import { getDB } from "../models/db.js";
import { ObjectId } from "mongodb";

import {
  createNotificationForAdmins,
  createNotification,
  NOTIFICATION_TYPES,
} from "../models/Notification.model.js";
import { Buffer } from "buffer";

/* ===========================
   ✅ LINKEDIN
=========================== */
import axios from "axios";
import crypto from "crypto";

/**
 * Clamp score value between 0 and 100
 */


function getUserIdFromContext(c) {
  const u = c.get?.("user");
  const id = u?._id || u?.id || u?.userId;
  if (id) return String(id);

  const direct = c.get?.("userId");
  return direct ? String(direct) : "";
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

    // ✅ Admin crée directement en CONFIRMEE (publié)
    const status = JOB_STATUS.CONFIRMEE;

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

    const message = "Offre créée et publiée avec succès";

    

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

    if (job.status === JOB_STATUS.CONFIRMEE) {
      return c.json({ message: "L'offre est déjà publiée" }, 400);
    }

    // ✅ Publication directe
    await updateJobOfferStatus(id, JOB_STATUS.CONFIRMEE, adminId);

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

    await deleteJobOffer(id);

    return c.json({ message: "Offre supprimée", id }, 200);
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
    const pendingCount = 0;
    const confirmedCount = await countJobOffersByStatus(JOB_STATUS.CONFIRMEE);
    const rejectedCount = 0;

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

    if (false) {
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
   GET /jobs/my-assigned
   Retourne les offres assignées à l'utilisateur connecté
========================================================= */
