// ================================================================
// 🆕 SEND DOCUMENTS — candidature.controller.sendDocuments.js
// ================================================================
// Nouveau controller pour envoyer fiche de renseignement + quiz
// à un candidat pré-sélectionné en un seul email.
//
// Route à ajouter dans candidature.routes.js :
//   router.post("/:candidatureId/send-documents", authMiddleware, adminOnly, sendDocumentsController);
// ================================================================

import { ObjectId } from "mongodb";
import transporter from "../config/mailer.js";
import { findFicheById } from "../models/FicheRenseignement.js";
import { findQuizByJobId } from "../models/quizModel.js";
import {
  createSubmission,
  findSubmissionByFicheAndCandidature,
} from "../models/ficheSubmission.model.js";
import { getDB } from "../models/db.js";

const FRONTEND_URL = process.env.FRONT_URL || "http://localhost:3000";
const col = () => getDB().collection("candidatures");

/** Palette Optylab (emails) */
const OPTY = {
  green: "#6CB33F",
  greenDark: "#4E8F2F",
  greenSoft: "#E9F5E3",
  pageBg: "#F3F4F6",
  cardBg: "#FFFFFF",
  border: "#E5E7EB",
  text: "#111827",
  muted: "#6B7280",
};

/**
 * POST /candidatures/:candidatureId/send-documents
 *
 * Body : {
 *   ficheId?   : string   (optionnel — si pas sélectionné, pas envoyé)
 *   includeQuiz: boolean  (si true → envoie le lien quiz)
 *   email      : string   (email du candidat)
 * }
 *
 * Retourne : { success, sentFiche, sentQuiz, submissionId? }
 */
export async function sendDocumentsController(c) {
  try {
    const candidatureId = c.req.param("candidatureId");
    const body = await c.req.json();
    const { ficheId, includeQuiz, email } = body;

    /* =========== VALIDATION =========== */
    if (!ObjectId.isValid(candidatureId)) {
      return c.json({ message: "candidatureId invalide" }, 400);
    }
    if (!email) {
      return c.json({ message: "email requis" }, 400);
    }
    if (!ficheId && !includeQuiz) {
      return c.json({ message: "Sélectionnez au moins une fiche ou le quiz" }, 400);
    }

    /* =========== CANDIDATURE =========== */
    const candidature = await col().findOne({ _id: new ObjectId(candidatureId) });
    if (!candidature) {
      return c.json({ message: "Candidature introuvable" }, 404);
    }

    let sentFiche = false;
    let sentQuiz = false;
    let submissionId = null;

    let ficheHtml = "";
    let quizHtml = "";

    /* =========== FICHE DE RENSEIGNEMENT =========== */
    if (ficheId) {
      if (!ObjectId.isValid(ficheId)) {
        return c.json({ message: "ficheId invalide" }, 400);
      }

      const fiche = await findFicheById(ficheId);
      if (!fiche) {
        return c.json({ message: "Fiche introuvable" }, 404);
      }

      // Créer ou récupérer la submission
      let submission = await findSubmissionByFicheAndCandidature(ficheId, candidatureId);
      if (!submission) {
        const created = await createSubmission({
          ficheId,
          candidatureId,
          candidatId: null,
        });
        submission = { _id: created.insertedId };
      }

      submissionId = submission._id;
      const ficheLink = `${FRONTEND_URL}/candidat/${submission._id}`;

      ficheHtml = `
        <tr>
          <td style="padding: 16px 0; border-bottom: 1px solid ${OPTY.border};">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="padding-right:16px;">
                  <div style="display:inline-block; background:${OPTY.greenSoft}; border-radius:999px; padding:6px 12px; margin-bottom:8px;">
                    <span style="font-size:12px; font-weight:800; color:${OPTY.greenDark}; text-transform:uppercase; letter-spacing:0.5px;">
                       Fiche de renseignement
                    </span>
                  </div>
                  <p style="margin:0 0 4px 0; font-size:16px; font-weight:800; color:${OPTY.text};">
                    ${fiche.title}
                  </p>
                  ${fiche.description ? `<p style="margin:0 0 10px 0; font-size:13px; color:${OPTY.muted}; line-height:1.5;">${fiche.description}</p>` : ""}
                  <p style="margin:0; font-size:13px; color:${OPTY.muted};">
                    ${fiche.questions?.length || 0} question(s) à compléter
                  </p>
                </td>

                <td style="text-align:right; vertical-align:middle;">
                  <a href="${ficheLink}"
                     style="display:inline-block; padding:10px 18px; background:${OPTY.greenDark}; color:#fff; border-radius:999px; text-decoration:none; font-weight:800; font-size:13px; white-space:nowrap;">
                    Remplir la fiche →
                  </a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      `;
      sentFiche = true;
    }

    /* =========== QUIZ TECHNIQUE =========== */
    if (includeQuiz) {
      const jobOfferId = candidature.jobOfferId;
      const quiz = jobOfferId ? await findQuizByJobId(jobOfferId.toString()) : null;

      if (quiz) {
        const quizLink = `${FRONTEND_URL}/candidat/quiz/${quiz._id}?candidatureId=${candidatureId}`;

        quizHtml = `
          <tr>
            <td style="padding: 16px 0; border-bottom: 1px solid ${OPTY.border};">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding-right:16px;">
                    <div style="display:inline-block; background:${OPTY.greenSoft}; border-radius:999px; padding:6px 12px; margin-bottom:8px;">
                      <span style="font-size:12px; font-weight:800; color:${OPTY.greenDark}; text-transform:uppercase; letter-spacing:0.5px;">
                         Quiz technique
                      </span>
                    </div>
                    <p style="margin:0 0 4px 0; font-size:16px; font-weight:800; color:${OPTY.text};">
                      ${quiz.jobTitle || "Quiz technique"}
                    </p>
                    <p style="margin:0; font-size:13px; color:${OPTY.muted};">
                      ${quiz.totalQuestions || 0} question(s) · Durée estimée : ${Math.ceil((quiz.totalQuestions || 0) * 2)} min
                    </p>
                  </td>

                  <td style="text-align:right; vertical-align:middle;">
                    <a href="${quizLink}"
                       style="display:inline-block; padding:10px 18px; background:${OPTY.green}; color:#fff; border-radius:999px; text-decoration:none; font-weight:800; font-size:13px; white-space:nowrap;">
                      Passer le quiz →
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        `;
        sentQuiz = true;
      } else {
        console.warn(`⚠️ Aucun quiz trouvé pour jobOfferId: ${candidature.jobOfferId}`);
      }
    }

    /* =========== EMAIL =========== */
    if (!sentFiche && !sentQuiz) {
      return c.json(
        {
          message:
            "Aucun document à envoyer (quiz introuvable pour ce poste et aucune fiche sélectionnée)",
        },
        400
      );
    }

    const subjectParts = [];
    if (sentFiche) subjectParts.push("Fiche de renseignement");
    if (sentQuiz) subjectParts.push("Quiz technique");
    const subject = subjectParts.join(" & ") + " – Recrutement Optylab";

    // Header/Footer alignés avec ton design (bande verte + footer centré)
    const emailHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
        </head>

        <body style="margin:0; padding:0; background:${OPTY.pageBg}; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:${OPTY.pageBg}; padding:26px 14px;">
            <tr>
              <td align="center">
                <table width="640" cellpadding="0" cellspacing="0" style="background:${OPTY.cardBg}; border-radius:18px; overflow:hidden; border:1px solid ${OPTY.border};">
                  
                  <!-- HEADER (comme ton screenshot) -->
                  <tr>
                    <td style="background:${OPTY.green}; padding:34px 22px; text-align:center;">
                      <div style="font-size:38px; font-weight:900; color:#ffffff; line-height:1;">
                        Optylab
                      </div>
                      <div style="margin-top:10px; font-size:16px; font-weight:700; color:rgba(255,255,255,0.92);">
                        Plateforme RH Intelligente
                      </div>
                    </td>
                  </tr>

                  <!-- BODY -->
                  <tr>
                    <td style="padding:26px 22px;">
                      <p style="margin:0 0 10px 0; font-size:16px; color:${OPTY.text}; font-weight:800;">Bonjour,</p>

                      <p style="margin:0 0 18px 0; font-size:14px; color:${OPTY.muted}; line-height:1.7;">
                        Suite à l’examen de votre candidature, nous vous invitons à compléter les étapes ci-dessous.
                        Merci de les remplir dès que possible.
                      </p>

                      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${OPTY.border}; border-radius:14px; overflow:hidden; padding:0 16px;">
                        <tbody>
                          ${ficheHtml}
                          ${quizHtml}
                        </tbody>
                      </table>

                      <p style="margin:18px 0 0 0; font-size:12px; color:${OPTY.muted}; line-height:1.7;">
                        Ces liens sont personnels et vous sont destinés uniquement.
                      </p>
                    </td>
                  </tr>

                  <!-- FOOTER (comme ton screenshot) -->
                  <tr>
                    <td style="padding:18px 22px; text-align:center; border-top:1px solid ${OPTY.border}; background:#ffffff;">
                      <div style="font-size:13px; color:#94A3B8; font-weight:700;">
                        © ${new Date().getFullYear()} Optylab - Tous droits réservés
                      </div>
                      <div style="margin-top:6px; font-size:12px; color:#CBD5E1;">
                        Cet email a été envoyé automatiquement, merci de ne pas y répondre.
                      </div>
                    </td>
                  </tr>

                </table>
              </td>
            </tr>
          </table>
        </body>
      </html>
    `;

    const info = await transporter.sendMail({
      from: `"Optylab" <${process.env.MAIL_USER}>`,
      to: email,
      subject,
      html: emailHtml,
    });

    console.log("📧 Documents envoyés :", info.accepted, { sentFiche, sentQuiz });

    return c.json({
      success: true,
      message: "Documents envoyés par email",
      sentFiche,
      sentQuiz,
      submissionId: submissionId?.toString() || null,
    });
  } catch (err) {
    console.error("❌ sendDocumentsController error:", err);
    return c.json({ message: "Erreur serveur", error: err.message }, 500);
  }
}