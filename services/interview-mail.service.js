import nodemailer from "nodemailer";
import { ObjectId } from "mongodb";
import { getDB } from "../models/db.js";

const transporter = nodemailer.createTransport({
  host: process.env.MAIL_HOST || "smtp.gmail.com",
  port: parseInt(process.env.MAIL_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS,
  },
});


/* ============================================================
 *  EMAILS ENVOYÉS :
 * ============================================================
 *  1. sendInterviewConfirmationRequest     → ResponsableMetier (confirmer/modifier)
 *  2. sendInterviewConfirmationToCandidate → Candidat (confirmer/proposer autre date)
 *  3. sendModificationRequestToAdmin       → Admin (responsable veut changer la date)
 *  4. sendCandidateConfirmedNotification   → Admin (candidat a confirmé)
 *  5. sendCandidateRescheduleRequestToAdmin → Admin (candidat propose autre date)
 *  6. sendAdminApprovedModificationToResponsable  → Responsable (admin a approuvé)
 *  7. sendAdminRejectedModificationToResponsable  → Responsable (admin a refusé)
 * ============================================================ */

// Helper: Get candidate name from DB
async function getCandidateNameFromDB(candidatureId) {
  try {
    const candidature = await getDB()
      .collection("candidatures")
      .findOne({ _id: new ObjectId(candidatureId) });

    if (!candidature) return null;

    return (
      candidature.extracted?.parsed?.nom ||
      candidature.extracted?.parsed?.name ||
      candidature.extracted?.nom ||
      candidature.extracted?.name ||
      null
    );
  } catch (error) {
    console.error("Error getting candidate name from DB:", error);
    return null;
  }
}

// ──────────────────────────────────────────────
//  1. Mail au ResponsableMetier : confirmer ou modifier
// ──────────────────────────────────────────────
// services/interview-mail.service.js — VERSION COMPLÈTE
// ================================================================
// Toutes les fonctions mail liées aux entretiens
// Utilise : import transporter from "../config/mailer.js"
// ================================================================


const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";
const MAIL_FROM = `"Recrutement Optylab" <${process.env.MAIL_USER}>`;

// ── Couleurs & style commun ─────────────────────────────────────
const GREEN = "#388E3C";
const LIGHT = "#E8F5E9";
const GRAY = "#757575";
const DARK = "#212121";

function baseTemplate(content) {
  return `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

        <!-- Header -->
         <tr>
                  <td style="background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
                    <h1 style="color: #ffffff; margin: 0; font-size: 28px;">Optylab</h1>
                    <p style="color: #e8f5e9; margin: 10px 0 0 0; font-size: 14px;">Plateforme RH Intelligente</p>
                  </td>
          </tr>

        <!-- Contenu -->
        <tr>
          <td style="padding:36px;">
            ${content}
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#fafafa;border-top:1px solid #eeeeee;padding:20px 36px;text-align:center;">
            <p style="margin:0;color:#bdbdbd;font-size:11px;">
              Optylab · Recrutement &amp; RH<br>
              Cet email a été envoyé automatiquement, merci de ne pas y répondre directement.
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function btnPrimary(url, label) {
  return `<a href="${url}" style="display:inline-block;background:${GREEN};color:#ffffff;padding:13px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px;letter-spacing:0.2px;">${label}</a>`;
}

function btnSecondary(url, label) {
  return `<a href="${url}" style="display:inline-block;background:#ff6b35;color:#ffffff;padding:13px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px;">${label}</a>`;
}

function btnOutline(url, label) {
  return `<a href="${url}" style="display:inline-block;background:#f0f0f0;color:#333333;padding:13px 28px;border-radius:10px;text-decoration:none;font-weight:600;font-size:14px;">${label}</a>`;
}

function infoRow(label, value) {
  return `
  <tr>
    <td style="padding:8px 0;border-bottom:1px solid #f0f0f0;">
      <table cellpadding="0" cellspacing="0" width="100%">
        <tr>
          <td style="color:${GRAY};font-size:13px;width:110px;">${label}</td>
          <td style="color:${DARK};font-size:14px;font-weight:600;">${value}</td>
        </tr>
      </table>
    </td>
  </tr>`;
}

// ════════════════════════════════════════════════════════════════
//  1. INVITATION ENTRETIEN RH → CANDIDAT
//     Envoyé quand le recruteur planifie depuis la liste pré-sélection
//     Le candidat peut : ✓ Confirmer  |  ↺ Proposer autre date
// ════════════════════════════════════════════════════════════════
export async function sendInterviewInviteToCandidate({
  candidateEmail,
  candidateName,
  jobTitle,
  dateFormatted,
  timeFormatted,
  notes,
  confirmUrl,
  rescheduleUrl,
  isAlternative = false,   // true = 2e envoi avec créneaux alternatifs
  alternativeSlots = [],   // [{date, time}] — utilisé si isAlternative=true
}) {
  const subject = isAlternative
    ? `[Optylab] Nouvelles disponibilités — Entretien RH${jobTitle ? ` · ${jobTitle}` : ""}`
    : `[Optylab] Invitation à un entretien RH${jobTitle ? ` · ${jobTitle}` : ""}`;

  // ✅ Helpers anti-undefined
  const safe = (v, fallback = "—") => {
    if (v === null || v === undefined) return fallback;
    const s = String(v).trim();
    return s ? s : fallback;
  };

  const formatFRDate = (d) => {
    try {
      if (!d) return "—";
      const dt = d instanceof Date ? d : new Date(d);
      if (Number.isNaN(dt.getTime())) return safe(d);
      return dt.toLocaleDateString("fr-FR", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      });
    } catch {
      return "—";
    }
  };

  const formatFRTime = (t) => {
    // accepte "09:30", "09:30:00", Date, ISO
    try {
      if (!t) return "—";
      if (t instanceof Date) {
        return t.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
      }
      const s = String(t);
      if (/^\d{2}:\d{2}/.test(s)) return s.slice(0, 5);
      const dt = new Date(s);
      if (!Number.isNaN(dt.getTime())) {
        return dt.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
      }
      return safe(t);
    } catch {
      return "—";
    }
  };

  // ✅ Normaliser les champs (plus jamais undefined)
  const name = safe(candidateName, "Candidat");
  const title = safe(jobTitle, "Poste à définir");

  // Si tu passes déjà des strings formatées => ok.
  // Si tu passes une date ISO => on la formate proprement.
  const dateText = (dateFormatted && String(dateFormatted).includes("-"))
    ? formatFRDate(dateFormatted)
    : safe(dateFormatted);

  const timeText = formatFRTime(timeFormatted);

  // notes peut être un objet → le convertir proprement
  const placeText =
    typeof notes === "string" ? notes.trim() :
      notes && typeof notes === "object" ? (notes.location || notes.lieu || notes.notes || "") :
        "";

  const content = isAlternative
    ? `
      <h2 style="margin:0 0 8px;color:${GREEN};font-size:20px;">Nouvelles disponibilités</h2>
      <p style="color:${GRAY};font-size:14px;margin:0 0 24px;">Bonjour <strong style="color:${DARK};">${name}</strong>,</p>
      <p style="color:${DARK};font-size:14px;line-height:1.6;margin:0 0 20px;">
        Suite à votre demande, voici <strong>3 nouveaux créneaux disponibles</strong> pour votre entretien — <em>${title}</em> :
      </p>

      <div style="background:${LIGHT};border-left:4px solid ${GREEN};border-radius:8px;padding:16px 20px;margin:0 0 24px;">
        ${alternativeSlots.map((s, i) => {
      const d = s?.date;
      const t = s?.time;
      return `
            <p style="margin:${i === 0 ? "0" : "8px"} 0 0;color:${DARK};font-size:14px;font-weight:600;">
              ${formatFRDate(d)} · ${formatFRTime(t)}
            </p>`;
    }).join("")}
      </div>

      <p style="margin:0 0 24px;font-size:13px;color:${GRAY};">
        Cliquez sur le bouton ci-dessous pour confirmer le premier créneau,<br>
        ou proposez une autre date si aucun ne vous convient.
      </p>

      <div style="display:flex;gap:12px;">
        ${btnPrimary(confirmUrl, " Confirmer le premier créneau")}
        &nbsp;&nbsp;
        ${btnOutline(rescheduleUrl, "Proposer une autre date")}
      </div>
    `
    : `
      <h2 style="margin:0 0 8px;color:${GREEN};font-size:20px;">Invitation à un entretien RH</h2>
      <p style="color:${GRAY};font-size:14px;margin:0 0 24px;">Bonjour <strong style="color:${DARK};">${name}</strong>,</p>

      <p style="color:${DARK};font-size:14px;line-height:1.6;margin:0 0 20px;">
        Nous avons le plaisir de vous inviter à un entretien pour le poste :<br>
        <strong style="color:${GREEN};font-size:16px;">${title}</strong>
      </p>

      <!-- Détails entretien -->
      <table width="100%" cellpadding="0" cellspacing="0"
             style="background:${LIGHT};border-radius:10px;padding:4px 20px;margin:0 0 28px;">
        <tbody>
          ${infoRow("Date", dateText)}
          ${infoRow("Heure", timeText)}
          ${placeText ? infoRow("Lieu", placeText) : ""}
          ${infoRow("Type", "Entretien RH")}
        </tbody>
      </table>

      <p style="color:${DARK};font-size:14px;font-weight:600;margin:0 0 16px;">
        Merci de nous confirmer votre présence :
      </p>

      <table cellpadding="0" cellspacing="0">
        <tr>
          <td style="padding-right:12px;">${btnPrimary(confirmUrl, "Je confirme ma présence")}</td>
          <td>${btnSecondary(rescheduleUrl, "Proposer une autre date")}</td>
        </tr>
      </table>

      <div style="background:#fff8e1;border-left:4px solid #ffc107;border-radius:8px;padding:12px 16px;margin:28px 0 0;">
        <p style="margin:0;font-size:12px;color:#6d6d6d;line-height:1.6;">
          ℹ Si vous proposez une autre date, nous vous enverrons automatiquement
          <strong>3 créneaux disponibles</strong> dans les 3 jours suivant la date initiale (entre 10h et 12h).
        </p>
      </div>
    `;

  await transporter.sendMail({
    from: MAIL_FROM,
    to: candidateEmail,
    subject,
    html: baseTemplate(content),
  });
}

// ════════════════════════════════════════════════════════════════
//  2. DEMANDE DE CONFIRMATION → RESPONSABLE MÉTIER
//     Étape 1 du flow existant : Admin planifie, responsable confirme
// ════════════════════════════════════════════════════════════════
export async function sendInterviewConfirmationRequest({
  responsibleEmail,
  responsibleName,
  candidateName,
  jobTitle,
  proposedDate,
  proposedTime,
  rawDate,
  confirmationToken,
}) {
  const confirmUrl = `${FRONTEND_URL}/ResponsableMetier/confirm-interview/${confirmationToken}`;

  const content = `
    <h2 style="margin:0 0 8px;color:${GREEN};font-size:20px;">Entretien à confirmer</h2>
    <p style="color:${GRAY};font-size:14px;margin:0 0 24px;">Bonjour <strong style="color:${DARK};">${responsibleName}</strong>,</p>
    <p style="color:${DARK};font-size:14px;line-height:1.6;margin:0 0 20px;">
      Un entretien a été planifié avec le candidat suivant pour le poste
      <strong>${jobTitle}</strong>. Veuillez confirmer ou proposer une autre date.
    </p>

    <table width="100%" cellpadding="0" cellspacing="0"
           style="background:${LIGHT};border-radius:10px;padding:4px 20px;margin:0 0 28px;">
      <tbody>
        ${infoRow("Candidat", candidateName)}
        ${infoRow("Poste", jobTitle)}
        ${infoRow("Date", proposedDate)}
        ${infoRow("Heure", proposedTime)}
      </tbody>
    </table>

    ${btnPrimary(confirmUrl, "Confirmer / Modifier la date")}
  `;

  await transporter.sendMail({
    from: MAIL_FROM,
    to: responsibleEmail,
    subject: `[Optylab] Entretien à confirmer — ${candidateName} · ${jobTitle}`,
    html: baseTemplate(content),
  });
}

// ════════════════════════════════════════════════════════════════
//  3. CONFIRMATION DE L'ENTRETIEN → CANDIDAT
//     Étape 2 du flow existant : Responsable a confirmé
// ════════════════════════════════════════════════════════════════
export async function sendInterviewConfirmationToCandidate({
  candidateEmail,
  candidateName,
  jobTitle,
  confirmedDate,
  confirmedTime,
  rawDate,
  notes,
  location,
  candidateToken,
}) {
  const confirmUrl = `${FRONTEND_URL}/interview/candidate/${candidateToken}/confirm`;
  const rescheduleUrl = `${FRONTEND_URL}/interview/candidate/${candidateToken}/reschedule`;

  const content = `
    <h2 style="margin:0 0 8px;color:${GREEN};font-size:20px;">Votre entretien est confirmé</h2>
    <p style="color:${GRAY};font-size:14px;margin:0 0 24px;">Bonjour <strong style="color:${DARK};">${candidateName}</strong>,</p>
    <p style="color:${DARK};font-size:14px;line-height:1.6;margin:0 0 20px;">
      Votre entretien pour le poste <strong>${jobTitle}</strong> a été confirmé par notre équipe.
    </p>

    <table width="100%" cellpadding="0" cellspacing="0"
           style="background:${LIGHT};border-radius:10px;padding:4px 20px;margin:0 0 28px;">
      <tbody>
        ${infoRow("Date", confirmedDate)}
        ${infoRow("Heure", confirmedTime)}
        ${location ? infoRow("Lieu", location) : ""}
        ${notes ? infoRow("Notes", notes) : ""}
      </tbody>
    </table>

    <p style="color:${DARK};font-size:14px;font-weight:600;margin:0 0 16px;">
      Veuillez confirmer votre présence :
    </p>
    <table cellpadding="0" cellspacing="0">
      <tr>
        <td style="padding-right:12px;">${btnPrimary(confirmUrl, "Je confirme")}</td>
        <td>${btnSecondary(rescheduleUrl, " Proposer une autre date")}</td>
      </tr>
    </table>
  `;

  await transporter.sendMail({
    from: MAIL_FROM,
    to: candidateEmail,
    subject: `[Optylab] Entretien confirmé — ${jobTitle}`,
    html: baseTemplate(content),
  });
}

// ════════════════════════════════════════════════════════════════
//  4. DEMANDE DE MODIFICATION → ADMIN
//     Responsable a demandé un changement de date
// ════════════════════════════════════════════════════════════════
export async function sendModificationRequestToAdmin({
  adminEmail,
  candidateName,
  jobTitle,
  originalDate,
  originalTime,
  newDate,
  newTime,
  notes,
  interviewId,
}) {
  const approveUrl = `${FRONTEND_URL}/recruiter/interviews/${interviewId}/approve`;
  const rejectUrl = `${FRONTEND_URL}/recruiter/interviews/${interviewId}/reject`;

  const content = `
    <h2 style="margin:0 0 8px;color:#ff6b35;font-size:20px;">Demande de modification de date</h2>
    <p style="color:${GRAY};font-size:14px;margin:0 0 24px;">Bonjour,</p>
    <p style="color:${DARK};font-size:14px;line-height:1.6;margin:0 0 20px;">
      Le Responsable Métier a demandé une modification de date pour l'entretien de
      <strong>${candidateName}</strong> — <strong>${jobTitle}</strong>.
    </p>

    <table width="100%" cellpadding="0" cellspacing="0"
           style="background:#fff3e0;border-radius:10px;padding:4px 20px;margin:0 0 20px;">
      <tbody>
        ${infoRow(" Ancienne", "date", originalDate)}
        ${infoRow(" Ancienne", "heure", originalTime)}
      </tbody>
    </table>

    <table width="100%" cellpadding="0" cellspacing="0"
           style="background:${LIGHT};border-radius:10px;padding:4px 20px;margin:0 0 28px;">
      <tbody>
        ${infoRow("Nouvelle", "date", newDate)}
        ${infoRow("Nouvelle", "heure", newTime)}
        ${notes ? infoRow("Notes", notes) : ""}
      </tbody>
    </table>

    <table cellpadding="0" cellspacing="0">
      <tr>
        <td style="padding-right:12px;">${btnPrimary(approveUrl, "✓ Approuver")}</td>
        <td>${btnOutline(rejectUrl, " Refuser")}</td>
      </tr>
    </table>
  `;

  await transporter.sendMail({
    from: MAIL_FROM,
    to: adminEmail,
    subject: `[Optylab] Modification demandée — Entretien ${candidateName}`,
    html: baseTemplate(content),
  });
}

// ════════════════════════════════════════════════════════════════
//  5. CANDIDAT A CONFIRMÉ → NOTIFICATION ADMIN + RESPONSABLE
// ════════════════════════════════════════════════════════════════
export async function sendCandidateConfirmedNotification({
  adminEmail,
  candidateName,
  jobTitle,
  confirmedDate,
  confirmedTime,
  interviewId,
}) {
  const content = `
    <h2 style="margin:0 0 8px;color:${GREEN};font-size:20px;">Entretien confirmé par le candidat</h2>
    <p style="color:${DARK};font-size:14px;line-height:1.6;margin:0 0 20px;">
      <strong>${candidateName}</strong> a confirmé sa présence à l'entretien pour le poste
      <strong>${jobTitle}</strong>.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0"
           style="background:${LIGHT};border-radius:10px;padding:4px 20px;margin:0 0 28px;">
      <tbody>
        ${infoRow("Date", confirmedDate)}
        ${infoRow("Heure", confirmedTime)}
      </tbody>
    </table>
    ${btnPrimary(`${FRONTEND_URL}/recruiter/interviews/${interviewId}`, "Voir les détails")}
  `;

  await transporter.sendMail({
    from: MAIL_FROM,
    to: adminEmail,
    subject: `[Optylab]  ${candidateName} a confirmé son entretien`,
    html: baseTemplate(content),
  });
}

// ════════════════════════════════════════════════════════════════
//  6. CANDIDAT A CONFIRMÉ → RESPONSABLE MÉTIER
// ════════════════════════════════════════════════════════════════
export async function sendCandidateConfirmedToResponsable({
  responsibleEmail,
  responsibleName,
  candidateName,
  jobTitle,
  confirmedDate,
  confirmedTime,
}) {
  const content = `
    <h2 style="margin:0 0 8px;color:${GREEN};font-size:20px;">Candidat confirmé</h2>
    <p style="color:${GRAY};font-size:14px;margin:0 0 24px;">Bonjour <strong style="color:${DARK};">${responsibleName}</strong>,</p>
    <p style="color:${DARK};font-size:14px;line-height:1.6;margin:0 0 20px;">
      <strong>${candidateName}</strong> a confirmé sa présence à l'entretien pour le poste
      <strong>${jobTitle}</strong>.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0"
           style="background:${LIGHT};border-radius:10px;padding:4px 20px;margin:0 0 0;">
      <tbody>
        ${infoRow("Date", confirmedDate)}
        ${infoRow("Heure", confirmedTime)}
      </tbody>
    </table>
  `;

  await transporter.sendMail({
    from: MAIL_FROM,
    to: responsibleEmail,
    subject: `[Optylab]  ${candidateName} a confirmé — ${jobTitle}`,
    html: baseTemplate(content),
  });
}

// ════════════════════════════════════════════════════════════════
//  7. CANDIDAT DEMANDE AUTRE DATE → ADMIN
// ════════════════════════════════════════════════════════════════
export async function sendCandidateRescheduleRequestToAdmin({
  adminEmail,
  candidateName,
  jobTitle,
  originalDate,
  originalTime,
  candidateReason,
  interviewId,
}) {
  const content = `
    <h2 style="margin:0 0 8px;color:#ff6b35;font-size:20px;">↺ Demande de report — Candidat</h2>
    <p style="color:${DARK};font-size:14px;line-height:1.6;margin:0 0 20px;">
      <strong>${candidateName}</strong> a demandé un report de son entretien pour le poste
      <strong>${jobTitle}</strong>.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0"
           style="background:#fff3e0;border-radius:10px;padding:4px 20px;margin:0 0 20px;">
      <tbody>
        ${infoRow("Date prévue", originalDate)}
        ${infoRow("Heure prévue", originalTime)}
        ${candidateReason ? infoRow("Raison", candidateReason) : ""}
      </tbody>
    </table>
    <p style="font-size:13px;color:${GRAY};margin:0 0 24px;">
       3 créneaux alternatifs (10h-12h) ont été automatiquement envoyés au candidat.
    </p>
    ${btnPrimary(`${FRONTEND_URL}/recruiter/interviews/${interviewId}`, "Gérer l'entretien")}
  `;

  await transporter.sendMail({
    from: MAIL_FROM,
    to: adminEmail,
    subject: `[Optylab] ${candidateName} demande un report — ${jobTitle}`,
    html: baseTemplate(content),
  });
}

// ════════════════════════════════════════════════════════════════
//  8. ADMIN APPROUVE MODIFICATION → RESPONSABLE
// ════════════════════════════════════════════════════════════════
export async function sendAdminApprovedModificationToResponsable({
  responsibleEmail,
  responsibleName,
  candidateName,
  jobTitle,
  newDate,
  newTime,
  interviewId,
}) {
  const content = `
    <h2 style="margin:0 0 8px;color:${GREEN};font-size:20px;">Modification approuvée</h2>
    <p style="color:${GRAY};font-size:14px;margin:0 0 24px;">Bonjour <strong style="color:${DARK};">${responsibleName}</strong>,</p>
    <p style="color:${DARK};font-size:14px;line-height:1.6;margin:0 0 20px;">
      Votre demande de modification a été approuvée pour l'entretien de
      <strong>${candidateName}</strong> — <strong>${jobTitle}</strong>.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0"
           style="background:${LIGHT};border-radius:10px;padding:4px 20px;margin:0 0 28px;">
      <tbody>
        ${infoRow("Nouvelle date", newDate)}
        ${infoRow("Nouvelle heure", newTime)}
      </tbody>
    </table>
    ${btnPrimary(`${FRONTEND_URL}/ResponsableMetier/confirm-interview/${interviewId}`, "Voir l'entretien")}
  `;

  await transporter.sendMail({
    from: MAIL_FROM,
    to: responsibleEmail,
    subject: `[Optylab]  Modification approuvée — Entretien ${candidateName}`,
    html: baseTemplate(content),
  });
}

// ════════════════════════════════════════════════════════════════
//  9. ADMIN REJETTE MODIFICATION → RESPONSABLE
// ════════════════════════════════════════════════════════════════
export async function sendAdminRejectedModificationToResponsable({
  responsibleEmail,
  responsibleName,
  candidateName,
  jobTitle,
  originalDate,
  originalTime,
  rejectionReason,
  interviewId,
}) {
  const content = `
    <h2 style="margin:0 0 8px;color:#e53935;font-size:20px;">✗ Modification refusée</h2>
    <p style="color:${GRAY};font-size:14px;margin:0 0 24px;">Bonjour <strong style="color:${DARK};">${responsibleName}</strong>,</p>
    <p style="color:${DARK};font-size:14px;line-height:1.6;margin:0 0 20px;">
      Votre demande de modification a été refusée pour l'entretien de
      <strong>${candidateName}</strong> — <strong>${jobTitle}</strong>.
      La date initiale est maintenue.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0"
           style="background:${LIGHT};border-radius:10px;padding:4px 20px;margin:0 0 20px;">
      <tbody>
        ${infoRow("Date maintenue", originalDate)}
        ${infoRow("Heure maintenue", originalTime)}
        ${rejectionReason ? infoRow("Raison du refus", rejectionReason) : ""}
      </tbody>
    </table>
    ${btnPrimary(`${FRONTEND_URL}/ResponsableMetier/confirm-interview/${interviewId}`, "Voir l'entretien")}
  `;

  await transporter.sendMail({
    from: MAIL_FROM,
    to: responsibleEmail,
    subject: `[Optylab]  Modification refusée — Entretien ${candidateName}`,
    html: baseTemplate(content),
  });
}
export async function sendRecruiterRescheduleRequestEmail({
  recruiterEmail,
  recruiterName,
  candidateName,
  jobTitle,
  reason,
  preferredSlotISO,
  manageUrl,
}) {
  const subject = `[Optylab] Demande de report — ${candidateName}${jobTitle ? ` · ${jobTitle}` : ""}`;

  const preferredText = preferredSlotISO
    ? (() => {
      const d = new Date(preferredSlotISO);
      const dateFR = d.toLocaleDateString("fr-FR", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      });
      const timeFR = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
      return `${dateFR} à ${timeFR}`;
    })()
    : "—";

  const content = `
    <h2 style="margin:0 0 10px;color:${GREEN};font-size:20px;">Demande de report d'entretien</h2>
    <p style="color:${GRAY};font-size:14px;margin:0 0 18px;">
      Bonjour <strong style="color:${DARK};">${recruiterName}</strong>,
    </p>

    <p style="color:${DARK};font-size:14px;line-height:1.6;margin:0 0 18px;">
      Le candidat <strong>${candidateName}</strong> a demandé de reporter l’entretien pour le poste :
      <strong style="color:${GREEN};">${jobTitle || "Poste à définir"}</strong>.
    </p>

    <table width="100%" cellpadding="0" cellspacing="0"
           style="background:${LIGHT};border-radius:10px;padding:4px 20px;margin:0 0 22px;">
      <tbody>
        ${infoRow("Candidat", candidateName)}
        ${infoRow("Poste", jobTitle || "Poste à définir")}
        ${infoRow("Raison", reason || "—")}
        ${infoRow("Créneau préféré", preferredText)}
      </tbody>
    </table>

    <p style="margin:0 0 18px;color:${GRAY};font-size:13px;">
      Cliquez ci-dessous pour choisir un nouveau créneau depuis votre calendrier et l’envoyer au candidat.
    </p>

    ${btnPrimary(manageUrl, "Gérer le report (choisir un créneau)")}
  `;

  const html = baseTemplate(content);

  await transporter.sendMail({
    from: MAIL_FROM,
    to: recruiterEmail,
    subject,
    html,
    text: `Bonjour ${recruiterName},
Le candidat ${candidateName} a demandé de reporter l’entretien (${jobTitle}).

Raison: ${reason || "—"}
Créneau préféré: ${preferredText}

Gérer le report: ${manageUrl}

© ${new Date().getFullYear()} Optylab`,
  });
}
export async function sendCandidateProposedSlotConfirmOnlyEmail({
  candidateEmail,
  candidateName,
  jobTitle,
  dateFormatted,
  timeFormatted,
  location,
  confirmUrl,
}) {
  const subject = `[Optylab] Nouveau créneau proposé — Entretien RH${jobTitle ? ` · ${jobTitle}` : ""}`;

  const content = `
    <h2 style="margin:0 0 8px;color:${GREEN};font-size:20px;">Nouveau créneau proposé</h2>
    <p style="color:${GRAY};font-size:14px;margin:0 0 24px;">Bonjour <strong style="color:${DARK};">${candidateName}</strong>,</p>

    <p style="color:${DARK};font-size:14px;line-height:1.6;margin:0 0 20px;">
      Suite à votre demande de report, nous vous proposons le créneau suivant pour votre entretien :
    </p>

    <table width="100%" cellpadding="0" cellspacing="0"
           style="background:${LIGHT};border-radius:10px;padding:4px 20px;margin:0 0 28px;">
      <tbody>
        ${infoRow("Poste", jobTitle || "Poste à définir")}
        ${infoRow("Date", dateFormatted)}
        ${infoRow("Heure", timeFormatted)}
        ${location ? infoRow("Lieu", location) : ""}
        ${infoRow("Type", "Entretien RH")}
      </tbody>
    </table>

    <p style="color:${DARK};font-size:14px;font-weight:600;margin:0 0 16px;">
      Merci de confirmer votre présence :
    </p>

    ${btnPrimary(confirmUrl, " Confirmer")}
    <p style="margin:18px 0 0;font-size:12px;color:${GRAY};line-height:1.6;">
      Si vous ne pouvez pas assister à ce créneau, veuillez contacter directement le recruteur via la plateforme.
    </p>
  `;

  await transporter.sendMail({
    from: MAIL_FROM,
    to: candidateEmail,
    subject,
    html: baseTemplate(content),
  });
}


function appUrl(path) {
  const base = process.env.APP_URL || "http://localhost:3000";
  return `${base}${path}`;
}

// 1) email au responsable: confirmer/modifier
export async function sendInterviewConfirmationRequestToManager({
  responsibleEmail,
  responsibleName,
  recruiterName,
  candidateName,
  jobTitle,
  proposedDate,
  proposedTime,
  token,
}) {
  const confirmLink = appUrl(`/ResponsableMetier/confirm-interview/${token}`);
  const proposeLink = appUrl(`/ResponsableMetier/reschedule-interview/${token}`);

  const subject = `Confirmation entretien RH+Technique — ${candidateName} (${jobTitle})`;

  // ✅ éviter "undefined" dans l’email
  const safeDate = proposedDate ? String(proposedDate) : "—";
  const safeTime = proposedTime ? String(proposedTime) : "—";

  const html = `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#111827;">
  <!-- Wrapper -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 0;">
    <tr>
      <td align="center" style="padding:0 14px;">
        
        <!-- Card container -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:720px;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 10px 30px rgba(0,0,0,0.08);">
          
          <!-- Header green -->
          <tr>
            <td style="background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
                    <h1 style="color: #ffffff; margin: 0; font-size: 28px;">Optylab</h1>
                    <p style="color: #e8f5e9; margin: 10px 0 0 0; font-size: 14px;">Plateforme RH Intelligente</p>
                  </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:28px 28px 18px 28px;">
              <div style="font-size:26px;line-height:1.2;font-weight:800;color:#2f8f3a;margin:0 0 12px 0;">
                Confirmation entretien RH + Technique
              </div>

              <div style="font-size:15px;line-height:1.8;color:#374151;">
                Bonjour <b style="color:#111827;">${responsibleName || "—"}</b>,
                <br/><br/>
                Le recruteur <b style="color:#111827;">${recruiterName || "—"}</b> propose l’entretien suivant :
              </div>

              <div style="margin-top:14px;font-size:18px;line-height:1.4;font-weight:800;color:#2f8f3a;">
                ${jobTitle || "—"}
              </div>

              <!-- Info box -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:18px;background:#e9f7ec;border-radius:14px;padding:18px;">
                <tr>
                  <td style="padding:0;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="font-size:14px;color:#6b7280;padding-bottom:6px;">Candidat</td>
                        <td style="font-size:14px;color:#6b7280;padding-bottom:6px;">Date</td>
                        <td style="font-size:14px;color:#6b7280;padding-bottom:6px;">Heure</td>
                      </tr>
                      <tr>
                        <td style="font-size:16px;font-weight:800;color:#111827;padding-right:10px;">
                          ${candidateName || "—"}
                        </td>
                        <td style="font-size:16px;font-weight:800;color:#111827;padding-right:10px;">
                          ${safeDate}
                        </td>
                        <td style="font-size:16px;font-weight:800;color:#111827;">
                          ${safeTime}
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Buttons -->
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:20px;">
                <tr>
                  <td style="padding-right:10px;padding-bottom:10px;">
                    <a href="${confirmLink}"
                       style="display:inline-block;background:#2f8f3a;color:#ffffff;text-decoration:none;font-weight:800;
                              padding:12px 18px;border-radius:12px;font-size:14px;">
                      Confirmer
                    </a>
                  </td>
                  <td style="padding-bottom:10px;">
                    <a href="${proposeLink}"
                       style="display:inline-block;background:#ffffff;color:#2f8f3a;text-decoration:none;font-weight:800;
                              padding:12px 18px;border-radius:12px;font-size:14px;border:1px solid #2f8f3a;">
                      Proposer une autre date
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Note -->
              <div style="margin-top:14px;background:#fff7ed;border-left:4px solid #f59e0b;padding:12px 14px;border-radius:10px;">
                <div style="font-size:13px;line-height:1.6;color:#7c2d12;">
                  Si vous proposez une autre date, merci de choisir un créneau disponible dans les 3 jours suivant la date initiale.
                </div>
              </div>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:18px 28px 26px 28px;text-align:center;">
              <div style="height:1px;background:#e5e7eb;margin:0 0 14px 0;"></div>
              <div style="font-size:12px;color:#9ca3af;line-height:1.6;">
                Optylab - Recrutement & RH<br/>
                Cet email a été envoyé automatiquement, merci de ne pas y répondre directement.
              </div>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  await transporter.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: responsibleEmail,
    subject,
    html,
  });
}

// 2) email au candidat (après confirmation responsable)
export async function sendInterviewConfirmedToCandidate({
  candidateEmail,
  candidateName,
  jobTitle,
  recruiterName,
  responsibleName,
  date,
  time,
  token,
}) {
  if (!candidateEmail) return;

  const confirmLink = appUrl(`/candidat/confirm-interview/${token}`);
  const proposeLink = appUrl(`/candidat/reschedule-interview/${token}`);

  const subject = `Entretien RH+Technique — ${jobTitle || "Poste"} — Confirmation`;

  // ✅ helpers anti-undefined
  const safe = (v, fallback = "—") => {
    if (v === null || v === undefined) return fallback;
    const s = String(v).trim();
    return s ? s : fallback;
  };

  const formatFRDate = (d) => {
    try {
      if (!d) return "—";
      const dt = d instanceof Date ? d : new Date(d);
      if (Number.isNaN(dt.getTime())) return safe(d);
      return dt.toLocaleDateString("fr-FR", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      });
    } catch {
      return safe(d);
    }
  };

  const formatFRTime = (t) => {
    try {
      if (!t) return "—";
      if (t instanceof Date) {
        return t.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
      }
      const s = String(t);
      if (/^\d{2}:\d{2}/.test(s)) return s.slice(0, 5);
      const dt = new Date(s);
      if (!Number.isNaN(dt.getTime())) {
        return dt.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
      }
      return safe(t);
    } catch {
      return safe(t);
    }
  };

  const GREEN = "#22a06b";
  const BG = "#f3f4f6";
  const TEXT = "#111827";
  const MUTED = "#6b7280";
  const BORDER = "#e5e7eb";
  const LIGHT = "#e9f7ec";

  const name = safe(candidateName, "Candidat");
  const title = safe(jobTitle, "Poste");
  const resp = safe(responsibleName);
  const rec = safe(recruiterName);
  const dDate = formatFRDate(date);
  const dTime = formatFRTime(time);

  // ✅ table row + table block (comme la capture)
  const infoRow2 = (label, value) => `
    <tr>
      <td style="padding:14px 0;font-size:14px;color:${MUTED};width:32%;vertical-align:top;">
        ${label}
      </td>
      <td style="padding:14px 0;font-size:15px;color:${TEXT};font-weight:800;vertical-align:top;">
        ${safe(value)}
      </td>
    </tr>
  `;

  const infoTable = (rowsHtml) => `
    <table width="100%" cellpadding="0" cellspacing="0"
      style="background:${LIGHT};border-radius:14px;padding:4px 22px;margin:18px 0 22px;">
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>
  `;

  // ✅ Buttons (email-safe)
  const btnPrimary = (href, label) => `
    <a href="${href}"
      style="display:inline-block;background:${GREEN};color:#fff;text-decoration:none;
             padding:14px 22px;border-radius:12px;font-weight:800;font-size:14px;">
      ${label}
    </a>
  `;

  const btnOutline = (href, label) => `
    <a href="${href}"
      style="display:inline-block;background:transparent;color:${GREEN};text-decoration:none;
             padding:12px 22px;border-radius:12px;font-weight:800;font-size:14px;border:2px solid ${GREEN};">
      ${label}
    </a>
  `;

  // ✅ Full template (stable Gmail/Outlook)
  const html = `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${safe(subject)}</title>
</head>
<body style="margin:0;padding:0;background:${BG};font-family:Arial,Helvetica,sans-serif;color:${TEXT};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BG};">
    <tr>
      <td align="center" style="padding:24px 12px;">

        <table role="presentation" width="720" cellpadding="0" cellspacing="0" border="0"
          style="width:100%;max-width:720px;background:#ffffff;border:1px solid ${BORDER};
                 border-radius:18px;overflow:hidden;">

          <!-- Header -->
          <tr>
            <td align="center" style="background:${GREEN};padding:34px 20px;">
              <div style="font-size:34px;line-height:1.1;font-weight:800;color:#ffffff;">Optylab</div>
              <div style="margin-top:10px;font-size:16px;line-height:1.4;color:rgba(255,255,255,0.92);">
                Plateforme RH Intelligente
              </div>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:28px 28px 18px 28px;">

              <div style="font-size:24px;line-height:1.2;font-weight:900;color:${TEXT};margin:0 0 8px 0;">
                Entretien RH + Technique confirmé
              </div>

              <div style="font-size:15px;line-height:1.7;color:#374151;margin:0 0 16px 0;">
                Bonjour <b style="color:${TEXT};">${name}</b>,<br/>
                Votre entretien a été validé par le responsable <b>${resp}</b>.
              </div>

              <div style="font-size:18px;line-height:1.4;font-weight:900;color:${GREEN};margin:0 0 12px 0;">
                ${title}
              </div>

              ${infoTable(`
                ${infoRow2("Date", dDate)}
                ${infoRow2("Heure", dTime)}
                ${infoRow2("Type", "Entretien RH + Technique")}
                ${infoRow2("Recruteur", rec)}
              `)}

              <div style="font-size:14px;font-weight:800;color:${TEXT};margin:0 0 14px 0;">
                Merci de confirmer votre présence :
              </div>

              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding-right:12px;">${btnPrimary(confirmLink, "Confirmer ma présence")}</td>
                  <td>${btnOutline(proposeLink, "Proposer une autre date")}</td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding:0 28px 24px 28px;">
              <div style="height:1px;background:${BORDER};margin:0 0 14px 0;"></div>
              <div style="font-size:12px;color:#9ca3af;line-height:1.6;text-align:center;">
                Optylab - Recrutement & RH<br/>
                Cet email a été envoyé automatiquement, merci de ne pas y répondre directement.
              </div>
            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>
</body>
</html>`;

  await transporter.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: candidateEmail,
    subject,
    html,
  });
}

// 3) email info recruteur (status update)
export async function sendInterviewInfoToRecruiter({
  recruiterEmail,
  recruiterName,
  candidateName,
  jobTitle,
  date,
  time,
  status,
}) {
  if (!recruiterEmail) return;

  const subject = `Update entretien RH+Technique — ${candidateName} (${jobTitle})`;

  // ✅ Anti-undefined / valeurs sûres
  const safe = (v, fallback = "—") => {
    if (v === null || v === undefined) return fallback;
    const s = String(v).trim();
    return s ? s : fallback;
  };

  // ✅ Format date FR si ISO/Date, sinon garde la string
  const formatFRDate = (d) => {
    try {
      if (!d) return "—";
      const dt = d instanceof Date ? d : new Date(d);
      if (Number.isNaN(dt.getTime())) return safe(d);
      return dt.toLocaleDateString("fr-FR", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      });
    } catch {
      return safe(d);
    }
  };

  const formatFRTime = (t) => {
    try {
      if (!t) return "—";
      if (t instanceof Date) {
        return t.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
      }
      const s = String(t);
      if (/^\d{2}:\d{2}/.test(s)) return s.slice(0, 5);
      const dt = new Date(s);
      if (!Number.isNaN(dt.getTime())) {
        return dt.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
      }
      return safe(t);
    } catch {
      return safe(t);
    }
  };

  const GREEN = "#22a06b";
  const LIGHT = "#e9f7ec";
  const BG = "#f3f4f6";
  const TEXT = "#111827";
  const MUTED = "#6b7280";
  const BORDER = "#e5e7eb";

  const recruiter = safe(recruiterName, "—");
  const cand = safe(candidateName, "—");
  const title = safe(jobTitle, "—");
  const sStatus = safe(status, "—");
  const dDate = formatFRDate(date);
  const dTime = formatFRTime(time);

  const statusChip = (() => {
    const up = String(sStatus).toUpperCase();
    if (up.includes("CONFIRM")) return { bg: "#e9f7ec", bd: "#bfe8cc", tx: "#1b7a4f", label: sStatus };
    if (up.includes("ATTENTE") || up.includes("PENDING")) return { bg: "#fff7ed", bd: "#fed7aa", tx: "#9a3412", label: sStatus };
    if (up.includes("ANNUL") || up.includes("REFUS") || up.includes("REJET")) return { bg: "#fef2f2", bd: "#fecaca", tx: "#991b1b", label: sStatus };
    return { bg: "#f3f4f6", bd: "#e5e7eb", tx: "#374151", label: sStatus };
  })();

  const html = `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:${BG};font-family:Arial,Helvetica,sans-serif;color:${TEXT};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:24px 0;">
    <tr>
      <td align="center" style="padding:0 14px;">

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
          style="max-width:720px;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 10px 30px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
           <td style="background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
                    <h1 style="color: #ffffff; margin: 0; font-size: 28px;">Optylab</h1>
                    <p style="color: #e8f5e9; margin: 10px 0 0 0; font-size: 14px;">Plateforme RH Intelligente</p>
                  </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:28px 28px 18px 28px;">
              <div style="font-size:24px;line-height:1.2;font-weight:800;color:${GREEN};margin:0 0 10px 0;">
                Mise à jour — entretien RH + Technique
              </div>

              <div style="font-size:15px;line-height:1.8;color:#374151;">
                Bonjour <b style="color:${TEXT};">${recruiter}</b>,
                <br/>
                Les informations de l’entretien RH + Technique ont été mises à jour.
              </div>

              <!-- Status -->
              <div style="margin-top:14px;">
                <span style="
                  display:inline-block;
                  background:${statusChip.bg};
                  border:1px solid ${statusChip.bd};
                  color:${statusChip.tx};
                  font-weight:800;
                  font-size:12px;
                  padding:8px 12px;
                  border-radius:999px;">
                  Statut : ${statusChip.label}
                </span>
              </div>

              <!-- Job title -->
              <div style="margin-top:14px;font-size:18px;line-height:1.4;font-weight:800;color:${GREEN};">
                ${title}
              </div>

              <!-- Details box -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                style="margin-top:16px;background:${LIGHT};border-radius:14px;padding:18px;">
                <tr>
                  <td style="padding:0;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="font-size:13px;color:${MUTED};padding-bottom:6px;">Candidat</td>
                        <td style="font-size:13px;color:${MUTED};padding-bottom:6px;">Date</td>
                        <td style="font-size:13px;color:${MUTED};padding-bottom:6px;">Heure</td>
                      </tr>
                      <tr>
                        <td style="font-size:16px;font-weight:800;color:${TEXT};padding-right:10px;">
                          ${cand}
                        </td>
                        <td style="font-size:16px;font-weight:800;color:${TEXT};padding-right:10px;">
                          ${dDate}
                        </td>
                        <td style="font-size:16px;font-weight:800;color:${TEXT};">
                          ${dTime}
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <div style="margin-top:16px;font-size:13px;color:${MUTED};line-height:1.7;">
                Merci de vérifier votre calendrier et de suivre la suite du processus depuis la plateforme Optylab.
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:18px 28px 26px 28px;text-align:center;">
              <div style="height:1px;background:${BORDER};margin:0 0 14px 0;"></div>
              <div style="font-size:12px;color:#9ca3af;line-height:1.6;">
                Optylab - Recrutement & RH<br/>
                Cet email a été envoyé automatiquement, merci de ne pas y répondre directement.
              </div>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  await transporter.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: recruiterEmail,
    subject,
    html,
  });
}
// ================================================================
// sendInterviewConfirmedNotificationToCandidate
// Envoyé au candidat quand le responsable valide la date que le
// candidat avait proposé → SIMPLE NOTIFICATION, pas de boutons
// ================================================================
export async function sendInterviewConfirmedNotificationToCandidate({
  candidateEmail, candidateName, jobTitle,
  recruiterName, responsibleName, date, time,
}) {
  if (!candidateEmail) return;

  const subject = `Entretien confirmé — ${jobTitle}`;

  const html = baseTemplate(`
    <h2 style="color:#1f2937;font-size:22px;font-weight:800;margin:0 0 8px;">
      Votre entretien est confirmé !
    </h2>
    <p style="color:#6b7280;font-size:14px;margin:0 0 24px;">
      Bonjour <strong>${candidateName}</strong>,<br/>
      Le responsable <strong>${responsibleName}</strong> a validé votre proposition.
      Votre entretien RH+Technique est définitivement planifié.
    </p>

    ${infoRow("Poste", jobTitle)}
    ${infoRow("Date", date)}
    ${infoRow("Heure", time)}
    ${infoRow("Recruteur", recruiterName)}
    ${infoRow("Responsable", responsibleName)}

    <div style="margin:28px 0;padding:18px 20px;background:#f0fdf4;border-radius:14px;border:1.5px solid #86efac;">
      <p style="margin:0;color:#166534;font-size:14px;font-weight:700;text-align:center;">
         Entretien planifié — Aucune action requise de votre part
      </p>
    </div>

    <p style="color:#9ca3af;font-size:12px;text-align:center;margin-top:12px;">
      Préparez-vous bien et bonne chance !
    </p>
  `);

  await transporter.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: candidateEmail,
    subject,
    html,
  });
}

// ================================================================
// sendRecruiterReviewEmail
// Envoyé au recruteur quand le responsable propose une autre date
// ================================================================
export async function sendRecruiterReviewEmail({
  recruiterEmail,
  recruiterName,
  responsibleName,
  candidateName,
  jobTitle,
  date,
  time,
  token,
}) {
  if (!recruiterEmail) return;

  const FRONTEND_URL = process.env.FRONTEND_URL || process.env.NEXT_PUBLIC_FRONTEND_URL;

  const acceptLink = `${FRONTEND_URL}/recruiter/review-interview/${token}?action=accept`;
  const proposeLink = `${FRONTEND_URL}/recruiter/review-interview/${token}`;

  const subject = `Action requise — ${responsibleName} a proposé une date — ${candidateName}`;

  // ✅ helpers anti-undefined
  const safe = (v, fallback = "—") => {
    if (v === null || v === undefined) return fallback;
    const s = String(v).trim();
    return s ? s : fallback;
  };

  // ✅ TR (une ligne “table”)
  const infoRow2 = (label, value) => `
    <tr>
      <td style="padding:14px 0;font-size:14px;color:#6b7280;width:32%;vertical-align:top;">
        ${label}
      </td>
      <td style="padding:14px 0;font-size:15px;color:#111827;font-weight:800;vertical-align:top;">
        ${safe(value)}
      </td>
    </tr>
  `;

  // ✅ Un seul bloc table (comme la capture)
  const infoTable = (rowsHtml) => `
    <table width="100%" cellpadding="0" cellspacing="0"
      style="background:#e9f7ec;border-radius:14px;padding:4px 22px;margin:18px 0 22px;">
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>
  `;

  const html = baseTemplate(`
    <h2 style="color:#111827;font-size:24px;font-weight:900;margin:0 0 10px;">
      Nouvelle date proposée par le responsable
    </h2>

    <p style="color:#6b7280;font-size:14px;line-height:1.6;margin:0 0 18px;">
      <strong>${safe(responsibleName)}</strong> a proposé un nouveau créneau pour l'entretien de
      <strong>${safe(candidateName)}</strong>. Veuillez accepter ou proposer une autre date.
    </p>

    ${infoTable(`
      ${infoRow2("Candidat", candidateName)}
      ${infoRow2("Poste", jobTitle)}
      ${infoRow2("Date proposée", date)}
      ${infoRow2("Heure", time)}
    `)}

    <div style="margin:22px 0 0;">
      ${btnPrimary(acceptLink, "Accepter cette date")}
      &nbsp;&nbsp;
      <a href="${proposeLink}"
        style="display:inline-block;padding:12px 24px;border:2px solid #22a06b;color:#22a06b;
               border-radius:12px;font-weight:800;text-decoration:none;font-size:14px;">
        Proposer une autre date
      </a>
    </div>
  `);

  await transporter.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: recruiterEmail,
    subject,
    html,
  });
}
export async function sendCandidateReminderEmail(interview, type) {
  // interview لازم فيه: candidateEmail, candidateName, jobTitle, startAt/proposedStart, location, meetingLink
  const to = interview.candidateEmail;
  if (!to) throw new Error("Missing candidateEmail");

  const label =
    type === "D3" ? "3 jours avant" :
      type === "D1" ? "1 jour avant" :
        "3 heures avant";

  const subject = ` Rappel entretien (${label}) — ${interview.jobTitle || "Entretien"}`;

  const start = new Date(interview.startAt || interview.proposedStart || interview.confirmedSlot);
  const when = start.toLocaleString("fr-FR", { dateStyle: "full", timeStyle: "short" });

  const html = `
    <div style="background:#F1FAF4;padding:24px;font-family:Arial">
      <div style="max-width:640px;margin:auto;background:#fff;border:1px solid #E5E7EB;border-radius:18px;overflow:hidden">
        <div style="background:#6CB33F;color:#fff;padding:18px 22px">
          <div style="font-weight:900;font-size:18px">Optylab — Rappel d’entretien</div>
        </div>
        <div style="padding:22px;color:#111827">
          <p>Bonjour <b>${interview.candidateName || "Candidat"}</b>,</p>
          <p>Petit rappel pour votre entretien <b>${interview.jobTitle || ""}</b>.</p>
          <ul>
            <li><b>Date & heure:</b> ${when}</li>
            <li><b>Lieu:</b> ${interview.location || "Optylab / Teams"}</li>
          </ul>
          ${interview.meetingLink ? `
            <p>
              <a href="${interview.meetingLink}"
                 style="display:inline-block;background:#4E8F2F;color:#fff;text-decoration:none;font-weight:800;padding:10px 14px;border-radius:12px">
                Rejoindre la réunion
              </a>
            </p>` : ""
    }
          <p style="color:#6B7280;font-size:13px">
            Si vous avez un empêchement, répondez à cet email pour demander un report.
          </p>
        </div>
      </div>
    </div>
  `;

  await transporter.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to,
    subject,
    html,
  });
}