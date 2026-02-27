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
const candidateCol = () => getDB().collection("tender_applications"); // ✅ FIX: vraie collection

/* =========================================================
   POST /documents/generate-response
   Body: { tenderId, candidateIds: [], companyInfo?: {} }
   → appelle FastAPI → renvoie le .docx au client
========================================================= */
export async function generateResponseDocument(c) {
  try {
    const body = await c.req.json();
    const { tenderId, candidateIds, companyInfo } = body;

    // ── Validation ────────────────────────────────────────
    if (!tenderId || !ObjectId.isValid(tenderId)) {
      return c.json({ message: "tenderId invalide" }, 400);
    }

    if (!Array.isArray(candidateIds) || candidateIds.length === 0) {
      return c.json({ message: "candidateIds requis (tableau non vide)" }, 400);
    }

    // ── Récupérer le tender ───────────────────────────────
    const tender = await tenderCol().findOne({ _id: new ObjectId(tenderId) });
    if (!tender) {
      return c.json({ message: "Tender non trouvé" }, 404);
    }

    // ── Récupérer les candidats ───────────────────────────
    const validIds = candidateIds
      .filter((id) => ObjectId.isValid(id))
      .map((id) => new ObjectId(id));

    const candidates = await candidateCol()
      .find({ _id: { $in: validIds } })
      .toArray();

    if (candidates.length === 0) {
      return c.json({ message: "Aucun candidat trouvé avec ces IDs" }, 404);
    }

    // ── Appeler FastAPI pour générer le docx ──────────────
    const mlPayload = {
      tender_data: {
        titre: tender.titre,
        organisation: tender.organisation,
        deadline: tender.deadline,
        budget: tender.budget,
        resume: tender.resume,
        keywords: tender.keywords,
        requirements: tender.requirements,
        competences_requises: tender.competences_requises,
      },
      candidates: candidates.map((cand) => {
        // ✅ FIX: extraire les données depuis le schéma réel de tender_applications
        const parsed = cand.extracted?.parsed || cand.extracted || {};
        const pi     = parsed.personal_info || parsed || {};
        const tm     = cand.tenderMatch || {};

        const fullName =
          cand.fullName ||
          pi.full_name || pi.nom || pi.name ||
          `${cand.prenom || ""} ${cand.nom || ""}`.trim() ||
          "Candidat";

        // Compétences depuis extracted.parsed
        const skillsObj = parsed.competences || parsed.skills || {};
        const allSkills = Array.isArray(skillsObj)
          ? skillsObj
          : Object.values(skillsObj).flat().filter(s => typeof s === "string");

        // Expériences
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
      }),
      company_info: companyInfo || {
        name: process.env.COMPANY_NAME || "SmartTender ESN",
        expertise: ["Intelligence Artificielle", "Développement Web", "Cloud"],
        email: process.env.COMPANY_EMAIL || "contact@smarttender.ai",
      },
    };

    const mlRes = await axios.post(
      `${ML_URL}/documents/generate-response`,
      mlPayload,
      {
        responseType: "arraybuffer",
        timeout: 120_000,
        headers: { "Content-Type": "application/json" },
      }
    );

    // ── Sauvegarder l'historique en MongoDB ───────────────
    await getDB().collection("generated_documents").insertOne({
      type: "RESPONSE",
      tenderId: new ObjectId(tenderId),
      candidateIds: validIds,
      generatedBy: getUserIdFromContext(c)
        ? new ObjectId(getUserIdFromContext(c))
        : null,
      createdAt: new Date(),
    });

    // ── Renvoyer le fichier au client ─────────────────────
    const safeName = tender.titre
      .replace(/[^a-zA-Z0-9 _-]/g, "_")
      .slice(0, 50);

    return new Response(mlRes.data, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="Reponse_${safeName}.docx"`,
      },
    });
  } catch (err) {
    console.error("❌ Generate response document error:", err);

    if (err.response) {
      return c.json(
        { message: "Erreur ML service", error: err.response.data?.toString() },
        err.response.status || 500
      );
    }

    return c.json({ message: "Erreur serveur", error: err.message }, 500);
  }
}

/* =========================================================
   POST /documents/generate-profile
   Body: { candidateId, tenderId? }
   → appelle FastAPI → renvoie le .docx
========================================================= */
export async function generateCandidateProfile(c) {
  try {
    const { candidateId, tenderId } = await c.req.json();

    if (!candidateId || !ObjectId.isValid(candidateId)) {
      return c.json({ message: "candidateId invalide" }, 400);
    }

    const candidate = await candidateCol().findOne({
      _id: new ObjectId(candidateId),
    });
    if (!candidate) {
      return c.json({ message: "Candidat non trouvé" }, 404);
    }

    let tenderData = {};
    if (tenderId && ObjectId.isValid(tenderId)) {
      const tender = await tenderCol().findOne({ _id: new ObjectId(tenderId) });
      if (tender) tenderData = tender;
    }

    // ✅ FIX: extraire depuis le schéma réel de tender_applications
    const parsed = candidate.extracted?.parsed || candidate.extracted || {};
    const pi     = parsed.personal_info || parsed || {};
    const tm     = candidate.tenderMatch || {};

    const fullName =
      candidate.fullName ||
      pi.full_name || pi.nom || pi.name ||
      `${candidate.prenom || ""} ${candidate.nom || ""}`.trim() ||
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

    const mlPayload = {
      candidate: {
        fullName,
        email:       candidate.email || pi.email || "",
        jobTitle:    pi.titre_poste || pi.profil || "",
        matchScore:  candidate.matchScore || Math.round((tm.score || 0) * 100) || 0,
        skills:      allSkills,
        softSkills:  [],
        experiences: Array.isArray(experiences) ? experiences.map(e => ({
          poste:      e.poste || e.position || e.title || "",
          entreprise: e.entreprise || e.company || "",
          duree:      e.duree || e.duration || "",
        })) : [],
        recommendation: tm.recommendation || "",
        summary:        tm.summary || "",
      },
      tender_data: tenderData,
    };

    const mlRes = await axios.post(
      `${ML_URL}/documents/generate-profile`,
      mlPayload,
      {
        responseType: "arraybuffer",
        timeout: 60_000,
        headers: { "Content-Type": "application/json" },
      }
    );

    // Historique
    await getDB().collection("generated_documents").insertOne({
      type: "PROFILE",
      candidateId: new ObjectId(candidateId),
      tenderId: tenderId && ObjectId.isValid(tenderId) ? new ObjectId(tenderId) : null,
      generatedBy: getUserIdFromContext(c)
        ? new ObjectId(getUserIdFromContext(c))
        : null,
      createdAt: new Date(),
    });

    const name = fullName.replace(/[^a-zA-Z0-9 _-]/g, "_").slice(0, 50);

    return new Response(mlRes.data, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="Profil_${name}.docx"`,
      },
    });
  } catch (err) {
    console.error("❌ Generate candidate profile error:", err);

    if (err.response) {
      return c.json(
        { message: "Erreur ML service", error: err.response.data?.toString() },
        err.response.status || 500
      );
    }

    return c.json({ message: "Erreur serveur", error: err.message }, 500);
  }
}

/* =========================================================
   GET /documents/history
   Historique des documents générés
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