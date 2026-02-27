import { Hono } from "hono";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { adminOnly } from "../middlewares/admin.middleware.js";

import {
  getRolesController,
  createRoleController,
  deleteRoleController,
  updateRoleController
  
} from "../controllers/Role.controller.js"; // ⚠️ نفس الاسم بالضبط

const RolesRoutes = new Hono();

RolesRoutes.get("/", authMiddleware, adminOnly, getRolesController);
RolesRoutes.post("/", authMiddleware, adminOnly, createRoleController);
RolesRoutes.put("/:id", authMiddleware, adminOnly, updateRoleController);

RolesRoutes.delete("/:id", authMiddleware, adminOnly, deleteRoleController);

export default RolesRoutes;
