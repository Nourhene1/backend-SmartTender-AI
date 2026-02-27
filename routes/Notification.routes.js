
import { Hono } from "hono";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
} from "../controllers/notification.controller.js";

const notificationRoutes = new Hono();

// ✅ Toutes les routes nécessitent une authentification
notificationRoutes.use("/*", authMiddleware);

notificationRoutes.get("/", getNotifications);
notificationRoutes.get("/unread-count", getUnreadCount);
notificationRoutes.put("/read-all", markAllAsRead);
notificationRoutes.put("/:id/read", markAsRead);

export default notificationRoutes;

/*
  ✅ À ajouter dans ton fichier principal (index.js ou app.js) :
  
  import notificationRoutes from "./routes/notification.routes.js";
  app.route("/notifications", notificationRoutes);
*/
