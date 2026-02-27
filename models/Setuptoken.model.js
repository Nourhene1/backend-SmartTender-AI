import { ObjectId } from "mongodb";
import { getDB } from "./db.js";
import crypto from "crypto";

const COLLECTION_NAME = "setup_tokens";

function collection() {
  return getDB().collection(COLLECTION_NAME);
}

/* =========================
   GENERATE SETUP TOKEN
========================= */
export function generateSetupToken() {
  return crypto.randomBytes(48).toString("hex"); // 96 char token
}

/* =========================
   SAVE SETUP TOKEN
========================= */
export async function saveSetupToken(userId, token) {
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48h

  // Supprimer les anciens tokens de cet utilisateur
  await collection().deleteMany({ userId: new ObjectId(userId) });

  return collection().insertOne({
    userId: new ObjectId(userId),
    token,
    expiresAt,
    used: false,
    createdAt: new Date(),
  });
}

/* =========================
   FIND VALID TOKEN
========================= */
export async function findValidSetupToken(token) {
  return collection().findOne({
    token,
    used: false,
    expiresAt: { $gt: new Date() },
  });
}

/* =========================
   MARK TOKEN AS USED
========================= */
export async function markTokenUsed(token) {
  return collection().updateOne(
    { token },
    { $set: { used: true, usedAt: new Date() } }
  );
}