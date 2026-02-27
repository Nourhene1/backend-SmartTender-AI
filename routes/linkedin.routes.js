import { Hono } from "hono";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import {
  linkedinAuthUrl,
  linkedinCallback,
  linkedinStatus,
  linkedinConfirmToken,
  linkedinExchangeCode,
} from "../controllers/job.controller.js";

const router = new Hono();

/**
 * GET /linkedin/auth-url?returnJobId=xxx
 * Retourne l'URL OAuth LinkedIn
 * Requiert: auth (JWT)
 */
router.get("/auth-url", authMiddleware, linkedinAuthUrl);

/**
 * GET /linkedin/callback?code=...
 * Callback OAuth LinkedIn (plus utilisé activement car redirect_uri = front)
 * Gardé pour compatibilité
 */
router.get("/callback", linkedinCallback);

/**
 * POST /linkedin/confirm-token
 * Lier un token pending à l'utilisateur connecté
 * Body: { memberId: string }
 */
router.post("/confirm-token", authMiddleware, linkedinConfirmToken);

/**
 * GET /linkedin/status
 * Vérifie si l'utilisateur a un token LinkedIn valide
 * Retourne: { connected: boolean, expiresAt: string|null }
 */
router.get("/status", authMiddleware, linkedinStatus);

/**
 * ✅ NOUVEAU: POST /linkedin/exchange-code
 * Le FRONT reçoit le ?code= de LinkedIn (car redirect_uri = frontend)
 * et l'envoie ici pour échange + sauvegarde du token
 * Body: { code: string, state: string }
 * Retourne: { connected: true, memberId, returnJobId }
 */
router.post("/exchange-code", authMiddleware, linkedinExchangeCode);

export default router;