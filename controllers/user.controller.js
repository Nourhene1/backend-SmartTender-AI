import {
  createUser,
  findUserByEmail,
  findAllUsers,
  updateUser,
  deleteUser,
  findUserById,
  updateUserPassword,
} from "../models/user.model.js";

import { hashPassword, comparePassword } from "../utils/password.js";
import { generateToken } from "../utils/jwt.js";
import { sendSetPasswordEmail } from "../services/mail.service.js";
import {
  generateSetupToken,
  saveSetupToken,
  findValidSetupToken,
  markTokenUsed,
} from "../models/Setuptoken.model.js";

import jwt from "jsonwebtoken";
import { revokeToken } from "../models/revokedToken.model.js";

/* =========================
   REGISTER (auto-inscription publique)
   Conserve le mot de passe obligatoire pour l'auto-inscription
========================= */
export async function register(c) {
  try {
    const body = await c.req.json();

    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "").trim();

    if (!email || !password) {
      return c.json({ message: "Email et mot de passe obligatoires" }, 400);
    }

    const exists = await findUserByEmail(email);
    if (exists) {
      return c.json({ message: "Email déjà utilisé" }, 409);
    }

    const hashedPassword = await hashPassword(password);
    const role = String(body.role || "RECRUITER").trim().toUpperCase();

    await createUser({
      nom: body.nom || "",
      prenom: body.prenom || "",
      email,
      password: hashedPassword,
      role,
    });

    return c.json({ message: "Utilisateur ajouté ✅" }, 201);
  } catch (err) {
    console.error("REGISTER ERROR:", err);
    return c.json({ message: "Erreur serveur", error: err.message }, 500);
  }
}

/* =========================
   ✅ CREATE USER BY ADMIN (sans mot de passe)
   Génère un token et envoie un email d'invitation
========================= */
export async function createUserByAdmin(c) {
  try {
    const body = await c.req.json();

    const email = String(body.email || "").trim().toLowerCase();
    const role = String(body.role || "RESPONSABLE_METIER").trim().toUpperCase();
    const nom = String(body.nom || "").trim();
    const prenom = String(body.prenom || "").trim();

    if (!email) {
      return c.json({ message: "Email obligatoire" }, 400);
    }

    // Vérifier si email déjà utilisé
    const exists = await findUserByEmail(email);
    if (exists) {
      return c.json({ message: "Email déjà utilisé" }, 409);
    }

    // Créer l'utilisateur SANS mot de passe
    const result = await createUser({ nom, prenom, email, role });
    const userId = result.insertedId;

    // Générer et sauvegarder le token d'activation
    const token = generateSetupToken();
    await saveSetupToken(userId, token);

    // Construire le lien
    const frontUrl = process.env.FRONT_URL ;
    const link = `${frontUrl}/set-password?token=${token}`;

    // Envoyer l'email
    await sendSetPasswordEmail(email, { nom, prenom, link });

    return c.json(
      { message: "Utilisateur créé ✅ — Email d'activation envoyé." },
      201
    );
  } catch (err) {
    console.error("CREATE USER BY ADMIN ERROR:", err);
    return c.json({ message: "Erreur serveur", error: err.message }, 500);
  }
}

/* =========================
   ✅ SETUP PASSWORD (via lien email)
   Accessible sans authentification (token dans le body)
========================= */
export async function setupPassword(c) {
  try {
    const body = await c.req.json();
    const { token, password } = body;

    if (!token || !password) {
      return c.json({ message: "Token et mot de passe obligatoires" }, 400);
    }

    const trimmedPassword = String(password).trim();
    if (trimmedPassword.length < 8) {
      return c.json({ message: "Le mot de passe doit contenir au moins 8 caractères" }, 400);
    }

    // Vérifier le token
    const setupToken = await findValidSetupToken(token);
    if (!setupToken) {
      return c.json(
        { message: "Lien invalide ou expiré. Contactez votre administrateur." },
        400
      );
    }

    // Hasher et mettre à jour le mot de passe
    const hashedPassword = await hashPassword(trimmedPassword);
    await updateUserPassword(setupToken.userId.toString(), hashedPassword);

    // Invalider le token
    await markTokenUsed(token);

    return c.json({ message: "Mot de passe défini avec succès ✅ Vous pouvez maintenant vous connecter." });
  } catch (err) {
    console.error("SETUP PASSWORD ERROR:", err);
    return c.json({ message: "Erreur serveur", error: err.message }, 500);
  }
}



/* =========================
   LOGIN
========================= */
export async function login(c) {
  try {
    const body = await c.req.json();

    const email = String(body?.email || "").trim().toLowerCase();
    const password = String(body?.password || "").trim();

    if (!email || !password) {
      return c.json({ message: "Email et mot de passe requis" }, 400);
    }

    const user = await findUserByEmail(email);
    if (!user) {
      return c.json({ message: "Email ou mot de passe incorrect" }, 401);
    }

    // ✅ Bloquer si le compte n'est pas encore activé
    if (!user.password || !user.passwordSet) {
      return c.json(
        { message: "Compte non activé. Veuillez consulter votre email pour définir votre mot de passe." },
        403
      );
    }

    const isMatch = await comparePassword(password, user.password) ;
    if (!isMatch) {
      return c.json({ message: "Email ou mot de passe incorrect" }, 401);
    }

    const role = String(user.role || "").trim().toUpperCase();

    const token = generateToken({
      id: user._id,
      email: user.email,
      role,
    });

    return c.json({
      message: "Login réussi ✅",
      token,
      user: {
        id: user._id,
        nom: user.nom || "",
        prenom: user.prenom || "",
        email: user.email,
        role,
      },
    });
  } catch (err) {
    console.error("LOGIN ERROR:", err);
    return c.json({ message: "Erreur serveur", error: err.message }, 500);
  }
}

/* =========================
   GET USERS
========================= */
export async function getUsers(c) {
  try {
    const users = await findAllUsers();
    return c.json({ users, count: users.length });
  } catch (err) {
    console.error("GET USERS ERROR:", err);
    return c.json({ message: "Erreur serveur", error: err.message }, 500);
  }
}

/* =========================
   LOGOUT
========================= */
export async function logout(c) {
  try {
    const authHeader = c.req.header("Authorization") || c.req.header("authorization");
    let token = null;

    if (authHeader?.startsWith("Bearer ")) {
      token = authHeader.split(" ")[1];
    }

    if (!token) {
      token = c.req.cookie("token");
    }

    if (!token) {
      return c.json({ message: "Déconnexion OK (aucun token fourni)" }, 200);
    }

    const decoded = jwt.decode(token);
    const expMs = decoded?.exp
      ? decoded.exp * 1000
      : Date.now() + 24 * 60 * 60 * 1000;

    await revokeToken({ token, expiresAt: new Date(expMs) });

    c.header("Set-Cookie", "token=; Path=/; Max-Age=0; SameSite=Lax");
    c.header("Set-Cookie", "role=; Path=/; Max-Age=0; SameSite=Lax");

    return c.json({ message: "Déconnexion réussie ✅ (token révoqué)" }, 200);
  } catch (err) {
    console.error("LOGOUT ERROR:", err);
    return c.json({ message: "Erreur serveur", error: err.message }, 500);
  }
}

/* =========================
   UPDATE USER
========================= */
export async function updateUserController(c) {
  try {
    const id = c.req.param("id");
    const body = await c.req.json();

    const email = body.email ? String(body.email).trim().toLowerCase() : null;
    const role = body.role ? String(body.role).trim().toUpperCase() : null;

    if (!email && !role && !body.nom && !body.prenom) {
      return c.json({ message: "Aucune donnée à modifier" }, 400);
    }

    const existingUser = await findUserById(id);
    if (!existingUser) {
      return c.json({ message: "Utilisateur introuvable" }, 404);
    }

    if (email && email !== existingUser.email) {
      const emailUsed = await findUserByEmail(email);
      if (emailUsed) {
        return c.json({ message: "Email déjà utilisé" }, 409);
      }
    }

    await updateUser(id, {
      email: email ?? undefined,
      role: role ?? undefined,
      nom: body.nom ?? undefined,
      prenom: body.prenom ?? undefined,
    });

    return c.json({ message: "Utilisateur modifié ✅" });
  } catch (err) {
    console.error("UPDATE USER ERROR:", err);
    return c.json({ message: "Erreur serveur", error: err.message }, 500);
  }
}

/* =========================
   DELETE USER
========================= */
export async function removeUser(c) {
  try {
    const id = c.req.param("id");

    const user = await findUserById(id);
    if (!user) {
      return c.json({ message: "Utilisateur introuvable" }, 404);
    }

    await deleteUser(id);

    return c.json({ message: "Utilisateur supprimé ✅", id });
  } catch (err) {
    console.error("REMOVE USER ERROR:", err);
    return c.json({ message: "Erreur serveur", error: err.message }, 500);
  }
}