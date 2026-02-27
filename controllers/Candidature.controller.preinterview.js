// ================================================================
// 🆕 PRE-INTERVIEW — candidature.controller.preinterview.js
// ================================================================

import {
  togglePreInterview,
  getPreInterviewCandidatures,
} from "../models/Candidature.model.preinterview.js"; // ✅ Import manquant — c'était ça le bug !

/**
 * PATCH /candidatures/:id/pre-interview
 * Toggle la sélection pré-entretien d'une candidature
 */
export async function togglePreInterviewController(c) {
  try {
    const id = c.req.param("id");

    if (!id) {
      return c.json({ error: "ID candidature manquant" }, 400);
    }

    const result = await togglePreInterview(id);

    return c.json({
      success: true,
      ...result,
      // action: "selected" | "removed"
      // preInterviewStatus: "SELECTED" | "NONE"
    });
  } catch (err) {
    console.error("❌ togglePreInterview error:", err.message);

    if (err.message === "Candidature introuvable") {
      return c.json({ error: "Candidature introuvable" }, 404);
    }
    if (err.message === "ID invalide") {
      return c.json({ error: "ID invalide" }, 400);
    }

    return c.json({ error: "Erreur serveur" }, 500);
  }
}

/**
 * GET /candidatures/pre-interview
 * Retourne la liste des candidats pré-sélectionnés pour entretien
 * Réservé aux admins
 */
export async function getPreInterviewListController(c) {
  try {
    const list = await getPreInterviewCandidatures();

    return c.json(list);
  } catch (err) {
    console.error("❌ getPreInterviewList error:", err.message);
    return c.json({ error: "Erreur serveur" }, 500);
  }
}