import { ObjectId } from "mongodb";
import { getDB } from "./db.js";

const COLLECTION_NAME = "reset_codes";

function collection() {
  return getDB().collection(COLLECTION_NAME);
}

/* =========================
   CREATE RESET CODE
========================= */
export async function createResetCode({ email, code, expiresAt }) {
  // Supprimer les anciens codes pour cet email
  await collection().deleteMany({ email: email.toLowerCase() });

  return collection().insertOne({
    email: email.toLowerCase(),
    code,
    expiresAt,
    used: false,
    createdAt: new Date(),
  });
}

/* =========================
   FIND RESET CODE
========================= */
export async function findResetCode(email, code) {
  return collection().findOne({
    email: email.toLowerCase(),
    code,
    used: false,
    expiresAt: { $gt: new Date() }, // Code non expiré
  });
}

/* =========================
   MARK CODE AS USED
========================= */
export async function markCodeAsUsed(email, code) {
  return collection().updateOne(
    { email: email.toLowerCase(), code },
    { $set: { used: true } }
  );
}

/* =========================
   DELETE EXPIRED CODES
========================= */
export async function deleteExpiredCodes() {
  return collection().deleteMany({
    expiresAt: { $lt: new Date() },
  });
}

/* =========================
   CREATE INDEX FOR AUTO-EXPIRY
========================= */
export async function createResetCodeIndexes() {
  // Index TTL pour supprimer automatiquement après expiration
  await collection().createIndex(
    { expiresAt: 1 },
    { expireAfterSeconds: 0 }
  );
  
  // Index pour recherche rapide
  await collection().createIndex({ email: 1, code: 1 });
}