import { ObjectId } from "mongodb";
import { getDB } from "./db.js";

const COLLECTION_NAME = "interviews";
const collection = () => getDB().collection(COLLECTION_NAME);

/*
 * ============================================================
 *  STATUTS POSSIBLES :
 * ============================================================
 *  PENDING_CONFIRMATION          → En attente de confirmation du ResponsableMetier
 *  PENDING_CANDIDATE_CONFIRMATION → ResponsableMetier a confirmé, en attente du candidat
 *  CONFIRMED                     → Candidat a confirmé l'entretien
 *  CANDIDATE_REQUESTED_RESCHEDULE → Candidat a proposé une autre date
 *  PENDING_ADMIN_APPROVAL        → ResponsableMetier a demandé une modif, en attente de l'admin
 *  MODIFIED                      → Admin a approuvé la modif du ResponsableMetier
 *  CANCELLED                     → Annulé
 * ============================================================
 */

/**
 * Create a new interview
 */
export async function createInterview({
  candidatureId,
  jobOfferId,
  candidateEmail,
  candidateName,
  assignedUserId,
  assignedUserEmail,
  proposedDate,
  proposedTime,
  status = "PENDING_CONFIRMATION",
  notes,
}) {
  const confirmationToken = generateToken();

  return collection().insertOne({
    candidatureId: new ObjectId(candidatureId),
    jobOfferId: new ObjectId(jobOfferId),
    candidateEmail,
    candidateName,
    assignedUserId: new ObjectId(assignedUserId),
    assignedUserEmail,
    proposedDate: new Date(proposedDate),
    proposedTime,
    confirmedDate: null,
    confirmedTime: null,
    status,
    // Token pour le ResponsableMetier
    confirmationToken,
    // Token pour le Candidat (généré quand le responsable confirme)
    candidateToken: null,
    // Date proposée par le candidat (s'il demande un report)
    candidateProposedDate: null,
    candidateProposedTime: null,
    candidateRescheduleReason: null,
    // Date proposée par le ResponsableMetier (en attente d'approbation admin)
    responsableProposedDate: null,
    responsableProposedTime: null,
    responsableModificationNotes: null,
    notes: notes || "",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

/**
 * Find interview by ID
 */
export async function findInterviewById(id) {
  if (!ObjectId.isValid(id)) {
    return null;
  }
  return collection().findOne({ _id: new ObjectId(id) });
}

/**
 * Find interview by confirmation token (ResponsableMetier)
 */
export async function findInterviewByToken(token) {
  return collection().findOne({ confirmationToken: token });
}

/**
 * Find interview by candidate token
 */
export async function findInterviewByCandidateToken(token) {
  return collection().findOne({ candidateToken: token });
}

/**
 * Find all interviews for a candidature
 */
export async function findInterviewsByCandidature(candidatureId) {
  if (!ObjectId.isValid(candidatureId)) {
    return [];
  }
  return collection()
    .find({ candidatureId: new ObjectId(candidatureId) })
    .sort({ createdAt: -1 })
    .toArray();
}

/**
 * Find all interviews for a job offer
 */
export async function findInterviewsByJobOffer(jobOfferId) {
  if (!ObjectId.isValid(jobOfferId)) {
    return [];
  }
  return collection()
    .find({ jobOfferId: new ObjectId(jobOfferId) })
    .sort({ proposedDate: 1 })
    .toArray();
}

/**
 * Find all interviews assigned to a user
 */
export async function findInterviewsByUser(userId) {
  if (!ObjectId.isValid(userId)) {
    return [];
  }
  return collection()
    .find({ assignedUserId: new ObjectId(userId) })
    .sort({ proposedDate: 1 })
    .toArray();
}

/**
 * Update interview (générique)
 */
export async function updateInterview(id, data) {
  if (!ObjectId.isValid(id)) {
    throw new Error("Invalid interview ID");
  }

  const updateData = { ...data };

  if (updateData.proposedDate) {
    updateData.proposedDate = new Date(updateData.proposedDate);
  }
  if (updateData.confirmedDate) {
    updateData.confirmedDate = new Date(updateData.confirmedDate);
  }

  updateData.updatedAt = new Date();

  return collection().updateOne(
    { _id: new ObjectId(id) },
    { $set: updateData }
  );
}

// ──────────────────────────────────────────────
//  ÉTAPE 2 : ResponsableMetier confirme la date
//  → Passe en PENDING_CANDIDATE_CONFIRMATION
//  → Génère un candidateToken pour le candidat
// ──────────────────────────────────────────────
export async function confirmInterview(token, confirmedDate, confirmedTime, notes) {
  const candidateToken = generateToken();

  await collection().updateOne(
    { confirmationToken: token },
    {
      $set: {
        status: "PENDING_CANDIDATE_CONFIRMATION",
        confirmedDate: new Date(confirmedDate),
        confirmedTime,
        candidateToken,
        notes: notes || "",
        confirmedAt: new Date(),
        updatedAt: new Date(),
      },
    }
  );

  return candidateToken;
}

// ──────────────────────────────────────────────
//  ÉTAPE 2-bis : ResponsableMetier modifie la date
//  → Passe en PENDING_ADMIN_APPROVAL
//  → Stocke la date proposée, attend validation admin
// ──────────────────────────────────────────────
export async function modifyInterview(token, newDate, newTime, notes) {
  return collection().updateOne(
    { confirmationToken: token },
    {
      $set: {
        status: "PENDING_ADMIN_APPROVAL",
        responsableProposedDate: new Date(newDate),
        responsableProposedTime: newTime,
        responsableModificationNotes: notes || "",
        modifiedAt: new Date(),
        updatedAt: new Date(),
      },
    }
  );
}

// ──────────────────────────────────────────────
//  ÉTAPE 3a : Candidat confirme l'entretien
//  → Passe en CONFIRMED
// ──────────────────────────────────────────────
export async function candidateConfirmInterview(candidateToken) {
  return collection().updateOne(
    { candidateToken },
    {
      $set: {
        status: "CONFIRMED",
        candidateConfirmedAt: new Date(),
        updatedAt: new Date(),
      },
    }
  );
}

// ──────────────────────────────────────────────
//  ÉTAPE 3b : Candidat propose une autre date
//  → Passe en CANDIDATE_REQUESTED_RESCHEDULE
// ──────────────────────────────────────────────
export async function candidateRequestReschedule(candidateToken, proposedDate, proposedTime, reason) {
  return collection().updateOne(
    { candidateToken },
    {
      $set: {
        status: "CANDIDATE_REQUESTED_RESCHEDULE",
        candidateProposedDate: new Date(proposedDate),
        candidateProposedTime: proposedTime,
        candidateRescheduleReason: reason || "",
        candidateRescheduleAt: new Date(),
        updatedAt: new Date(),
      },
    }
  );
}

// ──────────────────────────────────────────────
//  ADMIN : Approuve la modification du ResponsableMetier
//  → Applique la nouvelle date, repasse en PENDING_CONFIRMATION
//    (pour relancer le flow) ou directement PENDING_CANDIDATE_CONFIRMATION
// ──────────────────────────────────────────────
export async function adminApproveModification(interviewId) {
  if (!ObjectId.isValid(interviewId)) {
    throw new Error("Invalid interview ID");
  }

  const interview = await findInterviewById(interviewId);
  if (!interview) {
    throw new Error("Interview not found");
  }

  return collection().updateOne(
    { _id: new ObjectId(interviewId) },
    {
      $set: {
        status: "PENDING_CONFIRMATION",
        proposedDate: interview.responsableProposedDate,
        proposedTime: interview.responsableProposedTime,
        notes: interview.responsableModificationNotes || interview.notes,
        // Reset les champs temporaires
        responsableProposedDate: null,
        responsableProposedTime: null,
        responsableModificationNotes: null,
        adminApprovedAt: new Date(),
        updatedAt: new Date(),
      },
    }
  );
}

// ──────────────────────────────────────────────
//  ADMIN : Rejette la modification du ResponsableMetier
//  → Repasse en PENDING_CONFIRMATION avec l'ancienne date
// ──────────────────────────────────────────────
export async function adminRejectModification(interviewId, reason) {
  if (!ObjectId.isValid(interviewId)) {
    throw new Error("Invalid interview ID");
  }

  return collection().updateOne(
    { _id: new ObjectId(interviewId) },
    {
      $set: {
        status: "PENDING_CONFIRMATION",
        responsableProposedDate: null,
        responsableProposedTime: null,
        responsableModificationNotes: null,
        adminRejectionReason: reason || "",
        adminRejectedAt: new Date(),
        updatedAt: new Date(),
      },
    }
  );
}

/**
 * Cancel interview
 */
export async function cancelInterview(id, reason) {
  if (!ObjectId.isValid(id)) {
    throw new Error("Invalid interview ID");
  }

  return collection().updateOne(
    { _id: new ObjectId(id) },
    {
      $set: {
        status: "CANCELLED",
        cancelReason: reason || "",
        cancelledAt: new Date(),
        updatedAt: new Date(),
      },
    }
  );
}

/**
 * Delete interview
 */
export async function deleteInterview(id) {
  if (!ObjectId.isValid(id)) {
    throw new Error("Invalid interview ID");
  }
  return collection().deleteOne({ _id: new ObjectId(id) });
}

/**
 * Generate unique token
 */
function generateToken() {
  return (
    Math.random().toString(36).substring(2, 15) +
    Math.random().toString(36).substring(2, 15) +
    Date.now().toString(36)
  );
}

/**
 * Get upcoming interviews (next 7 days)
 */
export async function getUpcomingInterviews() {
  const now = new Date();
  const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  return collection()
    .find({
      status: { $in: ["CONFIRMED", "PENDING_CONFIRMATION", "PENDING_CANDIDATE_CONFIRMATION"] },
      proposedDate: { $gte: now, $lte: nextWeek },
    })
    .sort({ proposedDate: 1 })
    .toArray();
}