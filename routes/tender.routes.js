// src/routes/tender.routes.js
import { Hono } from "hono";
import {
  analyzeTender, getTenders, getTenderById,
  deleteTender, updateTenderStatus,
  getPublicTenders, getPublicTenderById, applyToTender,
} from "../controllers/tender.controller.js";

import { authMiddleware } from "../middlewares/auth.middleware.js";
import { adminOnly }      from "../middlewares/admin.middleware.js";

const router = new Hono();

/* ── PUBLIC (candidats — sans auth) ─────────────────────── */
router.get("/public",            getPublicTenders);
router.get("/public/:id",        getPublicTenderById);
router.post("/public/:id/apply", applyToTender);

/* ── ADMIN ───────────────────────────────────────────────── */
router.post("/analyze",     authMiddleware, adminOnly, analyzeTender);
router.get("/",             authMiddleware, adminOnly, getTenders);
router.get("/:id",          authMiddleware, adminOnly, getTenderById);
router.delete("/:id",       authMiddleware, adminOnly, deleteTender);
router.patch("/:id/status", authMiddleware, adminOnly, updateTenderStatus);

export default router;