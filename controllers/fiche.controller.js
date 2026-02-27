import {
  createFiche,
  findAllFiches,
  findFicheById,
  deleteFicheById,
  updateFicheById
} from "../models/FicheRenseignement.js";

/* ================= CREATE ================= */
export const createFicheController = async (c) => {
  try {
    const body = await c.req.json();

    const result = await createFiche({
      title: body.title,
      description: body.description,
      questions: body.questions,
      createdBy: c.get("user")?._id, // optional auth
    });

    return c.json(result, 201);
  } catch (err) {
    return c.json({ message: err.message }, 400);
  }
};

/* ================= GET ALL ================= */
export const getFichesController = async (c) => {
  const fiches = await findAllFiches();
  return c.json(fiches);
};

/* ================= GET ONE ================= */
export const getFicheByIdController = async (c) => {
  const { id } = c.req.param();
  const fiche = await findFicheById(id);

  if (!fiche) {
    return c.json({ message: "Fiche not found" }, 404);
  }

  return c.json(fiche);
};

/* ================= DELETE ================= */
export const deleteFicheController = async (c) => {
  const { id } = c.req.param();
  await deleteFicheById(id);
  return c.json({ message: "Fiche deleted" });
};
export async function updateFicheController(c) {
  try {
    const { id } = c.req.param();
    const body = await c.req.json();

    const fiche = await updateFicheById(id, body);

    if (!fiche) {
      return c.json({ message: "Fiche not found" }, 404);
    }

    return c.json(
      {
        success: true,
        fiche,
      },
      200
    );
  } catch (err) {
    console.error("UPDATE FICHE ERROR", err);
    return c.json({ success: false, error: err.message }, 500);
  }
}

