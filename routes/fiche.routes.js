import { Hono } from "hono";
import {
  createFicheController,
  getFichesController,
  getFicheByIdController,
  deleteFicheController,
  updateFicheController,
} from "../controllers/fiche.controller.js";

const ficheRoutes = new Hono();

ficheRoutes.post("/", createFicheController);
ficheRoutes.get("/", getFichesController);
ficheRoutes.get("/:id", getFicheByIdController);
ficheRoutes.put("/:id", updateFicheController); // ✅ IMPORTANT
ficheRoutes.delete("/:id", deleteFicheController);

export default ficheRoutes;
