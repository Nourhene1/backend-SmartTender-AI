import nodemailer from "nodemailer";

/* =========================
   CONFIGURATION TRANSPORTER (unique)
========================= */
const transporter = nodemailer.createTransport({
  host: process.env.MAIL_HOST || "smtp.gmail.com",
  port: parseInt(process.env.MAIL_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS,
  },
});

/* =========================
   GENERATE 6-DIGIT CODE
========================= */
export function generateResetCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/* =========================
   SEND RESET CODE EMAIL
========================= */
export async function sendResetCodeEmail(to, code) {
  const mailOptions = {
    from: `"Optylab RH" <${process.env.MAIL_USER}>`,
    to,
    subject: "Code de réinitialisation de mot de passe - Optylab",
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f4f4;">
        <table role="presentation" style="width: 100%; border-collapse: collapse;">
          <tr>
            <td align="center" style="padding: 40px 0;">
              <table role="presentation" style="width: 600px; border-collapse: collapse; background-color: #ffffff; border-radius: 10px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
                
                <!-- Header -->
                <tr>
                  <td style="background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
                    <h1 style="color: #ffffff; margin: 0; font-size: 28px;">Optylab</h1>
                    <p style="color: #e8f5e9; margin: 10px 0 0 0; font-size: 14px;">Plateforme RH Intelligente</p>
                  </td>
                </tr>
                
                <!-- Content -->
                <tr>
                  <td style="padding: 40px 30px;">
                    <h2 style="color: #333333; margin: 0 0 20px 0; font-size: 22px;">Réinitialisation de mot de passe</h2>
                    
                    <p style="color: #666666; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                      Bonjour,
                    </p>
                    
                    <p style="color: #666666; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                      Vous avez demandé la réinitialisation de votre mot de passe. Voici votre code de vérification :
                    </p>
                    
                    <!-- Code Box -->
                    <div style="background-color: #f8f9fa; border: 2px dashed #4CAF50; border-radius: 10px; padding: 25px; text-align: center; margin: 30px 0;">
                      <p style="color: #888888; font-size: 12px; margin: 0 0 10px 0; text-transform: uppercase; letter-spacing: 1px;">Votre code de vérification</p>
                      <p style="color: #4CAF50; font-size: 36px; font-weight: bold; margin: 0; letter-spacing: 8px; font-family: 'Courier New', monospace;">${code}</p>
                    </div>
                    
                    <p style="color: #666666; font-size: 16px; line-height: 1.6; margin: 0 0 10px 0;">
                      ⏱️ <strong>Ce code expire dans 15 minutes.</strong>
                    </p>
                    
                    <p style="color: #999999; font-size: 14px; line-height: 1.6; margin: 20px 0 0 0;">
                      Si vous n'avez pas demandé cette réinitialisation, ignorez simplement cet email. Votre mot de passe restera inchangé.
                    </p>
                  </td>
                </tr>
                
                <!-- Footer -->
                <tr>
                  <td style="background-color: #f8f9fa; padding: 20px 30px; text-align: center; border-radius: 0 0 10px 10px; border-top: 1px solid #eeeeee;">
                    <p style="color: #999999; font-size: 12px; margin: 0;">
                      © ${new Date().getFullYear()} Optylab - Tous droits réservés
                    </p>
                    <p style="color: #bbbbbb; font-size: 11px; margin: 10px 0 0 0;">
                      Cet email a été envoyé automatiquement, merci de ne pas y répondre.
                    </p>
                  </td>
                </tr>
                
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `,
    text: `
      Optylab - Réinitialisation de mot de passe
      
      Bonjour,
      
      Vous avez demandé la réinitialisation de votre mot de passe.
      
      Votre code de vérification : ${code}
      
      Ce code expire dans 15 minutes.
      
      Si vous n'avez pas demandé cette réinitialisation, ignorez cet email.
      
      © ${new Date().getFullYear()} Optylab
    `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log("📧 Email envoyé:", info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error("❌ Erreur envoi email:", error);
    throw error;
  }
}

/* =========================
   SEND NEW JOB NOTIFICATION TO ADMIN
   ✅ Notifie l'admin qu'une nouvelle offre a été créée par un utilisateur
========================= */
export async function sendNewJobNotificationEmail(
  to,
  { jobId, jobTitle, creatorName, creatorEmail }
) {
  const frontUrl = process.env.FRONT_URL;
  const jobLink = `${frontUrl}/recruiter/jobs/${jobId}`;

  const mailOptions = {
    from: `"Optylab RH" <${process.env.MAIL_USER}>`,
    to,
    subject: `Nouvelle offre d'emploi à confirmer - ${jobTitle}`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f4f4;">
        <table role="presentation" style="width: 100%; border-collapse: collapse;">
          <tr>
            <td align="center" style="padding: 40px 0;">
              <table role="presentation" style="width: 600px; border-collapse: collapse; background-color: #ffffff; border-radius: 10px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">

                <!-- Header (vert) -->
                <tr>
                  <td style="background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
                    <h1 style="color: #ffffff; margin: 0; font-size: 28px;">Optylab</h1>
                    <p style="color: #e8f5e9; margin: 10px 0 0 0; font-size: 14px;">Plateforme RH Intelligente</p>
                  </td>
                </tr>

                <!-- Content -->
                <tr>
                  <td style="padding: 40px 30px;">
                    <h2 style="color: #333333; margin: 0 0 20px 0; font-size: 22px;">
                      Nouvelle offre d'emploi à confirmer
                    </h2>

                    <p style="color: #666666; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                      Bonjour Admin,
                    </p>

                    <p style="color: #666666; font-size: 16px; line-height: 1.6; margin: 0 0 18px 0;">
                      Une nouvelle offre d'emploi a été créée et nécessite votre confirmation.
                    </p>

                    <!-- Infos (texte simple, sans card/border couleur) -->
                    <p style="color:#888888; font-size: 13px; margin: 18px 0 4px 0;">Titre de l'offre :</p>
                    <p style="color:#333333; font-size: 16px; font-weight: 600; margin: 0 0 12px 0;">${jobTitle}</p>

                    <p style="color:#888888; font-size: 13px; margin: 12px 0 4px 0;">Créée par :</p>
                    <p style="color:#333333; font-size: 15px; margin: 0 0 10px 0;">${creatorName}</p>

                    <p style="color:#888888; font-size: 13px; margin: 12px 0 4px 0;">Email :</p>
                    <p style="color:#333333; font-size: 15px; margin: 0 0 18px 0;">${creatorEmail}</p>

                    <!-- CTA Button (vert) -->
                    <div style="text-align: center; margin: 30px 0;">
                      <a href="${jobLink}" style="display: inline-block; background: linear-gradient(135deg, #4CAF50 0%, #388E3C 100%); color: #ffffff; text-decoration: none; padding: 14px 40px; border-radius: 8px; font-size: 16px; font-weight: bold;">
                        Voir l'offre
                      </a>
                    </div>

                    <p style="color: #999999; font-size: 13px; line-height: 1.6; margin: 20px 0 0 0; text-align: center;">
                      Ou copiez ce lien : <a href="${jobLink}" style="color: #4CAF50;">${jobLink}</a>
                    </p>
                  </td>
                </tr>

                <!-- Footer (inchangé) -->
                <tr>
                  <td style="background-color: #f8f9fa; padding: 20px 30px; text-align: center; border-radius: 0 0 10px 10px; border-top: 1px solid #eeeeee;">
                    <p style="color: #999999; font-size: 12px; margin: 0;">
                      © ${new Date().getFullYear()} Optylab - Tous droits réservés
                    </p>
                    <p style="color: #bbbbbb; font-size: 11px; margin: 10px 0 0 0;">
                      Cet email a été envoyé automatiquement, merci de ne pas y répondre.
                    </p>
                  </td>
                </tr>

              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `,
    text: `
Optylab - Nouvelle offre d'emploi à confirmer

Bonjour Admin,

Une nouvelle offre d'emploi a été créée et nécessite votre confirmation.

Titre : ${jobTitle}
Créée par : ${creatorName}
Email : ${creatorEmail}

Voir l'offre : ${jobLink}

© ${new Date().getFullYear()} Optylab
    `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log("Notification admin envoyée:", info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error("Erreur envoi notification admin:", error);
    throw error;
  }
}

/* =========================
   SEND JOB CONFIRMED EMAIL TO OWNER
   ✅ Notifie le créateur que son offre a été confirmée
========================= */
export async function sendJobConfirmedEmail(to, { jobId, jobTitle, ownerName }) {
  const frontUrl = process.env.FRONT_URL;
  const loginLink = `${frontUrl}/login`;

  const mailOptions = {
    from: `"Optylab RH" <${process.env.MAIL_USER}>`,
    to,
    subject: `Votre offre "${jobTitle}" a été confirmée - Optylab`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f4f4;">
        <table role="presentation" style="width: 100%; border-collapse: collapse;">
          <tr>
            <td align="center" style="padding: 40px 0;">
              <table role="presentation" style="width: 600px; border-collapse: collapse; background-color: #ffffff; border-radius: 10px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
                
                <!-- Header -->
                <tr>
                 <td style="background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
                    <h1 style="color: #ffffff; margin: 0; font-size: 28px;">Optylab</h1>
                    <p style="color: #e8f5e9; margin: 10px 0 0 0; font-size: 14px;">Plateforme RH Intelligente</p>
                  </td>
                </tr>
                
                <!-- Content -->
                <tr>
                  <td style="padding: 40px 30px;">
              
                    <h2 style="color: #333333; margin: 0 0 20px 0; font-size: 22px; text-align: center;">Offre confirmée !</h2>
                    
                    <p style="color: #666666; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                      Bonjour ${ownerName},
                    </p>
                    
                    <p style="color: #666666; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                      Bonne nouvelle ! Votre offre d'emploi a été <strong style="color: #4CAF50;">confirmée</strong> par l'administrateur et est maintenant visible publiquement.
                    </p>
                    
                  <p style="color:#888888; font-size:13px; margin:20px 0 4px 0;">
  Titre de l'offre :
</p>
<p style="color:#333333; font-size:16px; font-weight:600; margin:0 0 20px 0;">
  ${jobTitle}
</p>
                    
                    <!-- CTA Button -->
                    <div style="text-align: center; margin: 30px 0;">
                      <a href="${loginLink}" style="display: inline-block; background: linear-gradient(135deg, #4CAF50 0%, #388E3C 100%); color: #ffffff; text-decoration: none; padding: 14px 40px; border-radius: 8px; font-size: 16px; font-weight: bold;">
                        Voir mon offre
                      </a>
                    </div>
                    
                    <p style="color: #999999; font-size: 13px; line-height: 1.6; margin: 20px 0 0 0; text-align: center;">
                      Ou copiez ce lien : <a href="${loginLink}" style="color: #4CAF50;">${loginLink}</a>
                    </p>
                  </td>
                </tr>
                
                <!-- Footer -->
                <tr>
                  <td style="background-color: #f8f9fa; padding: 20px 30px; text-align: center; border-radius: 0 0 10px 10px; border-top: 1px solid #eeeeee;">
                    <p style="color: #999999; font-size: 12px; margin: 0;">
                      © ${new Date().getFullYear()} Optylab - Tous droits réservés
                    </p>
                    <p style="color: #bbbbbb; font-size: 11px; margin: 10px 0 0 0;">
                      Cet email a été envoyé automatiquement, merci de ne pas y répondre.
                    </p>
                  </td>
                </tr>
                
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `,
    text: `
      Optylab - Offre confirmée

      Bonjour ${ownerName},

      Bonne nouvelle ! Votre offre d'emploi "${jobTitle}" a été confirmée par l'administrateur et est maintenant visible publiquement.

      Voir votre offre : ${loginLink}

      © ${new Date().getFullYear()} Optylab
    `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log("📧 Email confirmation offre envoyé:", info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error("❌ Erreur envoi email confirmation offre:", error);
    throw error;
  }
}

/* =========================
   SEND JOB REJECTED EMAIL TO OWNER
   ✅ Notifie le créateur que son offre a été rejetée
========================= */
export async function sendJobRejectedEmail(to, { jobId, jobTitle, ownerName, reason }) {
  const frontUrl = process.env.FRONT_URL;
  const loginLink = `${frontUrl}/login`;

  const reasonHtml = reason
    ? `
      <p style="color:#888888; font-size:13px; margin:16px 0 4px 0;">Raison du rejet :</p>
      <p style="color:#333333; font-size:15px; margin:0 0 12px 0;">${reason}</p>
    `
    : "";

  const reasonText = reason ? `\nRaison : ${reason}\n` : "\n";

  const mailOptions = {
    from: `"Optylab RH" <${process.env.MAIL_USER}>`,
    to,
    subject: `Votre offre "${jobTitle}" a été rejetée - Optylab`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f4f4;">
        <table role="presentation" style="width: 100%; border-collapse: collapse;">
          <tr>
            <td align="center" style="padding: 40px 0;">
              <table role="presentation" style="width: 600px; border-collapse: collapse; background-color: #ffffff; border-radius: 10px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
                
                <!-- Header (vert) -->
                <tr>
                 <td style="background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
                    <h1 style="color: #ffffff; margin: 0; font-size: 28px;">Optylab</h1>
                    <p style="color: #e8f5e9; margin: 10px 0 0 0; font-size: 14px;">Plateforme RH Intelligente</p>
                  </td>
                </tr>
                
                <!-- Content -->
                <tr>
                  <td style="padding: 40px 30px;">
                    
                    <h2 style="color: #333333; margin: 0 0 20px 0; font-size: 22px; text-align: center;">
                      Offre rejetée
                    </h2>
                    
                    <p style="color: #666666; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                      Bonjour,
                    </p>
                    
                    <p style="color: #666666; font-size: 16px; line-height: 1.6; margin: 0 0 16px 0;">
                      Nous vous informons que votre offre d'emploi a été <strong>rejetée</strong> par l'administrateur.
                    </p>

                    <!-- Job title (simple text, no card) -->
                    <p style="color:#888888; font-size:13px; margin:20px 0 4px 0;">Titre de l'offre :</p>
                    <p style="color:#333333; font-size:16px; font-weight:600; margin:0 0 12px 0;">${jobTitle}</p>

                    ${reasonHtml}

                    <p style="color: #666666; font-size: 16px; line-height: 1.6; margin: 18px 0 0 0;">
                      Vous pouvez modifier votre offre et la resoumettre depuis votre espace personnel après connexion.
                    </p>
                    
                    <!-- CTA Button (lien vert vers login) -->
                    <div style="text-align: center; margin: 30px 0;">
                      <a href="${loginLink}" style="display: inline-block; background: linear-gradient(135deg, #4CAF50 0%, #388E3C 100%); color: #ffffff; text-decoration: none; padding: 14px 40px; border-radius: 8px; font-size: 16px; font-weight: bold;">
                        Se connecter
                      </a>
                    </div>

                    <p style="color: #999999; font-size: 13px; line-height: 1.6; margin: 20px 0 0 0; text-align: center;">
                      Ou copiez ce lien : <a href="${loginLink}" style="color: #4CAF50;">${loginLink}</a>
                    </p>
                  </td>
                </tr>
                
                <!-- Footer (comme email précédent) -->
                <tr>
                  <td style="background-color: #f8f9fa; padding: 20px 30px; text-align: center; border-radius: 0 0 10px 10px; border-top: 1px solid #eeeeee;">
                    <p style="color: #999999; font-size: 12px; margin: 0;">
                      © ${new Date().getFullYear()} Optylab - Tous droits réservés
                    </p>
                    <p style="color: #bbbbbb; font-size: 11px; margin: 10px 0 0 0;">
                      Cet email a été envoyé automatiquement, merci de ne pas y répondre.
                    </p>
                  </td>
                </tr>
                
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `,
    text: `
Optylab - Offre rejetée

Bonjour,

Votre offre "${jobTitle}" a été rejetée par l'administrateur.
${reasonText}
Veuillez vous connecter pour accéder à votre espace et modifier l'offre : ${loginLink}

© ${new Date().getFullYear()} Optylab
    `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log("Email rejet offre envoyé:", info.messageId); // ✅ sans emoji
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error("Erreur envoi email rejet offre:", error); // ✅ sans emoji
    throw error;
  }
}

/* =========================
   ✅ SEND SET PASSWORD EMAIL
   Envoyé lors de la création d'un utilisateur par l'admin
   L'utilisateur clique sur le lien pour définir son mot de passe
========================= */
export async function sendSetPasswordEmail(to, { nom, prenom, link }) {
  const fullName = [prenom, nom].filter(Boolean).join(" ") || to;

  const mailOptions = {
    from: `"Optylab RH" <${process.env.MAIL_USER}>`,
    to,
    subject: "Bienvenue sur Optylab – Activez votre compte",
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f4f4;">
        <table role="presentation" style="width: 100%; border-collapse: collapse;">
          <tr>
            <td align="center" style="padding: 40px 0;">
              <table role="presentation" style="width: 600px; border-collapse: collapse; background-color: #ffffff; border-radius: 10px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
                
                <!-- Header -->
                <tr>
                  <td style="background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
                    <h1 style="color: #ffffff; margin: 0; font-size: 28px;">Optylab</h1>
                    <p style="color: #e8f5e9; margin: 10px 0 0 0; font-size: 14px;">Plateforme RH Intelligente</p>
                  </td>
                </tr>
                
                <!-- Content -->
                <tr>
                  <td style="padding: 40px 30px;">
                  

                    <h2 style="color: #333333; margin: 0 0 20px 0; font-size: 22px; text-align: center;">
                      Bienvenue, ${fullName} !
                    </h2>
                    
                    <p style="color: #666666; font-size: 16px; line-height: 1.6; margin: 0 0 15px 0;">
                      Bonjour,
                    </p>

                    <p style="color: #666666; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                      Un compte a été créé pour vous sur la plateforme <strong>Optylab RH</strong>.
                      Pour l'activer et définir votre mot de passe, cliquez sur le bouton ci-dessous :
                    </p>
                    
                    <!-- CTA Button -->
                    <div style="text-align: center; margin: 30px 0;">
                      <a href="${link}" 
                         style="display: inline-block; background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%); 
                                color: #ffffff; text-decoration: none; padding: 16px 48px; 
                                border-radius: 10px; font-size: 16px; font-weight: bold;">
                                Définir mon mot de passe
                      </a>
                    </div>

                    <!-- Info box -->
                    <div style="background-color: #f8f9fa; border: 2px dashed #4CAF50; border-radius: 10px; padding: 20px; text-align: center; margin: 20px 0;">
                      <p style="color: #888888; font-size: 12px; margin: 0 0 5px 0; text-transform: uppercase; letter-spacing: 1px;">Important</p>
                      <p style="color: #333333; font-size: 14px; margin: 0;">
                        ⏱️ Ce lien est valable <strong>48 heures</strong>.<br/>
                        Passé ce délai, contactez votre administrateur.
                      </p>
                    </div>

                    <p style="color: #999999; font-size: 14px; line-height: 1.6; margin: 20px 0 0 0;">
                      Si vous n'êtes pas à l'origine de cette demande, ignorez simplement cet email.
                    </p>
                    
                    <p style="color: #bbbbbb; font-size: 12px; line-height: 1.6; margin: 10px 0 0 0; word-break: break-all;">
                      Ou copiez ce lien : <a href="${link}" style="color: #4CAF50;">${link}</a>
                    </p>
                  </td>
                </tr>
                
                <!-- Footer -->
                <tr>
                  <td style="background-color: #f8f9fa; padding: 20px 30px; text-align: center; border-radius: 0 0 10px 10px; border-top: 1px solid #eeeeee;">
                    <p style="color: #999999; font-size: 12px; margin: 0;">
                      © ${new Date().getFullYear()} Optylab - Tous droits réservés
                    </p>
                    <p style="color: #bbbbbb; font-size: 11px; margin: 10px 0 0 0;">
                      Cet email a été envoyé automatiquement, merci de ne pas y répondre.
                    </p>
                  </td>
                </tr>
                
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `,
    text: `
      Optylab – Activation de compte

      Bonjour ${fullName},

      Un compte a été créé pour vous sur Optylab RH.
      Définissez votre mot de passe via ce lien (valable 48h) :
      ${link}

      Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.

      © ${new Date().getFullYear()} Optylab
    `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log("📧 Email activation envoyé:", info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error("❌ Erreur envoi email activation:", error);
    throw error;
  }
}