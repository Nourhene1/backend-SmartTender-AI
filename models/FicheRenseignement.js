import { ObjectId } from "mongodb";
import { getDB } from "./db.js";

const COLLECTION_NAME = "fiches_renseignement";
const collection = () => getDB().collection(COLLECTION_NAME);

/* =========================
   HELPERS
========================= */
function toObjectId(id) {
  if (!ObjectId.isValid(id)) {
    throw new Error("Invalid ObjectId");
  }
  return new ObjectId(id);
}

function normalizeQuestion(q) {
  const base = {
    id:        q.id || new ObjectId().toString(),
    label:     String(q.label || "").trim(),
    type:      q.type || "text",
    required:  Boolean(q.required),
    timeLimit: Number(q.timeLimit || 0),
  };

  if (q.type === "text" || q.type === "textarea") {
    return { ...base, options: [] };
  }

  if (q.type === "radio" || q.type === "checkbox") {
    return {
      ...base,
      options: Array.isArray(q.options)
        ? q.options.map((o) => ({
            id:         o.id || new ObjectId().toString(),
            label:      String(o.label      || "").trim(),
            hasText:    Boolean(o.hasText),
            otherLabel: String(o.otherLabel || "").trim(), // ✅ AJOUT
            otherType:  String(o.otherType  || "text"),   // ✅ AJOUT
          }))
        : [],
    };
  }

  if (q.type === "scale_group") {
    return {
      ...base,
      scale: {
        min: Number(q.scale?.min ?? 0),
        max: Number(q.scale?.max ?? 4),
        labels: q.scale?.labels || {
          0: "Néant",
          1: "Débutant",
          2: "Intermédiaire",
          3: "Avancé",
          4: "Expert",
        },
      },
      items: Array.isArray(q.items)
        ? q.items
            .filter((i) => i.label && String(i.label).trim())
            .map((i) => ({ label: String(i.label).trim() }))
        : [],
      options: [],
    };
  }

  return { ...base, options: [] };
}

/* =========================
   CRUD
========================= */
export async function createFiche({ title, description, questions, createdBy }) {
  if (!title) throw new Error("Title is required");

  const doc = {
    title:       String(title).trim(),
    description: String(description || "").trim(),
    questions:   Array.isArray(questions) ? questions.map(normalizeQuestion) : [],
    createdBy:   createdBy ? toObjectId(createdBy) : null,
    createdAt:   new Date(),
  };

  const res = await collection().insertOne(doc);
  return { insertedId: res.insertedId, fiche: doc };
}

export async function findAllFiches() {
  return collection().find().sort({ createdAt: -1 }).toArray();
}

export async function findFicheById(id) {
  return collection().findOne({ _id: toObjectId(id) });
}

export async function deleteFicheById(id) {
  return collection().deleteOne({ _id: toObjectId(id) });
}

export async function updateFicheById(id, payload) {
  const res = await collection().findOneAndUpdate(
    { _id: toObjectId(id) },
    {
      $set: {
        title:       String(payload.title || "").trim(),
        description: String(payload.description || "").trim(),
        questions:   Array.isArray(payload.questions)
          ? payload.questions.map(normalizeQuestion)
          : [],
        updatedAt: new Date(),
      },
    },
    { returnDocument: "after" },
  );

  return res.value;
}