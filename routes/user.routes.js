import { Hono } from "hono";
import {
  register,
  login,
  logout,
  getUsers,
  updateUserController,
  removeUser,
  createUserByAdmin,   // ✅ Nouveau — admin crée sans mot de passe
  setupPassword     // ✅ Nouveau — utilisateur définit son mot de passe,    // ✅ Nouveau — vérification du token avant affichage du form
} from "../controllers/user.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { adminOnly } from "../middlewares/admin.middleware.js";

const router = new Hono();

/* ── Public ─────────────────────────────────────────── */
router.post("/register", register);
router.post("/login", login);

// ✅ Routes pour l'activation de compte (sans auth)
router.post("/setup-password", setupPassword);

/* ── Protégé ─────────────────────────────────────────── */
router.post("/logout", authMiddleware, logout);
router.get("/", authMiddleware, getUsers);

// ✅ Création par admin (sans mot de passe + envoi email)
router.post("/admin/create", authMiddleware, createUserByAdmin);

router.patch("/:id", authMiddleware, adminOnly, updateUserController);
router.delete("/:id", authMiddleware, adminOnly, removeUser);

export default router;