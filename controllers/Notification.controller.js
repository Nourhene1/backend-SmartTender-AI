import {
  findNotificationsByUser,
  countUnreadNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
} from "../models/Notification.model.js";
import { ObjectId } from "mongodb";

/* =========================================================
   GET /notifications
   ✅ Récupérer les notifications de l'utilisateur connecté
========================================================= */
export async function getNotifications(c) {
  try {
    const user = c.get("user");
    const userId = user._id || user.id;

    const notifications = await findNotificationsByUser(userId, { limit: 30 });

    return c.json(notifications);
  } catch (err) {
    console.error("❌ Get notifications error:", err);
    return c.json(
      { message: "Erreur lors de la récupération des notifications", error: err.message },
      500
    );
  }
}

/* =========================================================
   GET /notifications/unread-count
   ✅ Compter les notifications non lues
========================================================= */
export async function getUnreadCount(c) {
  try {
    const user = c.get("user");
    const userId = user._id || user.id;

    const count = await countUnreadNotifications(userId);

    return c.json({ count });
  } catch (err) {
    console.error("❌ Get unread count error:", err);
    return c.json(
      { message: "Erreur lors du comptage des notifications", error: err.message },
      500
    );
  }
}

/* =========================================================
   PUT /notifications/:id/read
   ✅ Marquer une notification comme lue
========================================================= */
export async function markAsRead(c) {
  try {
    const { id } = c.req.param();
    const user = c.get("user");

    if (!ObjectId.isValid(id)) {
      return c.json({ message: "ID invalide" }, 400);
    }

    await markNotificationAsRead(id);

    return c.json({ message: "Notification marquée comme lue", id });
  } catch (err) {
    console.error("❌ Mark as read error:", err);
    return c.json(
      { message: "Erreur lors de la mise à jour", error: err.message },
      500
    );
  }
}

/* =========================================================
   PUT /notifications/read-all
   ✅ Marquer toutes les notifications comme lues
========================================================= */
export async function markAllAsRead(c) {
  try {
    const user = c.get("user");
    const userId = user._id || user.id;

    await markAllNotificationsAsRead(userId);

    return c.json({ message: "Toutes les notifications ont été marquées comme lues" });
  } catch (err) {
    console.error("❌ Mark all as read error:", err);
    return c.json(
      { message: "Erreur lors de la mise à jour", error: err.message },
      500
    );
  }
}