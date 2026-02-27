import { findUserByEmail, updateUserPassword } from "../models/user.model.js";
import { createResetCode, findResetCode, markCodeAsUsed } from "../models/resetCode.model.js";
import { sendResetCodeEmail, generateResetCode } from "../services/mail.service.js";
import { hashPassword } from "../utils/password.js";



export async function forgotPassword(c) {
  try {
    const body = await c.req.json();
    const email = String(body.email || "").trim().toLowerCase();

    if (!email) {
      return c.json({ message: "Email obligatoire" }, 400);
    }

    // Vérifier si l'utilisateur existe
    const user = await findUserByEmail(email);
    if (!user) {
      return c.json({ 
        message: "Aucun compte n'est associé à cet email",
        exists: false
      }, 404);
    }

    const code = generateResetCode();
    
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await createResetCode({
      email,
      code,
      expiresAt,
    });

    await sendResetCodeEmail(email, code);

    return c.json({ 
      message: "Un code de réinitialisation a été envoyé à votre adresse email",
      email: email,
      exists: true
    }, 200);

  } catch (err) {
    console.error("FORGOT PASSWORD ERROR:", err);
    return c.json({ message: "Erreur serveur", error: err.message }, 500);
  }
}
/* =========================
   STEP 2: VERIFY CODE
   - User submits email + code
   - System verifies the code
========================= */
export async function verifyResetCode(c) {
  try {
    const body = await c.req.json();
    const email = String(body.email || "").trim().toLowerCase();
    const code = String(body.code || "").trim();

    if (!email || !code) {
      return c.json({ message: "Email et code obligatoires" }, 400);
    }

    // Vérifier le code
    const resetCode = await findResetCode(email, code);
    
    if (!resetCode) {
      return c.json({ message: "Code invalide ou expiré" }, 400);
    }

    return c.json({ 
      message: "Code vérifié avec succès",
      verified: true,
      email: email,
    }, 200);

  } catch (err) {
    console.error("VERIFY CODE ERROR:", err);
    return c.json({ message: "Erreur serveur", error: err.message }, 500);
  }
}

/* =========================
   STEP 3: RESET PASSWORD
   - User submits email + code + new password
   - System updates password
========================= */
export async function resetPassword(c) {
  try {
    const body = await c.req.json();
    const email = String(body.email || "").trim().toLowerCase();
    const code = String(body.code || "").trim();
    const newPassword = String(body.newPassword || "").trim();
    const confirmPassword = String(body.confirmPassword || "").trim();

    // Validations
    if (!email || !code || !newPassword) {
      return c.json({ message: "Email, code et nouveau mot de passe obligatoires" }, 400);
    }

    if (newPassword.length < 6) {
      return c.json({ message: "Le mot de passe doit contenir au moins 6 caractères" }, 400);
    }

    if (newPassword !== confirmPassword) {
      return c.json({ message: "Les mots de passe ne correspondent pas" }, 400);
    }

    // Vérifier le code une dernière fois
    const resetCode = await findResetCode(email, code);
    if (!resetCode) {
      return c.json({ message: "Code invalide ou expiré" }, 400);
    }

    // Hasher le nouveau mot de passe
    const hashedPassword = await hashPassword(newPassword);

    // Mettre à jour le mot de passe
    const user = await findUserByEmail(email);
    if (!user) {
      return c.json({ message: "Utilisateur introuvable" }, 404);
    }

    await updateUserPassword(user._id, hashedPassword);

    // Marquer le code comme utilisé
    await markCodeAsUsed(email, code);

    return c.json({ 
      message: "Mot de passe réinitialisé avec succès ✅",
      success: true,
    }, 200);

  } catch (err) {
    console.error("RESET PASSWORD ERROR:", err);
    return c.json({ message: "Erreur serveur", error: err.message }, 500);
  }
}

/* =========================
   RESEND CODE
   - User requests a new code
========================= */
export async function resendResetCode(c) {
  try {
    const body = await c.req.json();
    const email = String(body.email || "").trim().toLowerCase();

    if (!email) {
      return c.json({ message: "Email obligatoire" }, 400);
    }

    const user = await findUserByEmail(email);
    if (!user) {
      return c.json({ 
        message: "Si cet email existe, un nouveau code a été envoyé" 
      }, 200);
    }

    // Générer un nouveau code
    const code = generateResetCode();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await createResetCode({
      email,
      code,
      expiresAt,
    });

    await sendResetCodeEmail(email, code);

    return c.json({ 
      message: "Un nouveau code a été envoyé à votre adresse email",
    }, 200);

  } catch (err) {
    console.error("RESEND CODE ERROR:", err);
    return c.json({ message: "Erreur serveur", error: err.message }, 500);
  }
}