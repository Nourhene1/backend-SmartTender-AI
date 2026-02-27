// ================================================================
// ficheSubmission.controller.generatePDF.js
//
// GET  /fiche-submissions/:submissionId/pdf
// POST /fiche-submissions/:submissionId/submit  (auto-génère après submit)
//
// npm install pdfkit
// ================================================================

import { ObjectId } from "mongodb";
import PDFDocument from "pdfkit";
import { findSubmissionById, saveSubmissionPdf } from "../models/ficheSubmission.model.js";
import { findFicheById } from "../models/FicheRenseignement.js";
import { getDB } from "../models/db.js";

// ── Palette ─────────────────────────────────────────────────────
const GREEN    = "#1B5E20";   // vert foncé Optylab
const GREEN_MID= "#2E7D32";
const GREEN_L  = "#E8F5E9";   // vert très clair
const GREEN_BG = "#388E3C";   // vert header
const GRAY     = "#555555";
const GRAY_L   = "#888888";
const DARK     = "#1A1A1A";
const LINE_C   = "#BBBBBB";
const WHITE    = "#FFFFFF";

// ── Dimensions A4 (72 dpi → points) ─────────────────────────────
const A4_W   = 595.28;
const A4_H   = 841.89;
const ML     = 52;     // margin left
const MR     = 52;     // margin right
const MT     = 0;      // on gère margin top manuellement
const CW     = A4_W - ML - MR;  // content width = 491.28

// ================================================================
//  HELPERS DESSIN
// ================================================================

/** Ligne avec valeur ou pointillés */
function dotLine(doc, x, y, width, value = "") {
  const safeW = Math.max(width, 10);
  if (value && String(value).trim()) {
    doc.font("Helvetica").fontSize(8.5).fillColor(DARK)
       .text(String(value).trim(), x + 2, y - 10, {
         width: safeW - 4, ellipsis: true, lineBreak: false,
       });
  } else {
    doc.fillColor(LINE_C);
    for (let px = x + 2; px < x + safeW - 6; px += 4) {
      doc.circle(px, y - 2, 0.6).fill();
    }
  }
  doc.moveTo(x, y).lineTo(x + safeW, y)
     .strokeColor(LINE_C).lineWidth(0.4).stroke();
}

/** Case à cocher avec label */
function checkbox(doc, x, y, size, checked, label) {
  const by = y - size;
  if (checked) {
    // Fond vert + croix dessinée manuellement (Helvetica ne supporte pas ✓)
    doc.rect(x, by, size, size).fill(GREEN_MID);
    const cx = x + size / 2;
    const cy = by + size / 2;
    const arm = size * 0.28;
    doc.moveTo(cx - arm, cy).lineTo(cx + arm, cy)
       .strokeColor(WHITE).lineWidth(1.5).stroke();
    doc.moveTo(cx, cy - arm).lineTo(cx, cy + arm)
       .strokeColor(WHITE).lineWidth(1.5).stroke();
  } else {
    doc.rect(x, by, size, size)
       .strokeColor("#AAAAAA").lineWidth(0.5).fillAndStroke(WHITE, "#AAAAAA");
  }
  if (label) {
    doc.font("Helvetica").fontSize(8).fillColor(DARK)
       .text(label, x + size + 4, by + 1, { lineBreak: false });
  }
}

/** En-tête de section numérotée avec bandeau vert clair */
function sectionHeader(doc, y, num, title) {
  // Bandeau vert clair
  doc.rect(ML - 8, y - 2, CW + 16, 16).fill(GREEN_L);
  // Trait gauche vert
  doc.rect(ML - 8, y - 2, 4, 16).fill(GREEN_MID);
  // Numéro
  doc.font("Helvetica-Bold").fontSize(9.5).fillColor(GREEN)
     .text(`${num}`, ML, y, { lineBreak: false });
  const nw = doc.widthOfString(`${num}`) + 4;
  // Tiret + Titre
  doc.font("Helvetica-Bold").fontSize(9.5).fillColor(DARK)
     .text(`-  ${title}`, ML + nw, y, { lineBreak: false });
  return y + 20;
}

/** Tableau avec header + lignes de données */
function tableGrid(doc, x, y, colWidths, rowH, hdrH, headers, rows) {
  const totalW = colWidths.reduce((a, b) => a + b, 0);
  const totalH = hdrH + rowH * rows.length;

  // Header background
  doc.rect(x, y, totalW, hdrH).fill(GREEN_L);
  // All borders
  doc.rect(x, y, totalW, totalH).strokeColor("#999999").lineWidth(0.5).stroke();
  // Row lines
  let ry = y + hdrH;
  for (let i = 0; i < rows.length - 1; i++) {
    doc.moveTo(x, ry + rowH).lineTo(x + totalW, ry + rowH)
       .strokeColor("#CCCCCC").lineWidth(0.3).stroke();
    ry += rowH;
  }
  // Column lines
  let cx = x;
  for (let i = 0; i < colWidths.length - 1; i++) {
    cx += colWidths[i];
    doc.moveTo(cx, y).lineTo(cx, y + totalH)
       .strokeColor("#999999").lineWidth(0.4).stroke();
  }
  // Header text
  cx = x;
  for (let i = 0; i < headers.length; i++) {
    doc.font("Helvetica-Bold").fontSize(7.5).fillColor(GREEN_MID)
       .text(headers[i], cx + 3, y + 3, {
         width: colWidths[i] - 6, lineBreak: false, ellipsis: true,
       });
    cx += colWidths[i];
  }
  // Row data
  ry = y + hdrH;
  for (const row of rows) {
    cx = x;
    for (let i = 0; i < colWidths.length; i++) {
      const val = row[i] ? String(row[i]) : "";
      doc.font("Helvetica").fontSize(7.5).fillColor(DARK)
         .text(val, cx + 3, ry + 3, {
           width: colWidths[i] - 6, lineBreak: false, ellipsis: true,
         });
      cx += colWidths[i];
    }
    ry += rowH;
  }
  return y + totalH + 6;
}

// ================================================================
//  UTILITAIRES DONNÉES
// ================================================================

/** Cherche une réponse par hint dans le label */
function getVal(answers, hint) {
  const h = hint.toLowerCase();
  for (const a of answers) {
    if ((a.label || "").toLowerCase().includes(h)) {
      const v = a.value;
      if (v === null || v === undefined) return "";
      if (typeof v === "object") return ""; // objets gérés séparément
      return String(v).trim();
    }
  }
  return "";
}

/** Cherche la réponse entière (pour scale_group etc.) */
function getAns(answers, ...hints) {
  for (const hint of hints) {
    const h = hint.toLowerCase();
    for (const a of answers) {
      if ((a.label || "").toLowerCase().includes(h)) return a;
    }
  }
  // Fallback: chercher par type scale_group et valeur array non vide
  return {};
}

/** Cherche TOUTES les scale_group answers pour tables */
function getScaleGroupAns(answers, ...hints) {
  // 1. Chercher par label
  for (const hint of hints) {
    const h = hint.toLowerCase();
    for (const a of answers) {
      if ((a.label || "").toLowerCase().includes(h) && Array.isArray(a.value) && a.value.length > 0) {
        return a;
      }
    }
  }
  // 2. Chercher par type scale_group
  for (const hint of hints) {
    const h = hint.toLowerCase();
    for (const a of answers) {
      if (a.type === "scale_group" && Array.isArray(a.value) && a.value.length > 0) {
        // Vérifier si un des éléments a une clé liée au hint
        const firstItem = a.value[0] || {};
        const keys = Object.keys(firstItem).join(" ").toLowerCase();
        if (h.includes("cursus") && (keys.includes("etabli") || keys.includes("diplome"))) return a;
        if (h.includes("expér") && (keys.includes("societ") || keys.includes("emploi"))) return a;
        if (h.includes("lingui") && (keys.includes("item") || keys.includes("niveau"))) return a;
        if (h.includes("informat") && (keys.includes("item") || keys.includes("niveau"))) return a;
      }
    }
  }
  return {};
}

/** Rows pour tableau : gère tous les formats possibles de stockage */
function safeRows(ans, keys, count = 4) {
  const rows = [];
  const val = ans?.value;

  if (Array.isArray(val)) {
    for (const item of val.slice(0, count)) {
      if (item === null || item === undefined) continue;
      if (typeof item === "object") {
        // Format objet direct: { etablissement: "...", periode: "..." }
        const row = keys.map(k => {
          const v = item[k];
          if (v === null || v === undefined) return "";
          if (typeof v === "object") return Object.values(v).filter(x => x).join(" - ");
          return String(v).trim();
        });
        if (row.some(v => v)) rows.push(row); // ignorer lignes 100% vides
      }
    }
  } else if (val && typeof val === "object" && !Array.isArray(val)) {
    // Format objet imbriqué: { "0": {etablissement:...}, "1": {...} }
    const entries = Object.values(val);
    for (const item of entries.slice(0, count)) {
      if (item && typeof item === "object") {
        const row = keys.map(k => String(item[k] ?? "").trim());
        if (row.some(v => v)) rows.push(row);
      }
    }
  }

  while (rows.length < count) rows.push(keys.map(() => ""));
  return rows;
}

/** Cherche aussi des answers individuels par label pour reconstruire tableau */
function buildTableFromIndividualAnswers(answers, prefixes, keys, count = 4) {
  // Cherche des réponses comme "Établissement 1", "Période 1", etc.
  const rows = [];
  for (let i = 1; i <= count; i++) {
    const row = keys.map((k, ki) => {
      const prefix = prefixes[ki] || k;
      const ans = answers.find(a =>
        (a.label || "").toLowerCase().includes(prefix.toLowerCase()) &&
        (a.label || "").includes(String(i))
      );
      return ans ? String(ans.value || "").trim() : "";
    });
    rows.push(row);
  }
  return rows;
}

/** Fallback : lit une valeur dans la structure candidature */
function fromCand(cand, ...paths) {
  for (const path of paths) {
    const parts = path.split(".");
    let cur = cand;
    for (const p of parts) { cur = cur?.[p]; }
    const s = String(cur ?? "").trim();
    if (s && s !== "null" && s !== "undefined") return s;
  }
  return "";
}

/** Résolution lettre → texte complet pour quiz */
function resolveOptionLabel(fiche, questionLabel, val) {
  if (!fiche?.questions || !val) return String(val);
  const q = fiche.questions.find(q =>
    (q.label || "").toLowerCase().includes(questionLabel.toLowerCase())
  );
  if (!q?.options) return String(val);
  const opt = q.options.find(o => o.id === String(val) || o.label === String(val));
  return opt?.label || String(val);
}

// ================================================================
//  CHARGEMENT DONNÉES COMPLET (fiche + candidature)
// ================================================================

async function loadAllData(submissionId) {
  const submission = await findSubmissionById(submissionId);
  if (!submission) return null;

  const fiche = submission.ficheId
    ? await findFicheById(submission.ficheId.toString())
    : null;

  // Map questionId → question (par q.id ET q._id)
  const qMap = {};
  const questions = fiche?.questions || [];
  questions.forEach(q => {
    if (q.id)  qMap[String(q.id)]  = q;
    if (q._id) qMap[String(q._id)] = q;
  });

  // Enrichir answers avec labels et types
  const answers = (submission.answers || []).map(a => {
    const qid = String(a.questionId || "");
    const q = qMap[qid];
    return {
      ...a,
      label: q?.label || a.label || "",
      type:  q?.type  || "text",
    };
  });

  // ── Charger TOUTE la candidature ──────────────────────────────
  let cand = null;
  try {
    cand = await getDB().collection("candidatures").findOne(
      { _id: new ObjectId(submission.candidatureId) },
      { projection: { fullName: 1, prenom: 1, nom: 1, personalInfoForm: 1, extracted: 1 } }
    );
  } catch {}

  const p = cand?.extracted?.parsed || {};  // shortcut vers extracted.parsed

  // ── Nom complet ───────────────────────────────────────────────
  const candidateName =
    fromCand(cand, "fullName", "extracted.parsed.full_name") ||
    [
      fromCand(cand, "personalInfoForm.prenom", "extracted.parsed.prenom", "extracted.parsed.first_name"),
      fromCand(cand, "personalInfoForm.nom",    "extracted.parsed.nom",    "extracted.parsed.last_name"),
    ].filter(Boolean).join(" ") || "";

  // Séparer fullName → prénom / nom
  const parts    = candidateName.trim().split(/\s+/);
  const _last    = parts.length > 1 ? parts[parts.length - 1] : candidateName;
  const _first   = parts.length > 1 ? parts.slice(0, -1).join(" ") : "";

  // ── Données personnelles (fiche > candidature) ────────────────
  const candData = {
    nom:           fromCand(cand,"personalInfoForm.nom","extracted.manual.nom","extracted.parsed.nom","extracted.parsed.last_name")   || _last,
    prenom:        fromCand(cand,"personalInfoForm.prenom","extracted.manual.prenom","extracted.parsed.prenom","extracted.parsed.first_name") || _first,
    email:         fromCand(cand,"personalInfoForm.email","extracted.manual.email","extracted.parsed.email","extracted.personal_info.email"),
    telephone:     fromCand(cand,"personalInfoForm.telephone","extracted.manual.telephone","extracted.parsed.telephone","extracted.personal_info.phone"),
    adresse:       fromCand(cand,"personalInfoForm.adresse","extracted.manual.adresse","extracted.parsed.adresse","extracted.personal_info.address"),
    codePostal:    fromCand(cand,"personalInfoForm.codePostal","extracted.parsed.code_postal"),
    dateNaissance: fromCand(cand,"personalInfoForm.dateNaissance","extracted.parsed.date_naissance","extracted.parsed.dateNaissance"),
    lieuNaissance: fromCand(cand,"personalInfoForm.lieuNaissance","extracted.parsed.lieu_naissance","extracted.parsed.lieuNaissance"),
    cin:           fromCand(cand,"personalInfoForm.cin","extracted.parsed.cin"),
    situation:     fromCand(cand,"personalInfoForm.situationFamiliale","extracted.parsed.situation_familiale"),
    nbEnfants:     fromCand(cand,"personalInfoForm.nbEnfants","extracted.parsed.nb_enfants"),
    permis:        fromCand(cand,"personalInfoForm.permis","extracted.parsed.permis"),
    // Champs bruts sans fallback fullName (pour éviter doublon)
    _rawNom:    fromCand(cand,"personalInfoForm.nom","extracted.manual.nom","extracted.parsed.nom","extracted.parsed.last_name"),
    _rawPrenom: fromCand(cand,"personalInfoForm.prenom","extracted.manual.prenom","extracted.parsed.prenom","extracted.parsed.first_name"),
  };

  // ── Cursus Universitaires depuis extracted.parsed.formation[] ──
  // Structure: [{ etablissement, periode, diplome, specialite }]
  const rawFormation = Array.isArray(p.formation) ? p.formation : [];
  const candCursus = rawFormation.map(f => {
    // Période depuis debut/fin si pas de champ periode direct
    let periode = String(f?.periode || f?.period || f?.annee || f?.duree || "").trim();
    if (!periode && (f?.debut || f?.date_debut)) {
      const debut = String(f?.debut || f?.date_debut || "");
      const fin   = String(f?.fin   || f?.date_fin   || f?.date_obtention || "");
      periode = fin ? `${debut} – ${fin}` : debut;
    }
    return [
      String(f?.etablissement || f?.school || f?.institution || f?.universite || "").trim(),
      periode,
      String(f?.diplome || f?.degree || f?.diplôme || f?.titre_diplome || "").trim(),
      String(f?.specialite || f?.field || f?.domaine || f?.filiere || "").trim(),
    ];
  });
  while (candCursus.length < 4) candCursus.push(["","","",""]);

  // ── Expériences professionnelles depuis extracted.parsed ──────
  // Tous les noms de champs possibles selon la version du parseur FastAPI
  const rawExp =
    (Array.isArray(p.experience_professionnelle) ? p.experience_professionnelle : null) ||  // ✅ vrai nom FastAPI
    (Array.isArray(p.experience)                 ? p.experience                 : null) ||
    (Array.isArray(p.experiences)                ? p.experiences                : null) ||
    (Array.isArray(p.parcours_pro)               ? p.parcours_pro               : null) ||
    (Array.isArray(p.emplois)                    ? p.emplois                    : null) ||
    (Array.isArray(p.professional_experience)    ? p.professional_experience    : null) ||
    (Array.isArray(p.work_experience)            ? p.work_experience            : null) ||
    [];

  const candExp = rawExp.map(e => {
    // Période — tous formats possibles
    let periode = "";
    if (e?.periode || e?.period || e?.dates || e?.annee || e?.duree) {
      periode = String(e?.periode || e?.period || e?.dates || e?.annee || e?.duree || "").trim();
    } else if (e?.debut || e?.date_debut || e?.start || e?.date_debut_poste) {
      const debut = String(e?.debut || e?.date_debut || e?.start || e?.date_debut_poste || "");
      const fin   = String(e?.fin   || e?.date_fin   || e?.end   || e?.date_fin_poste   || "présent");
      periode = `${debut} – ${fin}`.trim();
    }

    return [
      periode,
      String(e?.entreprise || e?.societe   || e?.company    || e?.employeur  ||
             e?.employer   || e?.organisation || e?.org      || "").trim(),
      String(e?.poste      || e?.emploi    || e?.titre_poste|| e?.job        ||
             e?.titre      || e?.position  || e?.role       || e?.function   || "").trim(),
      String(e?.salaire    || e?.salary    || e?.remuneration|| "").trim(),
      String(e?.motif      || e?.motif_depart|| e?.raison   || e?.reason     || "").trim(),
    ];
  });
  while (candExp.length < 4) candExp.push(["","","","",""]);

  console.log("🔍 Parsed top-level keys:", JSON.stringify(Object.keys(p)));
  console.log("🔍 Experience rawExp sample:", JSON.stringify(rawExp?.slice(0,1)));
  if (rawExp.length === 0) {
    // Tenter de chercher dans tous les champs array de parsed
    const allArrayFields = Object.entries(p)
      .filter(([k, v]) => Array.isArray(v) && v.length > 0)
      .map(([k, v]) => `${k}[0]=${JSON.stringify(Object.keys(v[0] || {}))}`);
    console.log("🔍 All array fields in parsed:", allArrayFields.join(" | "));
  }

  // ── Langues depuis extracted.parsed.langues[] ─────────────────
  const rawLangues =
    (Array.isArray(p.langues)    ? p.langues    : null) ||
    (Array.isArray(p.languages)  ? p.languages  : null) || [];

  // Mapper niveau texte → chiffre 0-4
  function mapNiveau(niv) {
    const n = String(niv || "").toLowerCase().trim();
    if (!n || n === "néant" || n === "aucun") return "0";
    if (n === "débutant" || n === "basique" || n === "basic") return "1";
    if (n === "intermédiaire" || n === "intermediate" || n === "moyen") return "2";
    if (n === "avancé" || n === "advanced" || n === "courant" || n === "bilingue") return "3";
    if (n === "expert" || n === "natif" || n === "native" || n === "maternel" || n === "professionnel") return "4";
    // Si c'est déjà un chiffre
    if (/^[0-4]$/.test(n)) return n;
    // Sinon garder le texte brut
    return String(niv || "");
  }

  const candLangues = rawLangues.map(l => ({
    item:   String(l?.langue || l?.language || l?.nom || l?.name || ""),
    niveau: mapNiveau(l?.niveau || l?.level || l?.maitrise || ""),
  }));

  // ── Compétences informatiques depuis extracted.parsed ─────────
  // competences est un Object {langages_prog: [], frameworks: [], outils: [], ...}
  const rawSkillsArr = [];
  if (p.competences && typeof p.competences === "object" && !Array.isArray(p.competences)) {
    // Aplatir toutes les sous-listes en une seule liste
    for (const [cat, vals] of Object.entries(p.competences)) {
      if (Array.isArray(vals)) {
        vals.forEach(v => {
          const name = typeof v === "string" ? v : (v?.nom || v?.name || String(v));
          if (name) rawSkillsArr.push({ item: name, niveau: "" });
        });
      }
    }
  }
  const rawSkillsDirect =
    (Array.isArray(p.competences_informatiques) ? p.competences_informatiques : null) ||
    (Array.isArray(p.skills)                    ? p.skills                    : null) ||
    (Array.isArray(p.outils)                    ? p.outils                    : null) || [];

  const allRawSkills = rawSkillsArr.length > 0 ? rawSkillsArr : rawSkillsDirect;
  const candSkills = allRawSkills.map(s => ({
    item:   String(s?.outil || s?.tool || s?.competence || s?.skill || s?.nom || s?.item || ""),
    niveau: mapNiveau(s?.niveau || s?.level || ""),
  }));

  console.log("📋 PDF loadAllData:", {
    candidateName,
    answersCount: answers.length,
    cursusFromExtracted: candCursus.filter(r => r.some(v => v)).length,
    expFromExtracted: candExp.filter(r => r.some(v => v)).length,
    languesFromExtracted: candLangues.length,
    labels: answers.map(a => `[${a.type}] ${a.label}`),
  });

  return { submission, fiche, answers, candidateName, candData, candCursus, candExp, candLangues, candSkills };
}

// ================================================================
//  ENDPOINT GET  /fiche-submissions/:submissionId/pdf
// ================================================================
export async function generateFichePdfController(c) {
  try {
    const { submissionId } = c.req.param();
    if (!ObjectId.isValid(submissionId)) {
      return c.json({ message: "submissionId invalide" }, 400);
    }

    // ?regenerate=true force la re-génération (vider le cache DB)
    const forceRegen = c.req.query("regenerate") === "true";

    const data = await loadAllData(submissionId);
    if (!data) return c.json({ message: "Submission introuvable" }, 404);

    // Utiliser le PDF stocké seulement s'il est valide (> 5KB) et pas de force regen
    const storedPdf = data.submission?.pdf?.data;
    const storedSize = storedPdf ? (Buffer.isBuffer(storedPdf) ? storedPdf.length : storedPdf.length || 0) : 0;
    const isValidCache = !forceRegen && storedSize > 5000;

    if (isValidCache) {
      const safeName = (data.candidateName || "fiche").replace(/[^\w\s-]/g, "").replace(/\s+/g, "_");
      return new Response(storedPdf, {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="Fiche_${safeName}.pdf"`,
        },
      });
    }

    // Générer le PDF
    const pdfBuf = await buildPdfBuffer(data);
    const safeName = (data.candidateName || "fiche").replace(/[^\w\s-]/g, "").replace(/\s+/g, "_");

    // Stocker le nouveau PDF en DB (remplace l'ancien)
    try { await saveSubmissionPdf(submissionId, pdfBuf); } catch {}

    return new Response(pdfBuf, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="Fiche_${safeName}.pdf"`,
        "Content-Length": String(pdfBuf.length),
      },
    });
  } catch (err) {
    console.error("❌ generateFichePdfController:", err);
    return c.json({ message: "Erreur génération PDF", error: err.message }, 500);
  }
}

// ================================================================
//  GÉNÉRATION + STOCKAGE (appelé après submit)
// ================================================================
export async function generateAndStorePdf(submissionId) {
  try {
    const data = await loadAllData(submissionId);
    if (!data) return null;
    const buf = await buildPdfBuffer(data);
    await saveSubmissionPdf(submissionId, buf);
    return buf;
  } catch (err) {
    console.error("❌ generateAndStorePdf:", err);
    return null;
  }
}

// ================================================================
//  CONSTRUCTION PDF EN MÉMOIRE
// ================================================================
async function buildPdfBuffer({ submission, fiche, answers, candidateName, candData, candCursus, candExp, candLangues, candSkills }) {
  const doc = new PDFDocument({ size: "A4", margin: 0, autoFirstPage: true });
  const chunks = [];
  doc.on("data", c => chunks.push(c));
  await new Promise((res, rej) => {
    doc.on("end", res);
    doc.on("error", rej);
    buildPDF(doc, { answers, fiche, candidateName, candData, candCursus, candExp, candLangues, candSkills, submission });
    doc.end();
  });
  return Buffer.concat(chunks);
}

// ================================================================
//  CONSTRUCTION DES PAGES
// ================================================================
export function buildPDF(doc, { answers, fiche, candidateName, candData = {}, candCursus = [], candExp = [], candLangues = [], candSkills = [], submission }) {

  // Helper : valeur depuis fiche sinon fallback candidature
  const fv = (hint, fallback = "") =>
    getVal(answers, hint) || fallback || "";

  // ══════════════════════════════════════════════════════════
  //  PAGE 1
  // ══════════════════════════════════════════════════════════
  let y = 0;

  // ── HEADER VERT ─────────────────────────────────────────
  const HDR_H = 80;
  doc.rect(0, 0, A4_W, HDR_H).fill(GREEN_BG);

  // Logo
  doc.font("Helvetica-Bold").fontSize(24).fillColor(WHITE)
     .text("Optylab", ML, 18, { lineBreak: false });
  doc.font("Helvetica").fontSize(8.5).fillColor("rgba(255,255,255,0.75)")
     .text("Les experts de la vision", ML, 46, { lineBreak: false });

  // GRH-0003 à droite
  doc.font("Helvetica").fontSize(8).fillColor("rgba(255,255,255,0.65)")
     .text("GRH-0003", 0, 28, { width: A4_W - MR, align: "right", lineBreak: false });

  y = HDR_H + 14;

  // ── TITRE ────────────────────────────────────────────────
  doc.font("Helvetica-Bold").fontSize(19).fillColor(DARK)
     .text("Fiche de Renseignement", 0, y, { width: A4_W, align: "center", lineBreak: false });
  y += 24;

  // Nom du candidat en vert sous le titre
  if (candidateName) {
    doc.font("Helvetica-Bold").fontSize(12).fillColor(GREEN_MID)
       .text(candidateName, 0, y, { width: A4_W, align: "center", lineBreak: false });
    y += 18;
  }

  // Ligne décorative
  const lineW = 180;
  doc.rect((A4_W - lineW) / 2, y, lineW, 2).fill(GREEN_MID);
  y += 12;

  // ══════════════════════════════════════════════════════════
  // SECTION 1 — Données personnelles
  // ══════════════════════════════════════════════════════════
  y = sectionHeader(doc, y, "1", "Données personnelles :") + 2;

  // Nom / Prénom (fiche d'abord → candidature en fallback)
  // Nom / Prénom — priorité: fiche → champs individuels candidature → split fullName
  let pdfNom    = fv("nom");
  let pdfPrenom = fv("prénom") || fv("prenom");

  if (!pdfNom || !pdfPrenom) {
    // Essayer champs individuels de la candidature
    const indivNom    = candData._rawNom    || "";
    const indivPrenom = candData._rawPrenom || "";
    if (!pdfNom    && indivNom)    pdfNom    = indivNom;
    if (!pdfPrenom && indivPrenom) pdfPrenom = indivPrenom;
  }

  if (!pdfNom || !pdfPrenom) {
    // Dernier recours: split du candidateName "Prénom Nom"
    const nameParts = candidateName.trim().split(/\s+/);
    if (nameParts.length >= 2) {
      if (!pdfPrenom) pdfPrenom = nameParts.slice(0, -1).join(" ");
      if (!pdfNom)    pdfNom    = nameParts[nameParts.length - 1];
    } else {
      if (!pdfNom) pdfNom = candidateName;
    }
  }

  doc.font("Helvetica").fontSize(9).fillColor(GRAY)
     .text("Nom :", ML, y, { lineBreak: false });
  dotLine(doc, ML + 32, y + 10, CW * 0.38, pdfNom);

  doc.text("Prénom :", ML + CW * 0.5, y, { lineBreak: false });
  dotLine(doc, ML + CW * 0.5 + 50, y + 10, CW * 0.38, pdfPrenom);
  y += 22;

  // Date & lieu de naissance
  doc.text("Date & lieu de naissance :", ML, y, { lineBreak: false });
  dotLine(doc, ML + 142, y + 10, 55, fv("date de naissance", candData.dateNaissance));
  doc.text("à", ML + 204, y, { lineBreak: false });
  dotLine(doc, ML + 215, y + 10, 65, fv("lieu de naissance", candData.lieuNaissance));
  doc.text("Pays :", ML + CW * 0.65, y, { lineBreak: false });
  dotLine(doc, ML + CW * 0.65 + 38, y + 10, CW * 0.28, fv("pays"));
  y += 22;

  // CIN
  doc.text("Numéro CIN", ML, y, { lineBreak: false });
  dotLine(doc, ML + 72, y + 10, 95, fv("cin", candData.cin) || fv("numéro de cin", candData.cin));
  doc.text("Délivré le", ML + 176, y, { lineBreak: false });
  dotLine(doc, ML + 234, y + 10, 50, "");
  doc.text("à", ML + 292, y, { lineBreak: false });
  dotLine(doc, ML + 302, y + 10, CW - 300, "");
  y += 22;

  // Adresse
  doc.text("Adresse :", ML, y, { lineBreak: false });
  dotLine(doc, ML + 52, y + 10, CW - 52, fv("adresse", candData.adresse));
  y += 22;

  // Code postal
  doc.text("Code Postal :", ML, y, { lineBreak: false });
  dotLine(doc, ML + 68, y + 10, CW, fv("code postal", candData.codePostal));
  y += 22;

  // Tel / Email
  // Nettoyer tel (+216 en double) et email (# en tête)
  const rawTel   = fv("téléphone", candData.telephone) || fv("telephone", candData.telephone);
  const cleanTel = rawTel.replace(/^\(\+216\)\s*/,"").replace(/^\+216\s*/,"").trim();
  const rawEmail = fv("e-mail", candData.email) || fv("email", candData.email);
  const cleanEmail = rawEmail.replace(/^#/,"").trim();

  doc.text("Téléphone portable (+216)", ML, y, { lineBreak: false });
  dotLine(doc, ML + 140, y + 10, CW * 0.32, cleanTel);
  doc.text("Adresse e-mail :", ML + CW * 0.54, y, { lineBreak: false });
  dotLine(doc, ML + CW * 0.54 + 88, y + 10, CW * 0.34, cleanEmail);
  y += 22;

  // Permis
  doc.text("Permis à conduire :", ML, y, { lineBreak: false });
  dotLine(doc, ML + 106, y + 10, CW * 0.3, fv("permis", candData.permis));
  doc.text("Date d'obtention :", ML + CW * 0.5, y, { lineBreak: false });
  dotLine(doc, ML + CW * 0.5 + 100, y + 10, CW * 0.38, "");
  y += 24;

  // Situation familiale
  doc.font("Helvetica").fontSize(9).fillColor(GRAY)
     .text("Situation Familiale :", ML, y);
  y += 14;
  // Situation familiale — chercher dans answers (radio) ou candidature
  let situVal = "";
  // 1. Chercher l'answer brute (peut être ID option ou texte)
  const situAns = answers.find(a => (a.label || "").toLowerCase().includes("situation"));
  if (situAns) {
    const v = situAns.value;
    if (typeof v === "string") situVal = v;
    else if (Array.isArray(v)) situVal = v[0] || "";
    else if (v?.label) situVal = v.label;
  }
  // 2. Résoudre ID → label via les options de la fiche
  if (situVal && /^[a-f0-9]{24}$/i.test(situVal) && fiche) {
    const situQ = (fiche.questions || []).find(q =>
      (q.label || "").toLowerCase().includes("situation")
    );
    const opt = situQ?.options?.find(o => o.id === situVal || String(o._id) === situVal);
    if (opt) situVal = opt.label || situVal;
  }
  // 3. Fallback candidature
  if (!situVal) situVal = candData.situation || "";
  console.log("🔍 Situation familiale value:", JSON.stringify(situVal));
  const situ = situVal.toLowerCase();
  const situOpts = [
    ["Célibataire", "célibat", ML + 20],
    ["Marié(e)",    "marié",   ML + 110],
    ["Divorcé(e)",  "divorcé", ML + 196],
    ["Veuf (ve)",   "veuf",    ML + 286],
  ];
  for (const [lbl, key, bx] of situOpts) {
    checkbox(doc, bx, y + 6, 7, situ.includes(key), lbl);
  }
  y += 20;

  // Nombre d'enfants
  doc.font("Helvetica").fontSize(9).fillColor(GRAY)
     .text("Nombre d'enfants :", ML, y, { lineBreak: false });
  dotLine(doc, ML + 102, y + 10, 60, fv("enfant", candData.nbEnfants));
  y += 26;

  // ══════════════════════════════════════════════════════════
  // SECTION 2 — Cursus Universitaires
  // ══════════════════════════════════════════════════════════
  y = sectionHeader(doc, y, "2", "Cursus Universitaires :") + 2;
  const cCols = [CW*0.28, CW*0.24, CW*0.28, CW*0.20];
  const cHdrs = ["Etablissement", "Période du...ou...", "Diplômes obtenus", "Spécialité"];
  // 1. Essayer depuis les answers de la fiche
  const cursusAns = getScaleGroupAns(answers, "cursus", "universitaire", "formation", "études");
  let cursusData = safeRows(cursusAns, ["etablissement", "periode", "diplome", "specialite"], 4);
  if (!cursusData.some(r => r.some(v => v)))
    cursusData = safeRows(cursusAns, ["school","period","degree","field"], 4);
  if (!cursusData.some(r => r.some(v => v)))
    cursusData = buildTableFromIndividualAnswers(answers, ["etablissement","période","diplôme","spécialité"], ["etablissement","periode","diplome","specialite"], 4);
  // 2. Fallback → extracted.parsed.formation[] de la candidature
  if (!cursusData.some(r => r.some(v => v)) && candCursus.some(r => r.some(v => v))) {
    cursusData = candCursus;
  }
  y = tableGrid(doc, ML, y, cCols, 14, 16, cHdrs, cursusData);

  // ══════════════════════════════════════════════════════════
  // SECTION 3 — Expériences professionnelles
  // ══════════════════════════════════════════════════════════
  y = sectionHeader(doc, y, "3", "Expériences professionnelles et Stages :") + 2;
  const eCols = [CW*0.19, CW*0.20, CW*0.20, CW*0.18, CW*0.23];
  const eHdrs = ["Période\ndu...ou...", "Société", "Emploi / Stage", "Salaire Net", "Motif de départ\n(Si Emploi)"];
  // 1. Essayer depuis les answers de la fiche
  const expAns = getScaleGroupAns(answers, "expériences", "experience", "stage", "professionnel");
  let expData = safeRows(expAns, ["periode","societe","emploi","salaire","motif"], 4);
  if (!expData.some(r => r.some(v => v)))
    expData = safeRows(expAns, ["period","company","job","salary","reason"], 4);
  if (!expData.some(r => r.some(v => v)))
    expData = buildTableFromIndividualAnswers(answers, ["période","société","emploi","salaire","motif"], ["periode","societe","emploi","salaire","motif"], 4);
  // 2. Fallback → extracted.parsed.experience[] de la candidature
  if (!expData.some(r => r.some(v => v)) && candExp.some(r => r.some(v => v))) {
    expData = candExp;
  }
  y = tableGrid(doc, ML, y, eCols, 14, 18, eHdrs, expData);

  // Footer page 1
  doc.font("Helvetica").fontSize(7).fillColor(GRAY_L)
     .text(`Page 1 / 2  —  ${fiche?.title || "Fiche de Renseignement"}  —  Confidentiel`,
           0, A4_H - 22, { width: A4_W, align: "center", lineBreak: false });

  // ══════════════════════════════════════════════════════════
  //  PAGE 2
  // ══════════════════════════════════════════════════════════
  doc.addPage({ size: "A4", margin: 0 });
  y = 0;

  // Mini header vert page 2
  const HDR2 = 38;
  doc.rect(0, 0, A4_W, HDR2).fill(GREEN_BG);
  doc.font("Helvetica-Bold").fontSize(14).fillColor(WHITE)
     .text("Optylab", ML, 11, { lineBreak: false });
  if (candidateName) {
    doc.font("Helvetica").fontSize(9).fillColor("rgba(255,255,255,0.85)")
       .text(candidateName, 0, 13, { width: A4_W, align: "center", lineBreak: false });
  }
  doc.font("Helvetica").fontSize(8).fillColor("rgba(255,255,255,0.55)")
     .text("GRH-0003", 0, 15, { width: A4_W - MR, align: "right", lineBreak: false });
  y = HDR2 + 12;

  // ── SECTION 4 ──────────────────────────────────────────
  y = sectionHeader(doc, y, "4", "Connaissez-vous la société OPTYLAB ?") + 2;
  const val4 = fv("connaissez");
  for (let i = 0; i < 2; i++) {
    const chunk = val4.substring(i * 90, (i + 1) * 90);
    dotLine(doc, ML, y + 10, CW, chunk);
    y += 15;
  }
  y += 6;

  // ── SECTION 5 ──────────────────────────────────────────
  y = sectionHeader(doc, y, "5", "Quelle valeur ajoutée que vous pensez pouvoir apporter à la société OPTYLAB ?") + 2;
  const val5 = fv("valeur");
  for (let i = 0; i < 2; i++) {
    const chunk = val5.substring(i * 90, (i + 1) * 90);
    dotLine(doc, ML, y + 10, CW, chunk);
    y += 15;
  }
  y += 6;

  // ── SECTION 6 — Source de l'offre ──────────────────────
  y = sectionHeader(doc, y, "6", "Comment avez-vous trouvé notre offre ?") + 4;
  const offreVal = fv("trouvé").toLowerCase() || fv("offre").toLowerCase();
  const offreOpts = [["LinkedIn","linkedin"],["Tanit job","tanit"],["Keejob","keejob"],["Autres","autre"]];
  let bx = ML + 10;
  for (const [lbl, key] of offreOpts) {
    checkbox(doc, bx, y + 6, 7, offreVal.includes(key), lbl);
    bx += 90;
  }
  y += 24;

  // ── SECTION 7 — Raisons de quitter ─────────────────────
  y = sectionHeader(doc, y, "7", "Classer par ordre de période les raisons qui peuvent un jour vous pousser à quitter OPTYLAB ?") + 4;
  const raisons = fv("quitter").toLowerCase() || fv("raisons").toLowerCase();
  const raisonsPairs = [
    ["Manque de motivation.", "motivation",  "Ambiance au Travail.", "ambiance"],
    ["Désir d'un meilleur salaire.", "salaire",  "Manque d'encadrement.", "encadrement"],
    ["Nécessité Familiale", "familiale", "Autres (à préciser)...", "autres"],
  ];
  for (const [ll, lk, rl, rk] of raisonsPairs) {
    checkbox(doc, ML + 10, y + 6, 7, raisons.includes(lk), ll);
    checkbox(doc, ML + CW * 0.5, y + 6, 7, raisons.includes(rk), rl);
    y += 16;
  }
  y += 6;

  // ── SECTION 8 — Connaissances Linguistiques ────────────
  y = sectionHeader(doc, y, "8", "Connaissances Linguistiques :") + 2;
  doc.font("Helvetica-Oblique").fontSize(8).fillColor(GRAY_L)
     .text("(Mettez le code qui correspond à votre niveau)", ML + 20, y - 4);
  y += 8;

  const langAns   = getScaleGroupAns(answers, "linguistique", "langue", "language");
  let langItems = Array.isArray(langAns?.value) ? langAns.value : [];
  // Fallback → extracted.parsed.langues[]
  if (langItems.length === 0 && candLangues.length > 0) langItems = candLangues;

  function getLangNiv(name) {
    for (const li of langItems) {
      if (li && String(li.item || "").toLowerCase().includes(name.toLowerCase()))
        return String(li.niveau ?? "");
    }
    return "";
  }

  const stdLangs = ["Français", "Anglais"];
  let lx = ML + 10;
  doc.font("Helvetica").fontSize(9).fillColor(GRAY);
  for (const lang of stdLangs) {
    const niv = getLangNiv(lang);
    const lw = doc.widthOfString(lang + " :");
    doc.text(lang + " :", lx, y, { lineBreak: false });
    // Case niveau
    doc.rect(lx + lw + 5, y - 2, 20, 14)
       .fill(niv ? GREEN_L : "#F5F5F5")
       .strokeColor("#AAAAAA").lineWidth(0.5).stroke();
    if (niv) {
      doc.font("Helvetica-Bold").fontSize(9).fillColor(GREEN_MID)
         .text(niv, lx + lw + 8, y, { lineBreak: false });
      doc.font("Helvetica").fontSize(9).fillColor(GRAY);
    }
    lx += 100;
  }
  // Autres langues
  const autresLang = langItems.find(li => {
    const n = String(li?.item || "").toLowerCase();
    return n && !n.includes("français") && !n.includes("anglais");
  });
  doc.font("Helvetica").fontSize(9).fillColor(GRAY)
     .text("Autres langues à préciser :", lx, y, { lineBreak: false });
  dotLine(doc, lx + 152, y + 10, CW - (lx - ML) - 156,
    autresLang ? `${autresLang.item} : ${autresLang.niveau}` : "");
  y += 16;
  doc.font("Helvetica").fontSize(7.5).fillColor(GRAY_L)
     .text("0 : Néant     1 : Débutant     2 : Intermédiaire     3 : Avancé     4 : Expert", ML + 10, y);
  y += 20;

  // ── SECTION 9 — Connaissances Informatiques ────────────
  y = sectionHeader(doc, y, "9", "Connaissances Informatiques et bureautiques :") + 2;
  doc.font("Helvetica-Oblique").fontSize(8).fillColor(GRAY_L)
     .text("(Mettez le code qui correspond à votre niveau)", ML + 20, y - 4);
  y += 8;

  const infoAns   = getScaleGroupAns(answers, "informatique", "bureautique", "computer");
  let infoItems = Array.isArray(infoAns?.value) ? infoAns.value : [];
  // Fallback → extracted.parsed.competences_informatiques[]
  if (infoItems.length === 0 && candSkills.length > 0) infoItems = candSkills;

  function getInfoNiv(name) {
    for (const li of infoItems) {
      if (li && String(li.item || "").toLowerCase().includes(name.toLowerCase()))
        return String(li.niveau ?? "");
    }
    return "";
  }

  const stdTools = ["Word", "Excel", "Power Point"];
  let ix = ML + 10;
  doc.font("Helvetica").fontSize(9).fillColor(GRAY);
  for (const tool of stdTools) {
    const niv = getInfoNiv(tool);
    const lw  = doc.widthOfString(tool + " :");
    doc.text(tool + " :", ix, y, { lineBreak: false });
    doc.rect(ix + lw + 5, y - 2, 20, 14)
       .fill(niv ? GREEN_L : "#F5F5F5")
       .strokeColor("#AAAAAA").lineWidth(0.5).stroke();
    if (niv) {
      doc.font("Helvetica-Bold").fontSize(9).fillColor(GREEN_MID)
         .text(niv, ix + lw + 8, y, { lineBreak: false });
      doc.font("Helvetica").fontSize(9).fillColor(GRAY);
    }
    ix += 92;
  }
  const autresInfo = infoItems.find(li => {
    const n = String(li?.item || "").toLowerCase();
    return n && !n.includes("word") && !n.includes("excel") && !n.includes("point");
  });
  doc.text("Autres (à préciser) :", ix, y, { lineBreak: false });
  dotLine(doc, ix + 118, y + 10, CW - (ix - ML) - 122,
    autresInfo ? `${autresInfo.item} : ${autresInfo.niveau}` : "");
  y += 16;
  doc.font("Helvetica").fontSize(7.5).fillColor(GRAY_L)
     .text("0 : Néant     1 : Débutant     2 : Intermédiaire     3 : Avancé     4 : Expert", ML + 10, y);
  y += 20;

  // ── SECTION 10 — Fumeur ────────────────────────────────
  y = sectionHeader(doc, y, "10", "Informations générales :") + 4;
  const fumeur = fv("fumeur").toLowerCase();
  doc.font("Helvetica").fontSize(9).fillColor(GRAY)
     .text("Fumeur :", ML + 10, y, { lineBreak: false });
  const fumeurOpts = [["Pas du tout","pas"],["Occasionnellement","occasion"],["Beaucoup","beaucoup"]];
  let fx = ML + 68;
  for (const [lbl, key] of fumeurOpts) {
    checkbox(doc, fx, y + 6, 7, fumeur.includes(key), lbl);
    fx += 112;
  }
  y += 26;

  // ── Informations complémentaires ──────────────────────
  const infoLine = "Indiquer ci-dessous toutes autres informations qui peut être utile pour votre candidature.";
  doc.font("Helvetica-Bold").fontSize(9).fillColor(DARK).text(infoLine, ML, y);
  const ilW = doc.widthOfString(infoLine, { fontSize: 9 });
  doc.moveTo(ML, y + 12).lineTo(ML + ilW, y + 12).strokeColor(DARK).lineWidth(0.5).stroke();
  y += 22;

  const valComp = fv("informations complémentaires") || fv("autres informations");
  dotLine(doc, ML, y + 10, CW, valComp.substring(0, 90));
  y += 15;
  dotLine(doc, ML, y + 10, CW, valComp.length > 90 ? valComp.substring(90, 180) : "");
  y += 30;

  // ── Déclaration ───────────────────────────────────────
  doc.font("Helvetica-Oblique").fontSize(9).fillColor(DARK)
     .text("Je déclare que les informations mentionnées ci-dessus sont correctes.", ML, y);
  y += 36;

  // Date à droite
  let dateStr = "Sfax le ....../...../.......";
  try {
    const d = new Date(submission.finishedAt || submission.createdAt);
    if (!isNaN(d)) {
      const dd = String(d.getDate()).padStart(2, "0");
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      dateStr = `Sfax le ${dd} / ${mm} / ${d.getFullYear()}`;
    }
  } catch {}
  doc.font("Helvetica").fontSize(9).fillColor(GRAY)
     .text(dateStr, 0, y, { width: A4_W - MR, align: "right", lineBreak: false });
  y += 36;

  // Nom candidat centré
  doc.font("Helvetica").fontSize(9).fillColor(GRAY_L)
     .text("Nom & Prénom du candidat", 0, y, { width: A4_W, align: "center", lineBreak: false });
  y += 14;
  doc.font("Helvetica-Bold").fontSize(11).fillColor(DARK)
     .text(candidateName || "..........................................", 0, y, {
       width: A4_W, align: "center", lineBreak: false,
     });
  y += 26;

  // Ligne signature
  doc.font("Helvetica").fontSize(9).fillColor(GRAY_L)
     .text("Signature", 0, y, { width: A4_W, align: "center", lineBreak: false });
  y += 12;
  const sigW = 100;
  doc.moveTo((A4_W - sigW) / 2, y).lineTo((A4_W + sigW) / 2, y)
     .strokeColor(DARK).lineWidth(0.8).stroke();

  // Footer page 2
  doc.font("Helvetica").fontSize(7).fillColor(GRAY_L)
     .text(`Page 2 / 2  —  ${fiche?.title || "Fiche de Renseignement"}  —  Confidentiel`,
           0, A4_H - 22, { width: A4_W, align: "center", lineBreak: false });
}