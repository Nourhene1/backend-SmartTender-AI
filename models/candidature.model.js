import { ObjectId } from "mongodb";
import { getDB } from "./db.js";

const COLLECTION = "candidatures";
const col = () => getDB().collection(COLLECTION);

export async function createCandidature(data) {
  return col().insertOne({
    jobOfferId: new ObjectId(data.jobOfferId),
    candidatId: data.candidatId ? new ObjectId(data.candidatId) : null,
    cv: data.cv,
    extracted: data.extracted || null,

    personalInfoForm: {
      dateNaissance: null,
      lieuNaissance: null,
      telephone: null,
    },

    analysis: {
      aiDetection: {
        status: "PENDING",
        isAIGenerated: null,
        confidence: null,
        analyzedAt: null,
        error: null,
      },
      jobMatch: {
        status: "PENDING",
        score: null,
        analyzedAt: null,
        error: null,
      },
    },

    status: data.status || "DRAFT",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

//sprint 1
/**
 * ✅ Vérifie si un email a déjà une candidature SUBMITTED pour une offre donnée.
 * Cherche dans extracted.personal_info.email (structure LLM standard)
 */
export async function emailAlreadyApplied(jobOfferId, email) {
  if (!email || !ObjectId.isValid(jobOfferId)) return false;

  const normalizedEmail = email.trim().toLowerCase();

  const existing = await col().findOne({
    jobOfferId: new ObjectId(jobOfferId),
    status: "SUBMITTED",
    $or: [
      { "extracted.personal_info.email": { $regex: new RegExp(`^${normalizedEmail}$`, "i") } },
      { "extracted.email":              { $regex: new RegExp(`^${normalizedEmail}$`, "i") } },
    ],
  });

  return !!existing;
}


/**
 * ✅ Vérifie si une candidature SUBMITTED existe déjà pour ce job + candidat (ou email)
 * Utilisé pour bloquer la double soumission sur la même offre
 */
export async function alreadySubmittedForJob(jobOfferId, { candidatId = null, email = null } = {}) {
  if (!ObjectId.isValid(jobOfferId)) return false;

  const query = {
    jobOfferId: new ObjectId(jobOfferId),
    status: "SUBMITTED",
  };

  // ✅ Si utilisateur connecté → vérif par candidatId (prioritaire)
  if (candidatId && ObjectId.isValid(candidatId)) {
    query.candidatId = new ObjectId(candidatId);
    return !!(await col().findOne(query));
  }

  // ✅ Sinon → vérif par email dans TOUTES les structures possibles
  // MongoDB stocke l'email dans extracted.parsed.email (structure FastAPI réelle)
  if (email) {
    const normalizedEmail = email.trim().toLowerCase();
    delete query.candidatId;
    query.$or = [
      { "extracted.parsed.email":               { $regex: new RegExp(`^${normalizedEmail}$`, "i") } }, // ← structure réelle
      { "extracted.parsed.personal_info.email":  { $regex: new RegExp(`^${normalizedEmail}$`, "i") } },
      { "extracted.personal_info.email":         { $regex: new RegExp(`^${normalizedEmail}$`, "i") } },
      { "extracted.email":                       { $regex: new RegExp(`^${normalizedEmail}$`, "i") } },
      { "personalInfoForm.email":                { $regex: new RegExp(`^${normalizedEmail}$`, "i") } },
    ];
    const found = await col().findOne(query);
    console.log(`🔍 alreadySubmittedForJob(${normalizedEmail}) →`, found ? "DOUBLON TROUVÉ ✅" : "pas de doublon");
    return !!found;
  }

  return false;
}


export async function updateCandidatureExtracted(id, extracted) {
  return col().updateOne(
    { _id: new ObjectId(id) },
    { $set: { extracted, updatedAt: new Date() } },
  );
}

export async function updateCandidaturePersonalInfoForm(id, personalInfoForm) {
  return col().updateOne(
    { _id: new ObjectId(id) },
    {
      $set: {
        personalInfoForm,
        updatedAt: new Date(),
      },
    },
  );
}

export async function countCandidatures() {
  return col().countDocuments();
}

export async function getCandidaturesWithJobDetails() {
  return col()
    .aggregate([
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

          jobTitle: "$job.titre",

          /* ================= EMAIL ================= */
          email: {
            $ifNull: [
              "$personalInfoForm.email",
              {
                $ifNull: [
                  "$extracted.personal_info.email",
                  {
                    $ifNull: [
                      "$extracted.extracted.personal_info.email",
                      {
                        $ifNull: [
                          "$extracted.email",
                          "$extracted.extracted.email",
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },

          /* ================= TELEPHONE ================= */
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

          /* ================= LINKEDIN ================= */
          linkedin: {
            $ifNull: [
              "$personalInfoForm.linkedin",
              {
                $ifNull: [
                  "$extracted.personal_info.linkedin",
                  {
                    $ifNull: [
                      "$extracted.linkedin",
                      "$extracted.extracted.linkedin",
                    ],
                  },
                ],
              },
            ],
          },

          /* ================= FULL NAME ================= */
          fullName: {
            $ifNull: [
              "$extracted.personal_info.full_name",
              {
                $ifNull: [
                  "$extracted.extracted.personal_info.full_name",
                  {
                    $ifNull: [
                      "$extracted.full_name",
                      "$extracted.extracted.full_name",
                    ],
                  },
                ],
              },
            ],
          },

          /* ================= PRENOM ================= */
          prenom: {
            $ifNull: [
              "$personalInfoForm.prenom",
              {
                $ifNull: [
                  "$extracted.personal_info.first_name",
                  "$extracted.extracted.personal_info.first_name",
                ],
              },
            ],
          },

          /* ================= NOM ================= */
          nom: {
            $ifNull: [
              "$personalInfoForm.nom",
              {
                $ifNull: [
                  "$extracted.personal_info.last_name",
                  "$extracted.extracted.personal_info.last_name",
                ],
              },
            ],
          },
        },
      },

      { $sort: { createdAt: -1 } },
    ])
    .toArray();
}

// sprint 2
// create jdida deja
export async function findPendingAiDetection(limit = 10) {
  return col()
    .find({ "analysis.aiDetection.status": "PENDING" })
    .sort({ createdAt: 1 })
    .limit(limit)
    .toArray();
}

export async function findPendingJobMatch(limit = 10) {
  return col()
    .aggregate([
      {
        $match: {
          "analysis.jobMatch.status": "PENDING",
        },
      },
      {
        $lookup: {
          from: "job_offers",          
          localField: "jobOfferId",
          foreignField: "_id",
          as: "job",
        },
      },
      {
        $unwind: "$job",               
      },
      {
        $sort: { createdAt: 1 },
      },
      {
        $limit: limit,
      },
    ])
    .toArray();
}


export async function lockAiDetection(id) {
  return col().updateOne(
    { _id: new ObjectId(id), "analysis.aiDetection.status": "PENDING" },
    {
      $set: {
        "analysis.aiDetection.status": "PROCESSING",
        updatedAt: new Date(),
      },
    }
  );
}

export async function lockJobMatch(id) {
  return col().updateOne(
    { _id: new ObjectId(id), "analysis.jobMatch.status": "PENDING" },
    {
      $set: {
        "analysis.jobMatch.status": "PROCESSING",
        updatedAt: new Date(),
      },
    }
  );
}

export async function markAiDetectionDone(id, isAIGenerated, confidence) {
  return col().updateOne(
    { _id: new ObjectId(id) },
    {
      $set: {
        "analysis.aiDetection.status": "DONE",
        "analysis.aiDetection.isAIGenerated": isAIGenerated,
        "analysis.aiDetection.confidence": confidence,
        "analysis.aiDetection.analyzedAt": new Date(),
        "analysis.aiDetection.error": null,
        updatedAt: new Date(),
      },
    }
  );
}

export async function markAiDetectionFailed(id, errorMessage) {
  return col().updateOne(
    { _id: new ObjectId(id) },
    {
      $set: {
        "analysis.aiDetection.status": "FAILED",
        "analysis.aiDetection.error": errorMessage || "AI detection failed",
        updatedAt: new Date(),
      },
    }
  );
}

export async function markJobMatchDone(id, jobMatchResult) {
  return col().updateOne(
    { _id: new ObjectId(id) },
    {
      $set: {
        "analysis.jobMatch": {
          status: "DONE",
          analyzedAt: new Date(),

          score: jobMatchResult.score,
          recommendation: jobMatchResult.recommendation,

          detailedScores: jobMatchResult.detailedScores || {},
          strengths: jobMatchResult.strengths || [],
          weaknesses: jobMatchResult.weaknesses || [],
          summary: jobMatchResult.summary || null,

          skillsAnalysis: jobMatchResult.skillsAnalysis || {},
          experienceAnalysis: jobMatchResult.experienceAnalysis || {},
          riskMitigation: jobMatchResult.riskMitigation || {},
          nextSteps: jobMatchResult.nextSteps || {},

          error: null,
        },
        updatedAt: new Date(),
      },
    }
  );
}


export async function markJobMatchFailed(id, errorMessage) {
  return col().updateOne(
    { _id: new ObjectId(id) },
    {
      $set: {
        "analysis.jobMatch.status": "FAILED",
        "analysis.jobMatch.error": errorMessage || "Job match failed",
        updatedAt: new Date(),
      },
    }
  );
}

export async function getCandidatureJob() {
  return col()
    .aggregate([
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
        $addFields: {
          // ====== NAME BUILDING ======
          computedFullName: {
            $ifNull: [
              "$personalInfoForm.fullName",
              {
                $ifNull: [
                  "$extracted.personal_info.full_name",
                  {
                    $ifNull: [
                      "$extracted.extracted.personal_info.full_name",
                      {
                        $ifNull: [
                          "$extracted.personal_info.name",
                          {
                            $ifNull: [
                              "$extracted.extracted.personal_info.name",
                              {
                                $ifNull: [
                                  "$extracted.full_name",
                                  {
                                    $ifNull: [
                                      "$extracted.extracted.full_name",
                                      {
                                        $ifNull: [
                                          "$extracted.name",
                                          "$extracted.extracted.name",
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
                    ],
                  },
                ],
              },
            ],
          },

          computedPrenom: {
            $ifNull: [
              "$personalInfoForm.prenom",
              {
                $ifNull: [
                  "$extracted.personal_info.first_name",
                  {
                    $ifNull: [
                      "$extracted.extracted.personal_info.first_name",
                      {
                        $ifNull: [
                          "$extracted.first_name",
                          "$extracted.extracted.first_name",
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },

          computedNom: {
            $ifNull: [
              "$personalInfoForm.nom",
              {
                $ifNull: [
                  "$extracted.personal_info.last_name",
                  {
                    $ifNull: [
                      "$extracted.extracted.personal_info.last_name",
                      {
                        $ifNull: [
                          "$extracted.last_name",
                          "$extracted.extracted.last_name",
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },
      },

      {
        $project: {
          _id: 1,
          createdAt: 1,
          updatedAt: 1,
          cv: 1,
          extracted: 1,
          personalInfoForm: 1,
          analysis: 1,
          preInterview: { $ifNull: ["$preInterview", { status: "NONE" }] },
          jobTitle: "$job.titre",
          jobId: "$job._id",

          email: {
            $ifNull: [
              "$personalInfoForm.email",
              {
                $ifNull: [
                  "$extracted.personal_info.email",
                  {
                    $ifNull: [
                      "$extracted.extracted.personal_info.email",
                      {
                        $ifNull: [
                          "$extracted.email",
                          "$extracted.extracted.email",
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },

          fullName: {
            $cond: [
              { $and: [{ $ne: ["$computedFullName", null] }, { $ne: ["$computedFullName", ""] }] },
              "$computedFullName",
              {
                $trim: {
                  input: {
                    $concat: [
                      { $ifNull: ["$computedPrenom", ""] },
                      " ",
                      { $ifNull: ["$computedNom", ""] },
                    ],
                  },
                },
              },
            ],
          },

          prenom: "$computedPrenom",
          nom: "$computedNom",
        },
      },

     { $sort: { "preInterview.selectedAt": -1, createdAt: -1 } },
    ])
    .toArray();
}
export async function findCandidatureById(id) {
  return getDB().collection("candidatures").findOne({ _id: new ObjectId(id) });
}

export async function findFicheById(id) {
  return col().findOne({ _id: new ObjectId(id) });
}

export async function getMyCandidaturesWithJob(userId) {
  const uid = new ObjectId(userId);

  return col()
    .aggregate([
      {
        $lookup: {
          from: "job_offers",
          localField: "jobOfferId",
          foreignField: "_id",
          as: "job",
        },
      },
      { $unwind: { path: "$job", preserveNullAndEmptyArrays: false } },

      // ✅ فقط العروض اللي user مكلّف بيها
      { $match: { "job.assignedUserIds": uid } },

      // ✅ fiche submissions متاع هالقandidature
      {
        $lookup: {
          from: "fiche_submissions",
          localField: "_id",
          foreignField: "candidatureId",
          as: "ficheSubmission",
        },
      },
      { $addFields: { ficheSubmission: { $arrayElemAt: ["$ficheSubmission", 0] } } },

      {
        $project: {
          _id: 1,
          createdAt: 1,

          // ✅ CV + fiche renseignement raw الموجودة عندك
          cv: 1,
          personalInfoForm: 1,
          extracted: 1,

          jobOfferId: 1,
          jobTitle: "$job.titre",

          // ✅ contact
          email: {
            $ifNull: [
              "$personalInfoForm.email",
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

          // ✅ nom / prenom
          prenom: {
            $ifNull: [
              "$personalInfoForm.prenom",
              {
                $ifNull: [
                  "$extracted.personal_info.first_name",
                  "$extracted.extracted.personal_info.first_name",
                ],
              },
            ],
          },

          nom: {
            $ifNull: [
              "$personalInfoForm.nom",
              {
                $ifNull: [
                  "$extracted.personal_info.last_name",
                  "$extracted.extracted.personal_info.last_name",
                ],
              },
            ],
          },

          // ✅ fiche submission summary
          fiche: {
            _id: "$ficheSubmission._id",
            ficheId: "$ficheSubmission.ficheId",
            status: "$ficheSubmission.status",
            startedAt: "$ficheSubmission.startedAt",
            finishedAt: "$ficheSubmission.finishedAt",
            answersCount: { $size: { $ifNull: ["$ficheSubmission.answers", []] } },
          },
        },
      },

      { $sort: { createdAt: -1 } },
    ])
    .toArray();
}








export async function getMatchingStats() {
  return col()
    .aggregate([
      {
        $match: {
          "analysis.jobMatch.status": "DONE",
          "analysis.jobMatch.score": { $ne: null },
        },
      },

      {
        $facet: {
          /* ===== KPI ===== */
          metrics: [
            {
              $group: {
                _id: null,
                avgScore: { $avg: "$analysis.jobMatch.score" },
                total: { $sum: 1 },
                above80: {
                  $sum: {
                    $cond: [{ $gte: ["$analysis.jobMatch.score", 70] }, 1, 0],
                  },
                },
                below50: {
                  $sum: {
                    $cond: [{ $lt: ["$analysis.jobMatch.score", 50] }, 1, 0],
                  },
                },
              },
            },
            {
              $project: {
                _id: 0,
                avgScore: { $round: ["$avgScore", 1] },
                percentAbove70: {
                  $round: [
                    { $multiply: [{ $divide: ["$above70", "$total"] }, 100] },
                    1,
                  ],
                },
                percentBelow50: {
                  $round: [
                    { $multiply: [{ $divide: ["$below50", "$total"] }, 100] },
                    1,
                  ],
                },
              },
            },
          ],

          /* ===== HISTOGRAM ===== */
          histogram: [
            {
              $bucket: {
                groupBy: "$analysis.jobMatch.score",
                boundaries: [0, 20, 40, 60, 70, 100],
                default: "100+",
                output: {
                  count: { $sum: 1 },
                },
              },
            },
          ],
        },
      },
    ])
    .toArray();
}



export async function getAcademicStats() {
  return col().aggregate([
    // 1️⃣ Vérifier que la formation existe
    {
      $match: {
        "extracted.parsed.formation": { $exists: true, $ne: [] }
      }
    },

    // 2️⃣ Unwind sur la formation (champ réel)
    {
      $unwind: "$extracted.parsed.formation"
    },

    // 3️⃣ Normaliser le niveau du diplôme
    {
      $addFields: {
        diplomaLevel: {
          $cond: [
            {
              $regexMatch: {
                input: "$extracted.parsed.formation.diplome",
                regex: /master/i
              }
            },
            "Bac+5",
            {
              $cond: [
                {
                  $regexMatch: {
                    input: "$extracted.parsed.formation.diplome",
                    regex: /licence/i
                  }
                },
                "Bac+3",
                {
                  $cond: [
                    {
                      $regexMatch: {
                        input: "$extracted.parsed.formation.diplome",
                        regex: /doctorat|phd/i
                      }
                    },
                    "PhD",
                    "Autre"
                  ]
                }
              ]
            }
          ]
        },

        numericLevel: {
          $switch: {
            branches: [
              {
                case: {
                  $regexMatch: {
                    input: "$extracted.parsed.formation.diplome",
                    regex: /licence/i
                  }
                },
                then: 3
              },
              {
                case: {
                  $regexMatch: {
                    input: "$extracted.parsed.formation.diplome",
                    regex: /master/i
                  }
                },
                then: 5
              },
              {
                case: {
                  $regexMatch: {
                    input: "$extracted.parsed.formation.diplome",
                    regex: /doctorat|phd/i
                  }
                },
                then: 8
              }
            ],
            default: 0
          }
        }
      }
    },

    // 4️⃣ KPIs académiques
    {
      $facet: {
        // ===== Top universités =====
        topUniversities: [
          {
            $group: {
              _id: "$extracted.parsed.formation.etablissement",
              count: { $sum: 1 }
            }
          },
          { $sort: { count: -1 } },
          { $limit: 5 }
        ],

        // ===== Répartition des diplômes =====
        degreeDistribution: [
          {
            $group: {
              _id: "$diplomaLevel",
              total: { $sum: 1 }
            }
          }
        ],

        // ===== Niveau moyen =====
        averageLevel: [
          {
            $match: {
              numericLevel: { $gt: 0 }
            }
          },
          {
            $group: {
              _id: null,
              avgLevel: { $avg: "$numericLevel" }
            }
          }

        ]
      }
    }
  ]).toArray();
}