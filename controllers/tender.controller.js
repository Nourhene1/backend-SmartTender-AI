// src/controllers/tender.controller.js
import { getDB } from "../models/db.js";
import { ObjectId } from "mongodb";
import FormData from "form-data";
import axios from "axios";

const ML_URL = process.env.ML_SERVICE_URL || "http://localhost:8000";

function getUserIdFromContext(c) {
  const u = c.get?.("user");
  const id = u?._id || u?.id || u?.userId;
  return id ? String(id) : "";
}

const col      = () => getDB().collection("tenders");
const applyCol = () => getDB().collection("tender_applications");

/* =========================================================
   PUBLIC — GET /tenders/public
   ✅ FIX: affiche tous les tenders non-archivés (pas juste DETECTED)
   Basé sur les données extraites du tender, pas son statut d'analyse
========================================================= */
export async function getPublicTenders(c) {
  try {
    const tenders = await col()
      .find({ status: { $ne: "ARCHIVED" } })   // ← FIX: tout sauf archivé
      .sort({ score_pertinence: -1, createdAt: -1 })
      .project({
        titre: 1,
        organisation: 1,
        deadline: 1,
        resume: 1,
        competences_requises: 1,
        keywords: 1,
        secteur: 1,
        type_marche: 1,
        score_pertinence: 1,
        status: 1,
        createdAt: 1,
      })
      .toArray();

    return c.json(tenders);
  } catch (err) {
    console.error("❌ getPublicTenders error:", err);
    return c.json({ message: "Erreur serveur", error: err.message }, 500);
  }
}

/* =========================================================
   PUBLIC — GET /tenders/public/:id
========================================================= */
export async function getPublicTenderById(c) {
  try {
    const { id } = c.req.param();
    if (!ObjectId.isValid(id)) return c.json({ message: "ID invalide" }, 400);

    const tender = await col().findOne(
      { _id: new ObjectId(id), status: { $ne: "ARCHIVED" } },
      {
        projection: {
          titre: 1, organisation: 1, deadline: 1, budget: 1,
          resume: 1, keywords: 1, requirements: 1,
          competences_requises: 1, secteur: 1, type_marche: 1,
          score_pertinence: 1, score_justification: 1, createdAt: 1,
        },
      }
    );

    if (!tender) return c.json({ message: "Tender non trouvé" }, 404);
    return c.json(tender);
  } catch (err) {
    console.error("❌ getPublicTenderById error:", err);
    return c.json({ message: "Erreur serveur", error: err.message }, 500);
  }
}

/* =========================================================
   PUBLIC — POST /tenders/public/:id/apply
   Candidat postule avec CV uploadé via le flow existant
========================================================= */
export async function applyToTender(c) {
  try {
    const { id } = c.req.param();
    if (!ObjectId.isValid(id)) return c.json({ message: "ID invalide" }, 400);

    const body = await c.req.json();
    const fullName  = String(body.fullName  || "").trim();
    const email     = String(body.email     || "").trim().toLowerCase();
    const phone     = String(body.phone     || "").trim();
    const cvUrl     = String(body.cvUrl     || "").trim();
    const motivation= String(body.motivation|| "").trim();

    if (!fullName || !email || !cvUrl) {
      return c.json({ message: "Champs requis: fullName, email, cvUrl" }, 400);
    }

    const tender = await col().findOne({
      _id: new ObjectId(id),
      status: { $ne: "ARCHIVED" },
    });
    if (!tender) return c.json({ message: "Tender non disponible" }, 404);

    // Anti-doublon
    const existing = await applyCol().findOne({ tenderId: new ObjectId(id), email });
    if (existing) return c.json({ message: "Vous avez déjà postulé à ce tender." }, 409);

    const r = await applyCol().insertOne({
      tenderId: new ObjectId(id),
      fullName, email, phone, cvUrl, motivation,
      status: "SUBMITTED",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return c.json({ message: "Candidature envoyée", applicationId: r.insertedId }, 201);
  } catch (err) {
    console.error("❌ applyToTender error:", err);
    return c.json({ message: "Erreur serveur", error: err.message }, 500);
  }
}

/* =========================================================
   ADMIN — POST /tenders/analyze
========================================================= */
export async function analyzeTender(c) {
  try {
    const userId = getUserIdFromContext(c);
    const formData = await c.req.formData();
    const file = formData.get("file");

    if (!file) return c.json({ message: "Fichier PDF requis" }, 400);
    if (!file.name?.toLowerCase().endsWith(".pdf"))
      return c.json({ message: "PDF uniquement" }, 400);

    const mlForm = new FormData();
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    mlForm.append("file", fileBuffer, { filename: file.name, contentType: "application/pdf" });

    const mlRes = await axios.post(`${ML_URL}/tender/analyze`, mlForm, {
      headers: mlForm.getHeaders(),
      timeout: 120_000,
    });

    const d = mlRes.data?.data || mlRes.data;

    const doc = {
      filename: file.name,
      titre: d.titre || "Appel d'offres",
      organisation: d.organisation || "",
      deadline: d.deadline || null,
      budget: d.budget || null,
      resume: d.resume || "",
      keywords: d.keywords || [],
      requirements: d.requirements || {},
      competences_requises: d.competences_requises || [],
      secteur: d.secteur || "",
      type_marche: d.type_marche || "services",
      score_pertinence: d.score_pertinence ?? 0,
      score_justification: d.score_justification || "",
      status: "DETECTED",
      createdBy: userId ? new ObjectId(userId) : null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await col().insertOne(doc);
    return c.json({ message: "Analysé avec succès", tenderId: result.insertedId, data: { ...doc, _id: result.insertedId } }, 201);
  } catch (err) {
    console.error("❌ analyzeTender error:", err);
    if (err.response) return c.json({ message: "Erreur ML", error: err.response.data }, err.response.status || 500);
    return c.json({ message: "Erreur serveur", error: err.message }, 500);
  }
}

/* =========================================================
   ADMIN — GET /tenders
========================================================= */
export async function getTenders(c) {
  try {
    const tenders = await col().find().sort({ createdAt: -1 }).toArray();
    return c.json(tenders);
  } catch (err) {
    return c.json({ message: "Erreur serveur", error: err.message }, 500);
  }
}

/* =========================================================
   ADMIN — GET /tenders/:id
========================================================= */
export async function getTenderById(c) {
  try {
    const { id } = c.req.param();
    if (!ObjectId.isValid(id)) return c.json({ message: "ID invalide" }, 400);
    const tender = await col().findOne({ _id: new ObjectId(id) });
    if (!tender) return c.json({ message: "Tender non trouvé" }, 404);
    return c.json(tender);
  } catch (err) {
    return c.json({ message: "Erreur serveur", error: err.message }, 500);
  }
}

/* =========================================================
   ADMIN — DELETE /tenders/:id
========================================================= */
export async function deleteTender(c) {
  try {
    const { id } = c.req.param();
    if (!ObjectId.isValid(id)) return c.json({ message: "ID invalide" }, 400);
    const existing = await col().findOne({ _id: new ObjectId(id) });
    if (!existing) return c.json({ message: "Tender non trouvé" }, 404);
    await col().deleteOne({ _id: new ObjectId(id) });
    return c.json({ message: "Tender supprimé", id });
  } catch (err) {
    return c.json({ message: "Erreur serveur", error: err.message }, 500);
  }
}

/* =========================================================
   ADMIN — PATCH /tenders/:id/status
========================================================= */
export async function updateTenderStatus(c) {
  try {
    const { id } = c.req.param();
    const { status } = await c.req.json();
    const VALID = ["DETECTED", "RESPONDED", "ARCHIVED"];
    if (!VALID.includes(status)) return c.json({ message: `Status invalide: ${VALID.join(", ")}` }, 400);
    if (!ObjectId.isValid(id)) return c.json({ message: "ID invalide" }, 400);
    await col().updateOne({ _id: new ObjectId(id) }, { $set: { status, updatedAt: new Date() } });
    return c.json({ message: "Statut mis à jour", id, status });
  } catch (err) {
    return c.json({ message: "Erreur serveur", error: err.message }, 500);
  }
}