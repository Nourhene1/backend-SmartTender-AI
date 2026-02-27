import { ObjectId } from "mongodb";
import { getDB } from "../db.js";

const COLLECTION = "linkedin_tokens";
const col = () => getDB().collection(COLLECTION);

export async function upsertLinkedInToken({ userId, accessToken, expiresAt, scope }) {
  await col().updateOne(
    { userId: new ObjectId(userId) },
    {
      $set: {
        accessToken,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        scope: scope || null,
        updatedAt: new Date(),
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true }
  );
}

export async function getLinkedInToken(userId) {
  return col().findOne({ userId: new ObjectId(userId) });
}