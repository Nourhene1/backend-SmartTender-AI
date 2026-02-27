import { ObjectId } from "mongodb";
import { getDB } from "./db.js";

const COLLECTION_NAME = "notifications";
const collection = () => getDB().collection(COLLECTION_NAME);

// ✅ Types de notifications
export const NOTIFICATION_TYPES = {
  // Pour Admin
  NEW_JOB_PENDING: "NEW_JOB_PENDING",         // Nouvelle offre en attente
  NEW_CANDIDATURE: "NEW_CANDIDATURE",           // Nouvelle candidature postulée

  // Pour ResponsableMetier
  JOB_CONFIRMED: "JOB_CONFIRMED",             // Offre confirmée par admin
  JOB_REJECTED: "JOB_REJECTED",               // Offre rejetée par admin

  // ─── Entretiens ───
  // Pour ResponsableMetier
  INTERVIEW_SCHEDULED: "INTERVIEW_SCHEDULED",                     // Admin a planifié un entretien
  INTERVIEW_CANDIDATE_CONFIRMED: "INTERVIEW_CANDIDATE_CONFIRMED", // Candidat a confirmé
  INTERVIEW_ADMIN_APPROVED_MODIF: "INTERVIEW_ADMIN_APPROVED_MODIF",   // Admin a approuvé la modif
  INTERVIEW_ADMIN_REJECTED_MODIF: "INTERVIEW_ADMIN_REJECTED_MODIF",   // Admin a refusé la modif

  // Pour Admin
  INTERVIEW_RESPONSABLE_CONFIRMED: "INTERVIEW_RESPONSABLE_CONFIRMED", // Responsable a confirmé la date
  INTERVIEW_RESPONSABLE_MODIFIED: "INTERVIEW_RESPONSABLE_MODIFIED",   // Responsable demande modif date
  INTERVIEW_CANDIDATE_RESCHEDULE: "INTERVIEW_CANDIDATE_RESCHEDULE",   // Candidat propose autre date
};

/**
 * Créer une notification
 */
export async function createNotification({ userId, type, message, link, metadata }) {
  const recipientId = typeof userId === "string" ? new ObjectId(userId) : userId;

  return collection().insertOne({
    userId: recipientId,
    type,
    message,
    link: link || null,
    metadata: metadata || {},
    read: false,
    createdAt: new Date(),
  });
}

/**
 * Créer une notification pour TOUS les admins
 */
export async function createNotificationForAdmins({ type, message, link, metadata }) {
  const admins = await getDB()
    .collection("users")
    .find({ role: "ADMIN" })
    .project({ _id: 1 })
    .toArray();

  if (admins.length === 0) return [];

  const notifications = admins.map((admin) => ({
    userId: admin._id,
    type,
    message,
    link: link || null,
    metadata: metadata || {},
    read: false,
    createdAt: new Date(),
  }));

  return collection().insertMany(notifications);
}

/**
 * Récupérer les notifications d'un utilisateur (les plus récentes en premier)
 */
export async function findNotificationsByUser(userId, { limit = 20, unreadOnly = false } = {}) {
  const filter = {
    userId: typeof userId === "string" ? new ObjectId(userId) : userId,
  };

  if (unreadOnly) {
    filter.read = false;
  }

  return collection()
    .find(filter)
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
}

/**
 * Compter les notifications non lues
 */
export async function countUnreadNotifications(userId) {
  return collection().countDocuments({
    userId: typeof userId === "string" ? new ObjectId(userId) : userId,
    read: false,
  });
}

/**
 * Marquer une notification comme lue
 */
export async function markNotificationAsRead(notificationId) {
  if (!ObjectId.isValid(notificationId)) {
    throw new Error("Invalid notification ID");
  }

  return collection().updateOne(
    { _id: new ObjectId(notificationId) },
    { $set: { read: true, readAt: new Date() } }
  );
}

/**
 * Marquer TOUTES les notifications d'un utilisateur comme lues
 */
export async function markAllNotificationsAsRead(userId) {
  return collection().updateMany(
    {
      userId: typeof userId === "string" ? new ObjectId(userId) : userId,
      read: false,
    },
    { $set: { read: true, readAt: new Date() } }
  );
}

/**
 * Supprimer les anciennes notifications (> 30 jours)
 */
export async function cleanOldNotifications(daysOld = 30) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysOld);

  return collection().deleteMany({
    createdAt: { $lt: cutoff },
    read: true,
  });
}