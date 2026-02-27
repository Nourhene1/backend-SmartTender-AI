import cron from "node-cron";
import axios from "axios";
import { findJobOfferById } from "../models/job.model.js";
import {
  findPendingAiDetection,
  findPendingJobMatch,
  lockAiDetection,
  lockJobMatch,
  markAiDetectionDone,
  markAiDetectionFailed,
  markJobMatchDone,
  markJobMatchFailed,
} from "../models/candidature.model.js";

const ML_SERVICE_URL =process.env.ML_SERVICE_URL || "http://ml_service:8000";

/* =========================
   HELPERS
========================= */
function buildCvText(cand) {
  const direct =
    cand?.cvText ||
    cand?.extracted?.cvText ||
    cand?.extracted?.text ||
    cand?.extracted?.rawText ||
    cand?.extracted?.raw_text;

  if (direct && typeof direct === "string") return direct;

  if (cand?.extracted) return JSON.stringify(cand.extracted);

  return "";
}

function now() {
  return new Date().toISOString();
}

// Axios instance (timeout + json)
const ml = axios.create({
  baseURL: ML_SERVICE_URL,
  timeout: 120000,
  headers: { "Content-Type": "application/json" },
});

function errMsg(err) {
  return err?.response?.data || err?.message || "Unknown error";
}

export function startAutoAnalyzeJob() {
  console.log(`[AUTO-ANALYZE] Job started ✅ (${now()})`);
  console.log(`[AUTO-ANALYZE] ML_SERVICE_URL = ${ML_SERVICE_URL}`);

  cron.schedule("*/1 * * * *", async () => {
    console.log(`\n[AUTO-ANALYZE] Tick... (${now()})`);

    try {
      // =======================
      // 1) AI DETECTION
      // =======================
      const pendingAI = await findPendingAiDetection(20);
      console.log(`[AUTO-ANALYZE] Pending AI Detection: ${pendingAI.length}`);

      for (const cand of pendingAI) {
        const candId = String(cand._id);

        const locked = await lockAiDetection(cand._id);
        if (locked.modifiedCount === 0) {
          console.log(`[AI] Skip (already locked/processed): ${candId}`);
          continue;
        }

        try {
          const cvText = buildCvText(cand);

          // ✅ IMPORTANT: send extracted too (structured)
          const extracted = cand?.extracted || null;

          console.log(
            `[AI] Analyzing candidature=${candId} | cvTextLen=${cvText.length} | extracted=${extracted ? "YES" : "NO"}`
          );

          const res = await ml.post("/analyze/ai-detection", {
            candidatureId: candId,
            cvText,
            extracted, // ✅
          });

          console.log(`[AI] ML Response for ${candId}:`, res.data);

          const isAIGenerated = res.data?.isAIGenerated;
          const confidence = res.data?.confidence;

          if (typeof isAIGenerated !== "boolean" || typeof confidence !== "number") {
            console.log(`[AI] Invalid response schema for ${candId}`);
            await markAiDetectionFailed(cand._id, "Invalid AI detection response");
            continue;
          }

          await markAiDetectionDone(cand._id, isAIGenerated, confidence);
          console.log(
            `[AI] Saved DONE for ${candId} ✅ (isAI=${isAIGenerated}, conf=${confidence})`
          );
        } catch (err) {
          console.log(`[AI] ERROR for ${candId}:`, errMsg(err));
          await markAiDetectionFailed(cand._id, JSON.stringify(errMsg(err)));
        }
      }

      // =======================
      // 2) JOB MATCH
      // =======================
      const pendingMatch = await findPendingJobMatch(20);
      console.log(`[AUTO-ANALYZE] Pending Job Match: ${pendingMatch.length}`);

      for (const cand of pendingMatch) {
        const candId = String(cand._id);

        const locked = await lockJobMatch(cand._id);
        if (locked.modifiedCount === 0) {
          console.log(`[MATCH] Skip (already locked/processed): ${candId}`);
          continue;
        }

        try {
          const job = await findJobOfferById(cand.jobOfferId);
          if (!job) {
            console.log(`[MATCH] Job not found for candidature=${candId}`);
            await markJobMatchFailed(cand._id, "Job offer not found");
            continue;
          }

          const cvText = buildCvText(cand);

          // ✅ IMPORTANT: send extracted too
          const extracted = cand?.extracted || null;

          console.log(
            `[MATCH] Analyzing candidature=${candId} | job=${job.titre} | cvTextLen=${cvText.length} | extracted=${extracted ? "YES" : "NO"}`
          );

          const res = await ml.post("/analyze/job-match", {
            candidatureId: candId,
            cvText,
            extracted, // ✅
            job: {
              titre: job.titre,
              description: job.description,
              technologies: job.technologies || [],
            },
          });

          console.log(`[MATCH] ML Response for ${candId}:`, res.data);

          const score = res.data?.score;
          if (typeof score !== "number") {
            console.log(`[MATCH] Invalid response schema for ${candId}`);
            await markJobMatchFailed(cand._id, "Invalid job match response");
            continue;
          }

          // ✅ store full result
          await markJobMatchDone(cand._id, res.data);

          console.log(`[MATCH] Saved DONE for ${candId} ✅ (score=${score})`);
        } catch (err) {
          console.log(`[MATCH] ERROR for ${candId}:`, errMsg(err));
          await markJobMatchFailed(cand._id, JSON.stringify(errMsg(err)));
        }
      }
    } catch (e) {
      console.log(`[AUTO-ANALYZE] Global ERROR:`, e?.message);
    }
  });
}
