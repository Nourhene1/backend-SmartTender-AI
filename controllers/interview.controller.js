import {
  createInterview,
  findInterviewById,
  findInterviewByToken,
  findInterviewByCandidateToken,
  findInterviewsByCandidature,
  findInterviewsByJobOffer,
  findInterviewsByUser,
  confirmInterview,
  modifyInterview,
  cancelInterview,
  getUpcomingInterviews,
  candidateConfirmInterview,
  candidateRequestReschedule,
  adminApproveModification,
  adminRejectModification,
} from "../models/interview.model.js";

import {
  sendInterviewConfirmationRequest,
  sendInterviewConfirmationToCandidate,
  sendModificationRequestToAdmin,
  sendCandidateConfirmedNotification,
  sendCandidateConfirmedToResponsable,
  sendCandidateRescheduleRequestToAdmin,
  sendAdminApprovedModificationToResponsable,
  sendAdminRejectedModificationToResponsable,
} from "../services/interview-mail.service.js";

import { findJobOfferById } from "../models/job.model.js";
import { findUserById } from "../models/user.model.js";
import { ObjectId } from "mongodb";
import { getDB } from "../models/db.js";
import {
  createNotification,
  createNotificationForAdmins,
  NOTIFICATION_TYPES,
} from "../models/Notification.model.js";

/* ============================================================
 *  FLOW COMPLET :
 * ============================================================
 *
 *  1. Admin planifie l'entretien
 *     → Mail au ResponsableMetier (confirmer / modifier)
 *
 *  2a. ResponsableMetier CONFIRME
 *      → Mail au Candidat avec lien (confirmer / proposer autre date)
 *
 *  2b. ResponsableMetier MODIFIE la date
 *      → Mail à l'ADMIN (pas au candidat !)
 *      → Admin accepte ou refuse la nouvelle date
 *
 *  3a. Candidat CONFIRME
 *      → Entretien définitivement confirmé
 *
 *  3b. Candidat PROPOSE AUTRE DATE (via formulaire)
 *      → Mail à l'Admin avec la date proposée
 *      → Admin gère
 *
 * ============================================================ */

// ──────────────────────────────────────────────
//  Helpers
// ──────────────────────────────────────────────

async function getCandidateName(candidatureId) {
  try {
    const candidature = await getDB()
      .collection("candidatures")
      .findOne({ _id: new ObjectId(candidatureId) });

    if (!candidature) {
      console.warn("⚠️ Candidature not found:", candidatureId);
      return "Candidat inconnu";
    }

    return (
      candidature.extracted?.parsed?.nom ||
      candidature.extracted?.parsed?.name ||
      candidature.extracted?.parsed?.full_name ||
      candidature.extracted?.nom ||
      candidature.extracted?.name ||
      candidature.extracted?.manual?.nom ||
      candidature.extracted?.manual?.name ||
      candidature.personalInfoForm?.nom ||
      candidature.personalInfoForm?.name ||
      "Candidat inconnu"
    );
  } catch (error) {
    console.error("❌ Error getting candidate name:", error);
    return "Candidat inconnu";
  }
}

async function getCandidateEmail(candidatureId) {
  try {
    const candidature = await getDB()
      .collection("candidatures")
      .findOne({ _id: new ObjectId(candidatureId) });

    if (!candidature) return null;

    return (
      candidature.extracted?.parsed?.email ||
      candidature.extracted?.email ||
      candidature.extracted?.manual?.email ||
      candidature.personalInfoForm?.email ||
      null
    );
  } catch (error) {
    console.error("❌ Error getting candidate email:", error);
    return null;
  }
}

function formatDateFR(dateStr) {
  return new Date(dateStr).toLocaleDateString("fr-FR", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

// ══════════════════════════════════════════════
//  ÉTAPE 1 : Admin planifie l'entretien
//  POST /schedule
// ══════════════════════════════════════════════
export async function scheduleInterview(c) {
  try {
    const body = await c.req.json();
    const {
      candidatureId,
      jobOfferId,
      candidateEmail: providedEmail,
      candidateName: providedName,
      proposedDate,
      proposedTime,
      notes,
    } = body;

    // Validation
    if (!candidatureId || !jobOfferId || !proposedDate || !proposedTime) {
      return c.json(
        { success: false, message: "Tous les champs sont obligatoires" },
        400
      );
    }

    // Récupérer nom et email du candidat depuis la DB
    const candidateName =
      (await getCandidateName(candidatureId)) || providedName || "Candidat inconnu";
    const candidateEmail =
      (await getCandidateEmail(candidatureId)) || providedEmail;

    if (!candidateEmail) {
      return c.json(
        { success: false, message: "Email du candidat introuvable" },
        400
      );
    }

    // Trouver l'offre et le responsable
    const job = await findJobOfferById(jobOfferId);
    if (!job) {
      return c.json(
        { success: false, message: "Offre d'emploi introuvable" },
        404
      );
    }

    if (!job.assignedUserIds || job.assignedUserIds.length === 0) {
      return c.json(
        { success: false, message: "Aucun responsable assigné à cette offre" },
        400
      );
    }

    const assignedUserId = job.assignedUserIds[0];
    const assignedUser = await findUserById(assignedUserId);

    if (!assignedUser) {
      return c.json(
        { success: false, message: "Responsable introuvable" },
        404
      );
    }

    // Créer l'entretien
    const result = await createInterview({
      candidatureId,
      jobOfferId,
      candidateEmail,
      candidateName,
      assignedUserId: assignedUser._id,
      assignedUserEmail: assignedUser.email,
      proposedDate,
      proposedTime,
      notes,
    });

    const interview = await findInterviewById(result.insertedId);

    // ✉️ Mail au ResponsableMetier
    await sendInterviewConfirmationRequest({
      responsibleEmail: assignedUser.email,
      responsibleName:
        `${assignedUser.prenom} ${assignedUser.nom}`.trim() || assignedUser.email,
      candidateName,
      jobTitle: job.titre,
      proposedDate: formatDateFR(proposedDate),
      proposedTime,
      rawDate: proposedDate,
      confirmationToken: interview.confirmationToken,
    });

    // 🔔 Notification au ResponsableMetier
    await createNotification({
      userId: assignedUser._id,
      type: NOTIFICATION_TYPES.INTERVIEW_SCHEDULED,
      message: `📅 Entretien planifié avec ${candidateName} pour "${job.titre}". Veuillez confirmer ou modifier la date.`,
      link: `/ResponsableMetier/confirm-interview/${interview.confirmationToken}`,
      metadata: { interviewId: interview._id, candidateName, jobTitle: job.titre },
    });

    return c.json(
      {
        success: true,
        message: "Entretien planifié avec succès. Email envoyé au responsable.",
        data: interview,
      },
      201
    );
  } catch (error) {
    console.error("Error scheduling interview:", error);
    return c.json(
      {
        success: false,
        message: "Erreur lors de la planification de l'entretien",
        error: error.message,
      },
      500
    );
  }
}

// ══════════════════════════════════════════════
//  GET /confirm/:token
//  Afficher les détails (page du ResponsableMetier)
// ══════════════════════════════════════════════
export async function getInterviewByToken(c) {
  try {
    const token = c.req.param("token");
    const interview = await findInterviewByToken(token);

    if (!interview) {
      return c.json({ success: false, message: "Entretien introuvable" }, 404);
    }

    const job = await findJobOfferById(interview.jobOfferId);

    return c.json({
      success: true,
      data: { ...interview, jobTitle: job?.titre || "N/A" },
    });
  } catch (error) {
    console.error("Error getting interview:", error);
    return c.json(
      {
        success: false,
        message: "Erreur lors de la récupération de l'entretien",
        error: error.message,
      },
      500
    );
  }
}

// ══════════════════════════════════════════════
//  ÉTAPE 2a : ResponsableMetier CONFIRME
//  POST /confirm/:token
//  → Mail au Candidat avec lien de confirmation
// ══════════════════════════════════════════════
export async function confirmInterviewByToken(c) {
  try {
    const token = c.req.param("token");
    const body = await c.req.json();
    const { confirmedDate, confirmedTime, notes, location } = body;

    const interview = await findInterviewByToken(token);
    if (!interview) {
      return c.json({ success: false, message: "Entretien introuvable" }, 404);
    }

    // Confirmer et générer le token candidat
    const candidateToken = await confirmInterview(
      token,
      confirmedDate,
      confirmedTime,
      notes
    );

    const job = await findJobOfferById(interview.jobOfferId);

    // ✉️ Mail au CANDIDAT avec lien pour confirmer ou proposer autre date
    await sendInterviewConfirmationToCandidate({
      candidateEmail: interview.candidateEmail,
      candidateName: interview.candidateName,
      jobTitle: job?.titre || "N/A",
      confirmedDate: formatDateFR(confirmedDate),
      confirmedTime,
      rawDate: confirmedDate,
      notes,
      location,
      candidateToken,
    });

    // 🔔 Notification aux admins : responsable a confirmé
    await createNotificationForAdmins({
      type: NOTIFICATION_TYPES.INTERVIEW_RESPONSABLE_CONFIRMED,
      message: `✅ Le responsable a confirmé l'entretien de ${interview.candidateName} pour "${job?.titre}". En attente de la confirmation du candidat.`,
      link: null,
      metadata: { interviewId: interview._id.toString(), candidateName: interview.candidateName },
    });

    return c.json({
      success: true,
      message:
        "Date confirmée. Un email a été envoyé au candidat pour validation.",
    });
  } catch (error) {
    console.error("Error confirming interview:", error);
    return c.json(
      {
        success: false,
        message: "Erreur lors de la confirmation de l'entretien",
        error: error.message,
      },
      500
    );
  }
}

// ══════════════════════════════════════════════
//  ÉTAPE 2b : ResponsableMetier MODIFIE la date
//  POST /modify/:token
//  → Mail à l'ADMIN (pas au candidat !)
// ══════════════════════════════════════════════
export async function modifyInterviewByToken(c) {
  try {
    const token = c.req.param("token");
    const body = await c.req.json();
    const { newDate, newTime, notes } = body;

    const interview = await findInterviewByToken(token);
    if (!interview) {
      return c.json({ success: false, message: "Entretien introuvable" }, 404);
    }

    // Stocker la demande de modif (PENDING_ADMIN_APPROVAL)
    await modifyInterview(token, newDate, newTime, notes);

    const job = await findJobOfferById(interview.jobOfferId);
    const assignedUser = await findUserById(interview.assignedUserId);

    // ✉️ Mail à l'ADMIN (pas au candidat)
    const adminEmail = process.env.ADMIN_EMAIL;
    if (!adminEmail) {
      console.error("❌ ADMIN_EMAIL non configuré dans .env");
      return c.json(
        { success: false, message: "Email administrateur non configuré. Contactez le support." },
        500
      );
    }

    await sendModificationRequestToAdmin({
      adminEmail,
      responsableName:
        assignedUser
          ? `${assignedUser.prenom} ${assignedUser.nom}`.trim()
          : interview.assignedUserEmail,
      candidateName: interview.candidateName,
      jobTitle: job?.titre || "N/A",
      originalDate: formatDateFR(interview.proposedDate),
      originalTime: interview.proposedTime,
      newDate: formatDateFR(newDate),
      newTime,
      notes,
      interviewId: interview._id.toString(),
    });

    // 🔔 Notification aux admins : responsable demande modif
    await createNotificationForAdmins({
      type: NOTIFICATION_TYPES.INTERVIEW_RESPONSABLE_MODIFIED,
      message: `⚠️ Le responsable demande de modifier l'entretien de ${interview.candidateName} pour "${job?.titre}". Approbation requise.`,
      link: `/admin/interview/approve/${interview._id.toString()}`,
      metadata: { interviewId: interview._id.toString(), candidateName: interview.candidateName },
    });

    return c.json({
      success: true,
      message:
        "Demande de modification envoyée à l'administrateur pour validation.",
    });
  } catch (error) {
    console.error("Error modifying interview:", error);
    return c.json(
      {
        success: false,
        message: "Erreur lors de la modification de l'entretien",
        error: error.message,
      },
      500
    );
  }
}

// ══════════════════════════════════════════════
//  GET /candidate/:candidateToken
//  Page du candidat — afficher les détails
// ══════════════════════════════════════════════
export async function getCandidateInterviewByToken(c) {
  try {
    const candidateToken = c.req.param("candidateToken");
    const interview = await findInterviewByCandidateToken(candidateToken);

    if (!interview) {
      return c.json({ success: false, message: "Entretien introuvable" }, 404);
    }

    const job = await findJobOfferById(interview.jobOfferId);

    return c.json({
      success: true,
      data: {
        candidateName: interview.candidateName,
        jobTitle: job?.titre || "N/A",
        confirmedDate: interview.confirmedDate,
        confirmedTime: interview.confirmedTime,
        notes: interview.notes,
        status: interview.status,
      },
    });
  } catch (error) {
    console.error("Error getting candidate interview:", error);
    return c.json(
      {
        success: false,
        message: "Erreur lors de la récupération de l'entretien",
        error: error.message,
      },
      500
    );
  }
}

// ══════════════════════════════════════════════
//  ÉTAPE 3a : Candidat CONFIRME l'entretien
//  POST /candidate/:candidateToken/confirm
// ══════════════════════════════════════════════
export async function candidateConfirmInterviewController(c) {
  try {
    const candidateToken = c.req.param("candidateToken");
    const interview = await findInterviewByCandidateToken(candidateToken);

    if (!interview) {
      return c.json({ success: false, message: "Entretien introuvable" }, 404);
    }

    if (interview.status !== "PENDING_CANDIDATE_CONFIRMATION") {
      return c.json(
        { success: false, message: "Cet entretien ne peut plus être confirmé" },
        400
      );
    }

    await candidateConfirmInterview(candidateToken);

    const job = await findJobOfferById(interview.jobOfferId);

    // ✉️ Notifier l'admin que le candidat a confirmé
    const adminEmail = process.env.ADMIN_EMAIL;
    if (!adminEmail) {
      console.warn("⚠️ ADMIN_EMAIL non configuré, notification admin ignorée");
    } else {
      await sendCandidateConfirmedNotification({
        adminEmail,
        candidateName: interview.candidateName,
        jobTitle: job?.titre || "N/A",
        confirmedDate: formatDateFR(interview.confirmedDate),
        confirmedTime: interview.confirmedTime,
      });
    }

    // ✉️ Notifier le ResponsableMetier que le candidat a confirmé
    const assignedUser = await findUserById(interview.assignedUserId);
    if (assignedUser) {
      await sendCandidateConfirmedToResponsable({
        responsibleEmail: assignedUser.email,
        responsibleName:
          `${assignedUser.prenom} ${assignedUser.nom}`.trim() || assignedUser.email,
        candidateName: interview.candidateName,
        jobTitle: job?.titre || "N/A",
        confirmedDate: formatDateFR(interview.confirmedDate),
        confirmedTime: interview.confirmedTime,
      });
    }

    // 🔔 Notification aux admins : candidat a confirmé
    await createNotificationForAdmins({
      type: NOTIFICATION_TYPES.INTERVIEW_CANDIDATE_CONFIRMED,
      message: `✅ ${interview.candidateName} a confirmé son entretien pour "${job?.titre}". Tout est prêt !`,
      link: null,
      metadata: { interviewId: interview._id.toString(), candidateName: interview.candidateName },
    });

    // 🔔 Notification au Responsable : candidat a confirmé
    if (assignedUser) {
      await createNotification({
        userId: assignedUser._id,
        type: NOTIFICATION_TYPES.INTERVIEW_CANDIDATE_CONFIRMED,
        message: `✅ ${interview.candidateName} a confirmé l'entretien pour "${job?.titre}". Préparez-vous !`,
        link: null,
        metadata: { interviewId: interview._id.toString(), candidateName: interview.candidateName },
      });
    }

    return c.json({
      success: true,
      message: "Entretien confirmé avec succès ! ",
    });
  } catch (error) {
    console.error("Error candidate confirm:", error);
    return c.json(
      {
        success: false,
        message: "Erreur lors de la confirmation",
        error: error.message,
      },
      500
    );
  }
}

// ══════════════════════════════════════════════
//  ÉTAPE 3b : Candidat PROPOSE AUTRE DATE
//  POST /candidate/:candidateToken/reschedule
// ══════════════════════════════════════════════
export async function candidateRescheduleController(c) {
  try {
    const candidateToken = c.req.param("candidateToken");
    const body = await c.req.json();
    const { proposedDate, proposedTime, reason } = body;

    if (!proposedDate || !proposedTime) {
      return c.json(
        { success: false, message: "Veuillez proposer une date et une heure" },
        400
      );
    }

    const interview = await findInterviewByCandidateToken(candidateToken);
    if (!interview) {
      return c.json({ success: false, message: "Entretien introuvable" }, 404);
    }

    if (interview.status !== "PENDING_CANDIDATE_CONFIRMATION") {
      return c.json(
        {
          success: false,
          message: "Cet entretien ne peut plus être modifié",
        },
        400
      );
    }

    await candidateRequestReschedule(
      candidateToken,
      proposedDate,
      proposedTime,
      reason
    );

    const job = await findJobOfferById(interview.jobOfferId);

    // ✉️ Mail à l'ADMIN : le candidat propose une autre date
    const adminEmail = process.env.ADMIN_EMAIL;
    if (!adminEmail) {
      console.error("❌ ADMIN_EMAIL non configuré dans .env");
      return c.json(
        { success: false, message: "Email administrateur non configuré. Contactez le support." },
        500
      );
    }

    await sendCandidateRescheduleRequestToAdmin({
      adminEmail,
      candidateName: interview.candidateName,
      candidateEmail: interview.candidateEmail,
      jobTitle: job?.titre || "N/A",
      originalDate: formatDateFR(interview.confirmedDate),
      originalTime: interview.confirmedTime,
      proposedDate: formatDateFR(proposedDate),
      proposedTime,
      reason,
      interviewId: interview._id.toString(),
    });

    // 🔔 Notification aux admins : candidat propose autre date
    await createNotificationForAdmins({
      type: NOTIFICATION_TYPES.INTERVIEW_CANDIDATE_RESCHEDULE,
      message: `📅 ${interview.candidateName} demande un report d'entretien pour "${job?.titre}". Action requise.`,
      link: null,
      metadata: { interviewId: interview._id.toString(), candidateName: interview.candidateName },
    });

    return c.json({
      success: true,
      message:
        "Votre demande de report a été envoyée. L'administration vous recontactera.",
    });
  } catch (error) {
    console.error("Error candidate reschedule:", error);
    return c.json(
      {
        success: false,
        message: "Erreur lors de la demande de report",
        error: error.message,
      },
      500
    );
  }
}

// ══════════════════════════════════════════════
//  ADMIN : Approuver la modification du ResponsableMetier
//  POST /admin/approve/:interviewId
// ══════════════════════════════════════════════
export async function adminApproveModificationController(c) {
  try {
    const interviewId = c.req.param("interviewId");

    const interview = await findInterviewById(interviewId);
    if (!interview) {
      return c.json({ success: false, message: "Entretien introuvable" }, 404);
    }

    if (interview.status !== "PENDING_ADMIN_APPROVAL") {
      return c.json(
        {
          success: false,
          message: "Cet entretien n'a pas de modification en attente",
        },
        400
      );
    }

    await adminApproveModification(interviewId);

    const job = await findJobOfferById(interview.jobOfferId);
    const assignedUser = await findUserById(interview.assignedUserId);

    // ✉️ Notifier le ResponsableMetier que l'admin a approuvé
    if (assignedUser) {
      await sendAdminApprovedModificationToResponsable({
        responsibleEmail: assignedUser.email,
        responsibleName:
          `${assignedUser.prenom} ${assignedUser.nom}`.trim() ||
          assignedUser.email,
        candidateName: interview.candidateName,
        jobTitle: job?.titre || "N/A",
        newDate: formatDateFR(interview.responsableProposedDate),
        newTime: interview.responsableProposedTime,
        confirmationToken: interview.confirmationToken,
      });
    }

    // 🔔 Notification au ResponsableMetier : admin a approuvé
    if (assignedUser) {
      await createNotification({
        userId: assignedUser._id,
        type: NOTIFICATION_TYPES.INTERVIEW_ADMIN_APPROVED_MODIF,
        message: `✅ Votre demande de modification pour l'entretien de ${interview.candidateName} a été approuvée. Veuillez re-confirmer.`,
        link: `/ResponsableMetier/confirm-interview/${interview.confirmationToken}`,
        metadata: { interviewId: interview._id.toString(), candidateName: interview.candidateName },
      });
    }

    return c.json({
      success: true,
      message:
        "Modification approuvée. Le responsable a été notifié pour re-confirmer.",
    });
  } catch (error) {
    console.error("Error admin approve:", error);
    return c.json(
      {
        success: false,
        message: "Erreur lors de l'approbation",
        error: error.message,
      },
      500
    );
  }
}

// ══════════════════════════════════════════════
//  ADMIN : Rejeter la modification du ResponsableMetier
//  POST /admin/reject/:interviewId
// ══════════════════════════════════════════════
export async function adminRejectModificationController(c) {
  try {
    const interviewId = c.req.param("interviewId");
    const body = await c.req.json();
    const { reason } = body;

    const interview = await findInterviewById(interviewId);
    if (!interview) {
      return c.json({ success: false, message: "Entretien introuvable" }, 404);
    }

    if (interview.status !== "PENDING_ADMIN_APPROVAL") {
      return c.json(
        {
          success: false,
          message: "Cet entretien n'a pas de modification en attente",
        },
        400
      );
    }

    await adminRejectModification(interviewId, reason);

    const job = await findJobOfferById(interview.jobOfferId);
    const assignedUser = await findUserById(interview.assignedUserId);

    // ✉️ Notifier le ResponsableMetier que l'admin a refusé
    if (assignedUser) {
      await sendAdminRejectedModificationToResponsable({
        responsibleEmail: assignedUser.email,
        responsibleName:
          `${assignedUser.prenom} ${assignedUser.nom}`.trim() ||
          assignedUser.email,
        candidateName: interview.candidateName,
        jobTitle: job?.titre || "N/A",
        reason,
        confirmationToken: interview.confirmationToken,
      });
    }

    // 🔔 Notification au ResponsableMetier : admin a refusé
    if (assignedUser) {
      await createNotification({
        userId: assignedUser._id,
        type: NOTIFICATION_TYPES.INTERVIEW_ADMIN_REJECTED_MODIF,
        message: `❌ Votre demande de modification pour l'entretien de ${interview.candidateName} a été refusée. Veuillez confirmer la date initiale.`,
        link: `/ResponsableMetier/confirm-interview/${interview.confirmationToken}`,
        metadata: { interviewId: interview._id.toString(), candidateName: interview.candidateName },
      });
    }

    return c.json({
      success: true,
      message: "Modification rejetée. Le responsable a été notifié.",
    });
  } catch (error) {
    console.error("Error admin reject:", error);
    return c.json(
      {
        success: false,
        message: "Erreur lors du rejet",
        error: error.message,
      },
      500
    );
  }
}

// ══════════════════════════════════════════════
//  Routes existantes (inchangées)
// ══════════════════════════════════════════════

// ══════════════════════════════════════════════
//  GET /:id — Charger un entretien par ID (pour page admin)
// ══════════════════════════════════════════════
export async function getInterviewByIdController(c) {
  try {
    const id = c.req.param("id");
    const interview = await findInterviewById(id);

    if (!interview) {
      return c.json({ success: false, message: "Entretien introuvable" }, 404);
    }

    const job = await findJobOfferById(interview.jobOfferId);

    return c.json({
      success: true,
      data: { ...interview, jobTitle: job?.titre || "N/A" },
    });
  } catch (error) {
    console.error("Error getting interview by id:", error);
    return c.json(
      {
        success: false,
        message: "Erreur lors de la récupération de l'entretien",
        error: error.message,
      },
      500
    );
  }
}

export async function getInterviewsByCandidature(c) {
  try {
    const candidatureId = c.req.param("candidatureId");
    const interviews = await findInterviewsByCandidature(candidatureId);
    return c.json({ success: true, data: interviews });
  } catch (error) {
    console.error("Error getting interviews:", error);
    return c.json(
      {
        success: false,
        message: "Erreur lors de la récupération des entretiens",
        error: error.message,
      },
      500
    );
  }
}

export async function getInterviewsByJobOffer(c) {
  try {
    const jobOfferId = c.req.param("jobOfferId");
    const interviews = await findInterviewsByJobOffer(jobOfferId);
    return c.json({ success: true, data: interviews });
  } catch (error) {
    console.error("Error getting interviews:", error);
    return c.json(
      {
        success: false,
        message: "Erreur lors de la récupération des entretiens",
        error: error.message,
      },
      500
    );
  }
}

export async function getInterviewsByUser(c) {
  try {
    const userId = c.req.param("userId");
    const interviews = await findInterviewsByUser(userId);
    return c.json({ success: true, data: interviews });
  } catch (error) {
    console.error("Error getting interviews:", error);
    return c.json(
      {
        success: false,
        message: "Erreur lors de la récupération des entretiens",
        error: error.message,
      },
      500
    );
  }
}

export async function getUpcomingInterviewsController(c) {
  try {
    const interviews = await getUpcomingInterviews();
    return c.json({ success: true, data: interviews });
  } catch (error) {
    console.error("Error getting upcoming interviews:", error);
    return c.json(
      {
        success: false,
        message: "Erreur lors de la récupération des entretiens à venir",
        error: error.message,
      },
      500
    );
  }
}

export async function cancelInterviewById(c) {
  try {
    const id = c.req.param("id");
    const body = await c.req.json();
    const { reason } = body;

    await cancelInterview(id, reason);
    return c.json({ success: true, message: "Entretien annulé avec succès" });
  } catch (error) {
    console.error("Error canceling interview:", error);
    return c.json(
      {
        success: false,
        message: "Erreur lors de l'annulation de l'entretien",
        error: error.message,
      },
      500
    );
  }
}