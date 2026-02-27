import { ObjectId } from "mongodb";
import { connectDB, closeDB, getDB } from "../models/db.js";
import {
  createFiche,
  findAllFiches,
  findFicheById,
  updateFicheById,
  deleteFicheById,
} from "../models/FicheRenseignement.js";

describe("FicheRenseignement Model", () => {
  let ficheId;

  beforeAll(async () => {
    await connectDB();
    await getDB().collection("fiches_renseignement").deleteMany({});
  });

  afterAll(async () => {
    await closeDB();
  });

  test("createFiche -> success", async () => {
    const res = await createFiche({
      title: "Fiche Test",
      description: "Desc test",
      createdBy: new ObjectId(),
      questions: [
        { label: "Nom ?", type: "text", required: true },
        {
          label: "Skills",
          type: "checkbox",
          options: [{ label: "Node.js" }, { label: "React" }],
        },
      ],
    });

    ficheId = res.insertedId;
    expect(ficheId).toBeDefined();
  });

  test("findAllFiches -> returns array", async () => {
    const fiches = await findAllFiches();
    expect(Array.isArray(fiches)).toBe(true);
    expect(fiches.length).toBeGreaterThan(0);
  });

  test("findFicheById -> success", async () => {
    const fiche = await findFicheById(ficheId.toString());
    expect(fiche.title).toBe("Fiche Test");
  });

  test("updateFicheById -> success", async () => {
  const updated = await updateFicheById(ficheId.toString(), {
    title: "Fiche Updated",
    description: "Updated desc",
    questions: [
      {
        label: "Age ?",
        type: "text",
        required: true,
      },
    ],
  });

  // 🔐 لازم نثبت اللي fiche رجعت
  expect(updated).toBeDefined();
  expect(updated._id.toString()).toBe(ficheId.toString());

  // 🔁 fields updated
  expect(updated.title).toBe("Fiche Updated");
  expect(updated.description).toBe("Updated desc");

  // 🔁 questions normalized
  expect(Array.isArray(updated.questions)).toBe(true);
  expect(updated.questions.length).toBe(1);
  expect(updated.questions[0].label).toBe("Age ?");

  // 🕒 timestamp
  expect(updated.updatedAt).toBeDefined();
});


  test("deleteFicheById -> success", async () => {
    const res = await deleteFicheById(ficheId.toString());
    expect(res.deletedCount).toBe(1);
  });
});
