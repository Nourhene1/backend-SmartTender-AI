// ================================================================
// 🆕 PRE-INTERVIEW — Fonctions à AJOUTER dans candidature.model.js
// ================================================================

import { ObjectId } from "mongodb";
import { getDB } from "./db.js";

const COLLECTION = "candidatures";
const col = () => getDB().collection(COLLECTION);

/**
 * ✅ Toggle pré-entretien
 */
export async function togglePreInterview(id) {
  if (!ObjectId.isValid(id)) throw new Error("ID invalide");

  const existing = await col().findOne(
    { _id: new ObjectId(id) },
    { projection: { "preInterview.status": 1 } }
  );

  if (!existing) throw new Error("Candidature introuvable");

  const isAlreadySelected = existing?.preInterview?.status === "SELECTED";

  if (isAlreadySelected) {
    await col().updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          "preInterview.status": "NONE",
          "preInterview.removedAt": new Date(),
          updatedAt: new Date(),
        },
        $unset: { "preInterview.selectedAt": "" },
      }
    );
    return { action: "removed", preInterviewStatus: "NONE" };
  } else {
    await col().updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          "preInterview.status": "SELECTED",
          "preInterview.selectedAt": new Date(),
          updatedAt: new Date(),
        },
        $unset: { "preInterview.removedAt": "" },
      }
    );
    return { action: "selected", preInterviewStatus: "SELECTED" };
  }
}

/**
 * ✅ Récupérer tous les candidats pré-sélectionnés
 * ⚠️ jobOfferId est inclus dans la projection pour charger le quiz côté frontend
 */
export async function getPreInterviewCandidatures() {
  return col()
    .aggregate([
      {
        $match: { "preInterview.status": "SELECTED" },
      },
      {
        $lookup: {
          from: "job_offers",
          localField: "jobOfferId",
          foreignField: "_id",
          as: "job",
        },
      },
      { $unwind: { path: "$job", preserveNullAndEmptyArrays: true } },

      {
        $project: {
          _id: 1,
          createdAt: 1,
          cv: 1,
          extracted: 1,
          personalInfoForm: 1,
          analysis: 1,
          preInterview: 1,

          // ✅ AJOUTÉ — nécessaire pour charger le quiz technique de ce job
          jobOfferId: 1,

          jobTitle: "$job.titre",

          // ✅ fullName — structure FastAPI réelle = extracted.parsed.nom / full_name
          fullName: {
            $ifNull: [
              "$extracted.parsed.full_name",                        // ✅ FastAPI réel
              {
                $ifNull: [
                  "$extracted.parsed.nom",                          // ✅ Variante FastAPI FR
                  {
                    $ifNull: [
                      "$extracted.personal_info.full_name",
                      {
                        $ifNull: [
                          "$extracted.extracted.personal_info.full_name",
                          { $ifNull: ["$extracted.full_name", "$extracted.extracted.full_name"] },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },

          prenom: {
            $ifNull: [
              "$personalInfoForm.prenom",
              {
                $ifNull: [
                  "$extracted.parsed.prenom",                       // ✅ FastAPI FR
                  {
                    $ifNull: [
                      "$extracted.parsed.first_name",
                      {
                        $ifNull: [
                          "$extracted.personal_info.first_name",
                          "$extracted.extracted.personal_info.first_name",
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },

          nom: {
            $ifNull: [
              "$personalInfoForm.nom",
              {
                $ifNull: [
                  "$extracted.parsed.nom",                          // ✅ FastAPI FR
                  {
                    $ifNull: [
                      "$extracted.parsed.last_name",
                      {
                        $ifNull: [
                          "$extracted.personal_info.last_name",
                          "$extracted.extracted.personal_info.last_name",
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },

          // ✅ Email — tous les chemins possibles (structure FastAPI réelle = extracted.parsed.email)
          email: {
            $ifNull: [
              "$personalInfoForm.email",
              {
                $ifNull: [
                  "$extracted.parsed.email",                          // ✅ Structure FastAPI réelle
                  {
                    $ifNull: [
                      "$extracted.parsed.personal_info.email",        // ✅ Variante FastAPI
                      {
                        $ifNull: [
                          "$extracted.personal_info.email",
                          {
                            $ifNull: [
                              "$extracted.extracted.personal_info.email",
                              { $ifNull: ["$extracted.email", "$extracted.extracted.email"] },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },

          telephone: {
            $ifNull: [
              "$personalInfoForm.telephone",
              {
                $ifNull: [
                  "$extracted.personal_info.telephone",
                  {
                    $ifNull: [
                      "$extracted.personal_info.phone",
                      {
                        $ifNull: [
                          "$extracted.extracted.personal_info.telephone",
                          "$extracted.extracted.personal_info.phone",
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },

          linkedin: {
            $ifNull: [
              "$personalInfoForm.linkedin",
              {
                $ifNull: [
                  "$extracted.personal_info.linkedin",
                  { $ifNull: ["$extracted.linkedin", "$extracted.extracted.linkedin"] },
                ],
              },
            ],
          },
        },
      },

      { $sort: { "preInterview.selectedAt": -1 } },
    ])
    .toArray();
}