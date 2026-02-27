import { ObjectId } from "mongodb";
import { getDB } from "./db.js";

const COLLECTION_NAME = "users";

function collection() {
  return getDB().collection(COLLECTION_NAME);
}

function normalizeRole(role) {
  return String(role || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");
}

/* =========================
   CREATE USER (ADMIN)
   ✅ password optionnel — envoi email d'activation
========================= */
export async function createUser(user) {
  const email = String(user.email || "").trim().toLowerCase();
  const role = normalizeRole(user.role);

  if (!email) throw new Error("Email est obligatoire");

  const exists = await collection().findOne({ email });
  if (exists) throw new Error("Email existe déjà");

  return collection().insertOne({
    nom: user.nom || "",
    prenom: user.prenom || "",
    email,
    // null = compte non activé (mot de passe non encore défini)
    password: user.password || null,
    role,
    passwordSet: !!user.password,   // false si invitation, true si mot de passe fourni
    createdAt: new Date(),
  });
}

/* =========================
   FIND USER BY EMAIL
========================= */
export async function findUserByEmail(email) {
  return collection().findOne({
    email: String(email || "").trim().toLowerCase(),
  });
}

/* =========================
   FIND USER BY ID
========================= */
export async function findUserById(id) {
  return collection().findOne({ _id: new ObjectId(id) });
}

/* =========================
   FIND ALL USERS (except ADMIN)
========================= */
export async function findAllUsers() {
  return collection()
    .find({ role: { $ne: "ADMIN" } })
    .project({ password: 0 })
    .toArray();
}

/* =========================
   UPDATE USER
========================= */
export async function updateUser(id, data) {
  const payload = {};

  if (data.email !== undefined) {
    const email = String(data.email).trim().toLowerCase();
    if (email) payload.email = email;
  }

  if (data.role !== undefined) {
    const role = String(data.role).trim().toUpperCase();
    if (role) payload.role = role;
  }

  if (data.nom !== undefined) {
    const nom = String(data.nom).trim();
    if (nom) payload.nom = nom;
  }

  if (data.prenom !== undefined) {
    const prenom = String(data.prenom).trim();
    if (prenom) payload.prenom = prenom;
  }

  payload.updatedAt = new Date();

  return collection().updateOne(
    { _id: new ObjectId(id) },
    { $set: payload }
  );
}

/* =========================
   UPDATE USER PASSWORD
   ✅ Utilisé lors de la réinitialisation ET de la première activation
========================= */
export async function updateUserPassword(id, hashedPassword) {
  return collection().updateOne(
    { _id: new ObjectId(id) },
    {
      $set: {
        password: hashedPassword,
        passwordSet: true,              // ✅ marque le compte comme activé
        passwordUpdatedAt: new Date(),
      },
    }
  );
}

/* =========================
   DELETE USER
========================= */
export async function deleteUser(id) {
  return collection().deleteOne({ _id: new ObjectId(id) });
}