// src/controllers/document.controller.js
import axios from "axios";
import { getDB } from "../models/db.js";
import { ObjectId } from "mongodb";

const ML_URL = process.env.ML_SERVICE_URL || "http://localhost:8000";

/* ─── helpers ─────────────────────────────────────────── */
function getUserIdFromContext(c) {
  const u = c.get?.("user");
  const id = u?._id || u?.id || u?.userId;
  return id ? String(id) : "";
}

const tenderCol    = () => getDB().collection("tenders");
const candidateCol = () => getDB().collection("tender_applications");

/* ─── helper: construire payload candidat ─────────────── */
function buildCandidatePayload(cand) {
  const parsed = cand.extracted?.parsed || cand.extracted || {};
  const pi     = parsed.personal_info || parsed || {};
  const tm     = cand.tenderMatch || {};

  const fullName =
    cand.fullName ||
    pi.full_name || pi.nom || pi.name ||
    `${cand.prenom || ""} ${cand.nom || ""}`.trim() ||
    "Candidat";

  const skillsObj = parsed.competences || parsed.skills || {};
  const allSkills = Array.isArray(skillsObj)
    ? skillsObj
    : Object.values(skillsObj).flat().filter(s => typeof s === "string");

  const experiences =
    parsed.experience_professionnelle ||
    parsed.experience ||
    parsed.work_experience ||
    [];

  return {
    fullName,
    email:       cand.email || pi.email || "",
    jobTitle:    pi.titre_poste || pi.profil || cand.jobTitle || "",
    matchScore:  cand.matchScore || Math.round((tm.score || 0) * 100) || 0,
    skills:      allSkills,
    softSkills:  [],
    experiences: Array.isArray(experiences) ? experiences.map(e => ({
      poste:      e.poste || e.position || e.title || "",
      entreprise: e.entreprise || e.company || "",
      duree:      e.duree || e.duration || "",
    })) : [],
    recommendation: tm.recommendation || "",
    summary:        tm.summary || "",
  };
}

/* ─── helper: construire payload tender ──────────────── */
function buildTenderPayload(tender) {
  return {
    titre:                tender.titre,
    organisation:         tender.organisation,
    deadline:             tender.deadline,
    budget:               tender.budget,
    resume:               tender.resume,
    keywords:             tender.keywords,
    requirements:         tender.requirements,
    competences_requises: tender.competences_requises,
  };
}

/* =========================================================
   POST /documents/generate-response
========================================================= */
export async function generateResponseDocument(c) {
  try {
    const body = await c.req.json();
    const { tenderId, candidateIds, companyInfo } = body;

    if (!tenderId || !ObjectId.isValid(tenderId))
      return c.json({ message: "tenderId invalide" }, 400);

    if (!Array.isArray(candidateIds) || candidateIds.length === 0)
      return c.json({ message: "candidateIds requis (tableau non vide)" }, 400);

    const tender = await tenderCol().findOne({ _id: new ObjectId(tenderId) });
    if (!tender) return c.json({ message: "Tender non trouvé" }, 404);

    const validIds   = candidateIds.filter(id => ObjectId.isValid(id)).map(id => new ObjectId(id));
    const candidates = await candidateCol().find({ _id: { $in: validIds } }).toArray();
    if (candidates.length === 0)
      return c.json({ message: "Aucun candidat trouvé avec ces IDs" }, 404);

    const mlPayload = {
      tender_data: buildTenderPayload(tender),
      candidates:  candidates.map(buildCandidatePayload),
      company_info: companyInfo || {
        name:      process.env.COMPANY_NAME  || "SmartTender ESN",
        expertise: ["Intelligence Artificielle", "Développement Web", "Cloud"],
        email:     process.env.COMPANY_EMAIL || "contact@smarttender.ai",
      },
    };

    const mlRes = await axios.post(
      `${ML_URL}/documents/generate-response`,
      mlPayload,
      { responseType: "arraybuffer", timeout: 120_000, headers: { "Content-Type": "application/json" } }
    );

    // ✅ Sauvegarder les IDs ET le tenderTitre pour l'historique
    await getDB().collection("generated_documents").insertOne({
      type:         "RESPONSE",
      tenderId:     new ObjectId(tenderId),
      tenderTitre:  tender.titre || "",
      candidateIds: validIds,
      generatedBy:  getUserIdFromContext(c) ? new ObjectId(getUserIdFromContext(c)) : null,
      createdAt:    new Date(),
    });

    const safeName = tender.titre.replace(/[^a-zA-Z0-9 _-]/g, "_").slice(0, 50);
    return new Response(mlRes.data, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="Reponse_${safeName}.docx"`,
      },
    });
  } catch (err) {
    console.error("❌ Generate response document error:", err);
    if (err.response)
      return c.json({ message: "Erreur ML service", error: err.response.data?.toString() }, err.response.status || 500);
    return c.json({ message: "Erreur serveur", error: err.message }, 500);
  }
}

/* =========================================================
   POST /documents/generate-profile
========================================================= */
export async function generateCandidateProfile(c) {
  try {
    const { candidateId, tenderId } = await c.req.json();

    if (!candidateId || !ObjectId.isValid(candidateId))
      return c.json({ message: "candidateId invalide" }, 400);

    const candidate = await candidateCol().findOne({ _id: new ObjectId(candidateId) });
    if (!candidate) return c.json({ message: "Candidat non trouvé" }, 404);

    let tenderData = {};
    let tenderTitre = "";
    if (tenderId && ObjectId.isValid(tenderId)) {
      const tender = await tenderCol().findOne({ _id: new ObjectId(tenderId) });
      if (tender) { tenderData = tender; tenderTitre = tender.titre || ""; }
    }

    const candPayload = buildCandidatePayload(candidate);

    const mlPayload = {
      candidate:   candPayload,
      tender_data: tenderData,
    };

    const mlRes = await axios.post(
      `${ML_URL}/documents/generate-profile`,
      mlPayload,
      { responseType: "arraybuffer", timeout: 60_000, headers: { "Content-Type": "application/json" } }
    );

    // ✅ Sauvegarder les IDs ET le tenderTitre pour l'historique
    await getDB().collection("generated_documents").insertOne({
      type:        "PROFILE",
      candidateId: new ObjectId(candidateId),
      tenderTitre,
      tenderId:    tenderId && ObjectId.isValid(tenderId) ? new ObjectId(tenderId) : null,
      generatedBy: getUserIdFromContext(c) ? new ObjectId(getUserIdFromContext(c)) : null,
      createdAt:   new Date(),
    });

    const name = candPayload.fullName.replace(/[^a-zA-Z0-9 _-]/g, "_").slice(0, 50);
    return new Response(mlRes.data, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="Profil_${name}.docx"`,
      },
    });
  } catch (err) {
    console.error("❌ Generate candidate profile error:", err);
    if (err.response)
      return c.json({ message: "Erreur ML service", error: err.response.data?.toString() }, err.response.status || 500);
    return c.json({ message: "Erreur serveur", error: err.message }, 500);
  }
}

/* =========================================================
   GET /documents/history
========================================================= */
export async function getDocumentHistory(c) {
  try {
    const docs = await getDB()
      .collection("generated_documents")
      .find()
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray();

    return c.json(docs);
  } catch (err) {
    console.error("❌ Get document history error:", err);
    return c.json({ message: "Erreur serveur", error: err.message }, 500);
  }
}

/* =========================================================
   ✅ GET /documents/:id/download
   → Relit les IDs depuis MongoDB et REGENERE via FastAPI
========================================================= */
export async function downloadDocumentController(c) {
  try {
    const id = c.req.param("id");
    if (!ObjectId.isValid(id)) return c.json({ message: "ID invalide" }, 400);

    const doc = await getDB()
      .collection("generated_documents")
      .findOne({ _id: new ObjectId(id) });

    if (!doc) return c.json({ message: "Document introuvable" }, 404);

    /* ── Cas 1 : RESPONSE ─────────────────────────────── */
    if (doc.type === "RESPONSE") {
      const tender = doc.tenderId
        ? await tenderCol().findOne({ _id: new ObjectId(doc.tenderId) })
        : null;

      if (!tender) return c.json({ message: "Tender introuvable pour ce document" }, 404);

      const validIds   = (doc.candidateIds || []).filter(id => ObjectId.isValid(id)).map(id => new ObjectId(id));
      const candidates = await candidateCol().find({ _id: { $in: validIds } }).toArray();

      if (candidates.length === 0)
        return c.json({ message: "Candidats introuvables pour ce document" }, 404);

      const mlPayload = {
        tender_data: buildTenderPayload(tender),
        candidates:  candidates.map(buildCandidatePayload),
        company_info: {
          name:      process.env.COMPANY_NAME  || "SmartTender ESN",
          expertise: ["Intelligence Artificielle", "Développement Web", "Cloud"],
          email:     process.env.COMPANY_EMAIL || "contact@smarttender.ai",
        },
      };

      const mlRes = await axios.post(
        `${ML_URL}/documents/generate-response`,
        mlPayload,
        { responseType: "arraybuffer", timeout: 120_000, headers: { "Content-Type": "application/json" } }
      );

      const safeName = tender.titre.replace(/[^a-zA-Z0-9 _-]/g, "_").slice(0, 50);
      return new Response(mlRes.data, {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "Content-Disposition": `attachment; filename="Reponse_${safeName}.docx"`,
        },
      });
    }

    /* ── Cas 2 : PROFILE ──────────────────────────────── */
    if (doc.type === "PROFILE") {
      const candidate = doc.candidateId
        ? await candidateCol().findOne({ _id: new ObjectId(doc.candidateId) })
        : null;

      if (!candidate) return c.json({ message: "Candidat introuvable pour ce document" }, 404);

      let tenderData = {};
      if (doc.tenderId && ObjectId.isValid(doc.tenderId.toString())) {
        const tender = await tenderCol().findOne({ _id: new ObjectId(doc.tenderId) });
        if (tender) tenderData = tender;
      }

      const candPayload = buildCandidatePayload(candidate);

      const mlRes = await axios.post(
        `${ML_URL}/documents/generate-profile`,
        { candidate: candPayload, tender_data: tenderData },
        { responseType: "arraybuffer", timeout: 60_000, headers: { "Content-Type": "application/json" } }
      );

      const name = candPayload.fullName.replace(/[^a-zA-Z0-9 _-]/g, "_").slice(0, 50);
      return new Response(mlRes.data, {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "Content-Disposition": `attachment; filename="Profil_${name}.docx"`,
        },
      });
    }

    return c.json({ message: "Type de document inconnu" }, 400);

  } catch (err) {
    console.error("❌ downloadDocument error:", err);
    if (err.response)
      return c.json({ message: "Erreur ML service", error: err.response.data?.toString() }, err.response.status || 500);
    return c.json({ message: "Erreur serveur", error: err.message }, 500);
  }
}