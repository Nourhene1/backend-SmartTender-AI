// controllers/Candidature.entretien.controller.js

import { ObjectId } from "mongodb";
import { getDB } from "../models/db.js";

/**
 * POST /candidatures/:id/entretien-note
 * ✅ Create note (or if noteId موجود يعمل update لنفس note)
 */
export async function saveEntretienNoteController(c) {
  try {
    const { id } = c.req.param();
    const body = await c.req.json();

    if (!ObjectId.isValid(id)) return c.json({ error: "ID invalide" }, 400);

    const { type = "telephonique", note, date, stars = 0, noteId } = body;

    if (!note?.trim()) return c.json({ error: "Note vide" }, 400);

    const userId = c.get("user")?._id || null;

    // ✅ إذا noteId مبعوث: update مباشر
    if (noteId) {
      const upd = await getDB()
        .collection("candidatures")
        .updateOne(
          { _id: new ObjectId(id), "entretiens.notes.noteId": String(noteId) },
          {
            $set: {
              "entretiens.notes.$.note": note.trim(),
              "entretiens.notes.$.stars": stars || 0,
              "entretiens.notes.$.type": type,
              "entretiens.notes.$.updatedAt": new Date(),
              "entretiens.notes.$.updatedBy": userId,
              "entretiens.lastType": type,
              "entretiens.lastNoteAt": new Date(),
              updatedAt: new Date(),
            },
          },
        );

      if (upd.matchedCount === 0) {
        return c.json({ error: "Note introuvable" }, 404);
      }
      return c.json({ success: true, updated: true }, 200);
    }

    const noteDoc = {
      noteId: new ObjectId().toString(), // ✅ مهم برشة
      type,
      note,
      stars,
      createdAt: new Date(),
      createdBy: userId ?? null,
    };

    const result = await getDB()
      .collection("candidatures")
      .updateOne(
        { _id: new ObjectId(id) },
        {
          $push: { "entretiens.notes": noteDoc },
          $set: {
            "entretiens.lastType": type,
            "entretiens.lastNoteAt": noteDoc.createdAt,
            updatedAt: new Date(),
          },
        },
      );

    if (result.matchedCount === 0)
      return c.json({ error: "Candidature introuvable" }, 404);

    return c.json({ success: true, note: noteDoc }, 201);
  } catch (err) {
    console.error("❌ saveEntretienNoteController:", err);
    return c.json({ error: "Erreur serveur" }, 500);
  }
}

/**
 * GET /candidatures/:id/entretien-note?type=telephonique
 * ✅ يرجّع آخر note حسب النوع
 */
export async function getEntretienNoteByTypeController(c) {
  try {
    const { id } = c.req.param();
    const type = (c.req.query("type") || "telephonique").trim();

    if (!ObjectId.isValid(id)) return c.json({ note: null }, 200);

    const cand = await getDB()
      .collection("candidatures")
      .findOne(
        { _id: new ObjectId(id) },
        { projection: { "entretiens.notes": 1 } },
      );

    const notes = cand?.entretiens?.notes || [];
    const filtered = notes.filter((n) => (n?.type || "telephonique") === type);

    if (!filtered.length) return c.json({ note: null }, 200);

    // آخر note (بالـ createdAt / updatedAt)
    filtered.sort((a, b) => {
      const da = new Date(a.updatedAt || a.createdAt || 0).getTime();
      const db = new Date(b.updatedAt || b.createdAt || 0).getTime();
      return db - da;
    });

    return c.json({ note: filtered[0] }, 200);
  } catch (err) {
    console.error("❌ getEntretienNoteByTypeController:", err);
    return c.json({ note: null }, 200);
  }
}

/**
 * PATCH /candidatures/:id/entretien-note/:noteId
 * ✅ Update note by noteId
 */


/**
 * DELETE /candidatures/:id/entretien-note/:noteId
 * ✅ Delete note by noteId
 */

// controllers/Candidature.entretien.controller.js



/**
 * PATCH /candidatures/:id/entretien-note/:noteId
 * ✅ Update note by noteId
 */
export async function updateEntretienNoteController(c) {
  try {
    const { id, noteId } = c.req.param();
    const body = await c.req.json();
    const { note, stars = 0, type = "telephonique" } = body;

    if (!ObjectId.isValid(id)) return c.json({ error: "ID invalide" }, 400);
    if (!noteId) return c.json({ error: "noteId manquant" }, 400);
    if (!note?.trim()) return c.json({ error: "Note vide" }, 400);

    const userId = c.get("user")?._id || null;

    const upd = await getDB()
      .collection("candidatures")
      .updateOne(
        { _id: new ObjectId(id), "entretiens.notes.noteId": String(noteId) },
        {
          $set: {
            "entretiens.notes.$.note": note.trim(),
            "entretiens.notes.$.stars": Number(stars) || 0,
            "entretiens.notes.$.type": type,
            "entretiens.notes.$.updatedAt": new Date(),
            "entretiens.notes.$.updatedBy": userId,
            "entretiens.lastType": type,
            "entretiens.lastNoteAt": new Date(),
            updatedAt: new Date(),
          },
        }
      );

    if (upd.matchedCount === 0) {
      return c.json({ error: "Note introuvable" }, 404);
    }

    return c.json({ success: true }, 200);
  } catch (err) {
    console.error("❌ updateEntretienNoteController:", err);
    return c.json({ error: "Erreur serveur" }, 500);
  }
}

/**
 * DELETE /candidatures/:id/entretien-note/:noteId
 * ✅ Delete note by noteId (FIXED)
 */
export async function deleteEntretienNoteController(c) {
  try {
    const { id, noteId } = c.req.param();

    if (!ObjectId.isValid(id)) return c.json({ error: "ID invalide" }, 400);
    if (!noteId) return c.json({ error: "noteId manquant" }, 400);

    const col = getDB().collection("candidatures");

    // 1) delete note
    const del = await col.updateOne(
      { _id: new ObjectId(id) },
      {
        $pull: { "entretiens.notes": { noteId: String(noteId) } },
        $set: { updatedAt: new Date() },
      }
    );

    if (del.matchedCount === 0) {
      return c.json({ error: "Candidature introuvable" }, 404);
    }
    if (del.modifiedCount === 0) {
      return c.json({ error: "Note introuvable" }, 404);
    }

    // 2) (optionnel mais propre) recalculer lastType / lastNoteAt
    const cand = await col.findOne(
      { _id: new ObjectId(id) },
      { projection: { "entretiens.notes": 1 } }
    );

    const notes = cand?.entretiens?.notes || [];
    if (!notes.length) {
      await col.updateOne(
        { _id: new ObjectId(id) },
        { $set: { "entretiens.lastType": null, "entretiens.lastNoteAt": null } }
      );
    } else {
      notes.sort((a, b) => {
        const da = new Date(a.updatedAt || a.createdAt || 0).getTime();
        const db = new Date(b.updatedAt || b.createdAt || 0).getTime();
        return db - da;
      });
      const last = notes[0];
      await col.updateOne(
        { _id: new ObjectId(id) },
        {
          $set: {
            "entretiens.lastType": last?.type || "telephonique",
            "entretiens.lastNoteAt": new Date(last?.updatedAt || last?.createdAt || Date.now()),
          },
        }
      );
    }

    return c.json({ success: true }, 200);
  } catch (err) {
    console.error("❌ deleteEntretienNoteController:", err);
    return c.json({ error: "Erreur serveur" }, 500);
  }
}
/**
 * GET /candidatures/:id/entretien-notes  (خليه كما هو)
 */
export async function getEntretienNotesController(c) {
  try {
    const { id } = c.req.param();
    if (!ObjectId.isValid(id)) return c.json([], 200);

    const cand = await getDB()
      .collection("candidatures")
      .findOne(
        { _id: new ObjectId(id) },
        { projection: { "entretiens.notes": 1 } },
      );

    return c.json(cand?.entretiens?.notes || [], 200);
  } catch (err) {
    console.error("❌ getEntretienNotesController:", err);
    return c.json([], 200);
  }
}
