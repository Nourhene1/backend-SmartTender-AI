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






export async function sendCandidateWelcomeEmail(to, { fullName, email, password, loginUrl }) {
  // Adapte "transporter" à ton setup nodemailer existant
  await transporter.sendMail({
    from: `SmartTender <${process.env.MAIL_FROM}>`,
    to,
    subject: "✅ Votre espace candidat SmartTender",
    html: `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
        <div style="background:#6CB33F;padding:28px 32px;">
          <h1 style="color:#fff;margin:0;font-size:22px;">Votre candidature a bien été reçue ✅</h1>
        </div>
        <div style="padding:32px;">
          <p style="color:#374151;font-size:15px;margin-bottom:20px;">Bonjour <strong>${fullName}</strong>,</p>
          <p style="color:#374151;font-size:14px;">
            Votre candidature a été soumise avec succès. Un espace personnel vous a été créé pour suivre l'avancement de vos candidatures.
          </p>

          <div style="background:#F0FAF0;border:1px solid #D1FAE5;border-radius:10px;padding:20px;margin:24px 0;">
            <p style="margin:0 0 8px 0;font-weight:bold;color:#065F46;font-size:14px;">Vos identifiants de connexion :</p>
            <p style="margin:4px 0;color:#374151;font-size:14px;">📧 Email : <strong>${email}</strong></p>
            <p style="margin:4px 0;color:#374151;font-size:14px;">🔑 Mot de passe : <strong style="font-family:monospace;background:#e5e7eb;padding:2px 8px;border-radius:4px;">${password}</strong></p>
          </div>

          <p style="color:#6B7280;font-size:13px;margin-bottom:24px;">
            ⚠️ Pour votre sécurité, changez votre mot de passe lors de votre première connexion.
          </p>

          <a href="${loginUrl}" style="display:inline-block;background:#6CB33F;color:#fff;font-weight:bold;padding:12px 28px;border-radius:8px;text-decoration:none;font-size:15px;">
            Accéder à mon espace →
          </a>

          <p style="color:#9CA3AF;font-size:12px;margin-top:28px;">
            SmartTender — Si vous n'êtes pas à l'origine de cette candidature, ignorez cet email.
          </p>
        </div>
      </div>
    `,
  });
}




export async function sendResetCodeEmail(to, code) {
  const mailOptions = {
    from: `SmartTender IA RH <${process.env.MAIL_USER}>`,
    to,
    subject: "Code de réinitialisation de mot de passe - SmartTender IA ",
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
                    <h1 style="color: #ffffff; margin: 0; font-size: 28px;">SmartTender IA </h1>
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
                      © ${new Date().getFullYear()} SmartTender IA  - Tous droits réservés
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
      SmartTender IA  - Réinitialisation de mot de passe
      
      Bonjour,
      
      Vous avez demandé la réinitialisation de votre mot de passe.
      
      Votre code de vérification : ${code}
      
      Ce code expire dans 15 minutes.
      
      Si vous n'avez pas demandé cette réinitialisation, ignorez cet email.
      
      © ${new Date().getFullYear()} SmartTender IA 
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

export async function sendSetPasswordEmail(to, { nom, prenom, link }) {
  const fullName = [prenom, nom].filter(Boolean).join(" ") || to;

  const mailOptions = {
    from: "SmartTender IA <${process.env.MAIL_USER}>",
    to,
    subject: "Bienvenue sur SmartTender IA  – Activez votre compte",
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
                    <h1 style="color: #ffffff; margin: 0; font-size: 28px;">SmartTender IA </h1>
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
                      Un compte a été créé pour vous sur la plateforme <strong>SmartTender IA  RH</strong>.
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
                      © ${new Date().getFullYear()} SmartTender IA  - Tous droits réservés
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
      SmartTender IA  – Activation de compte

      Bonjour ${fullName},

      Un compte a été créé pour vous sur SmartTender IA  RH.
      Définissez votre mot de passe via ce lien (valable 48h) :
      ${link}

      Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.

      © ${new Date().getFullYear()} SmartTender IA 
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

