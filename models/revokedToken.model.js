import { getDB } from "./db.js";

const COLLECTION_NAME = "revoked_tokens";
const collection = () => getDB().collection(COLLECTION_NAME);

export async function revokeToken({ token, expiresAt }) {
  return collection().insertOne({
    token,
    expiresAt,     // Date
    revokedAt: new Date(),
  });
}

export async function isTokenRevoked(token) {
  const found = await collection().findOne({ token });
  return !!found;
}
