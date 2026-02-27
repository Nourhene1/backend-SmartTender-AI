import { getDB } from "../../models/db.js";
import {
  createFiche,
  findFicheById,
  updateFicheById,
} from "../../models/FicheRenseignement.js";

describe("FicheRenseignement Model", () => {
  let ficheId;

  beforeAll(async () => {
    await getDB().collection("fiches_renseignement").deleteMany({});
  });

  test("should fail if title is missing", async () => {
    await expect(createFiche({}))
      .rejects
      .toThrow("Title is required");
  });

  test("should create fiche", async () => {
    const res = await createFiche({
      title: "Test Fiche",
      description: "desc",
      questions: [{ label: "Q1", type: "text" }],
    });

    ficheId = res.insertedId;
    expect(ficheId).toBeDefined();
  });

  test("should find fiche by id", async () => {
    const fiche = await findFicheById(ficheId);
    expect(fiche.title).toBe("Test Fiche");
  });

  test("should update fiche", async () => {
    const updated = await updateFicheById(ficheId, {
      title: "Updated",
      description: "Updated desc",
      questions: [],
    });

    expect(updated.title).toBe("Updated");
  });
   

});
