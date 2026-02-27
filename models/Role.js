import { ObjectId } from "mongodb";
import { getDB } from "./db.js";

const COLLECTION_NAME = "roles";
const collection = () => getDB().collection(COLLECTION_NAME);

/* =========================
   HELPERS
========================= */
function normalizeRoleName(name) {
  return String(name || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");
}

/* =========================
   CRUD
========================= */
export async function createRole({ name }) {
  const roleName = normalizeRoleName(name);

  if (!roleName) {
    throw new Error("Role name is required");
  }

  // unique check
  const exists = await collection().findOne({ name: roleName });
  if (exists) {
    return { insertedId: null, alreadyExists: true, role: exists };
  }

  const doc = {
    name: roleName,
    createdAt: new Date(),
  };

  const res = await collection().insertOne(doc);
  return { insertedId: res.insertedId, alreadyExists: false, role: doc };
}

export async function findAllRoles() {
  return collection().find().sort({ name: 1 }).toArray();
}

export async function findRoleById(id) {
  return collection().findOne({ _id: new ObjectId(id) });
}

export async function findRoleByName(name) {
  const roleName = normalizeRoleName(name);
  return collection().findOne({ name: roleName });
}

export async function deleteRole(id) {
  return collection().deleteOne({ _id: new ObjectId(id) });
}

export async function updateRoleById(id, name) {
  const roleName = normalizeRoleName(name);

  // check duplicate
  const exists = await collection().findOne({
    name: roleName,
    _id: { $ne: new ObjectId(id) },
  });

  if (exists) {
    return { duplicate: true };
  }

  const res = await collection().findOneAndUpdate(
    { _id: new ObjectId(id) },
    { $set: { name: roleName } },
    { returnDocument: "after" }
  );

  if (!res.value) return null;

  return { role: res.value };
}
