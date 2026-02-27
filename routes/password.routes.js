import { Hono } from "hono";
import {
  forgotPassword,
  verifyResetCode,
  resetPassword,
  resendResetCode,
} from "../controllers/password.controller.js";

const router = new Hono();

/* =========================
   PASSWORD RESET ROUTES
   Toutes ces routes sont publiques (pas d'authentification requise)
========================= */

// Étape 1: Demander un code de réinitialisation
// POST /api/password/forgot
// Body: { email: "user@example.com" }
router.post("/forgot", forgotPassword);

// Étape 2: Vérifier le code
// POST /api/password/verify-code
// Body: { email: "user@example.com", code: "123456" }
router.post("/verify-code", verifyResetCode);

// Étape 3: Réinitialiser le mot de passe
// POST /api/password/reset
// Body: { email: "user@example.com", code: "123456", newPassword: "newpass", confirmPassword: "newpass" }
router.post("/reset", resetPassword);

// Renvoyer un code
// POST /api/password/resend-code
// Body: { email: "user@example.com" }
router.post("/resend-code", resendResetCode);

export default router;