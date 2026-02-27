import {
  createRole,
  deleteRole,
  findAllRoles,
  findRoleById,
  updateRoleById,
} from "../models/Role.js";

/* =========================
   GET /roles
========================= */
export async function getRolesController(c) {
  try {
    const roles = await findAllRoles();
    return c.json({ roles });
  } catch (err) {
    return c.json(
      { message: "Server error", error: err.message },
      500
    );
  }
}

/* =========================
   POST /roles
   body: { name }
========================= */
export async function createRoleController(c) {
  try {
    const body = await c.req.json();
    const name = body?.name;

    const result = await createRole({ name });

    if (result.alreadyExists) {
      return c.json(
        { message: "Role already exists", role: result.role },
        409
      );
    }

    return c.json(
      { message: "Role created", role: result.role },
      201
    );
  } catch (err) {
    return c.json({ message: err.message }, 400);
  }
}

/* =========================
   DELETE /roles/:id
========================= */
export async function deleteRoleController(c) {
  try {
    const id = c.req.param("id");

    const role = await findRoleById(id);
    if (!role) {
      return c.json({ message: "Role not found" }, 404);
    }

    if (role.name === "ADMIN") {
      return c.json({ message: "Cannot delete ADMIN role" }, 400);
    }

    await deleteRole(id);

    return c.json({ message: "Role deleted" });
  } catch (err) {
    return c.json(
      { message: "Server error", error: err.message },
      500
    );
  }
}




export const updateRoleController = async (c) => {
  try {
    const id = c.req.param("id");
    const body = await c.req.json();

    if (!body?.name) {
      return c.json({ message: "Nom du rôle requis" }, 400);
    }

    const existing = await findRoleById(id);
    if (!existing) {
      return c.json({ message: "Rôle introuvable" }, 404);
    }

    const result = await updateRoleById(id, body.name);

    // 🔴 duplicate name
    if (result?.duplicate) {
      return c.json(
        { message: "Un rôle avec ce nom existe déjà" },
        409
      );
    }

    // ✅ même si result.role est null, on considère SUCCESS
    return c.json(
      {
        message: "Rôle modifié avec succès",
        role: result?.role || { ...existing, name: body.name },
      },
      200
    );

  } catch (err) {
    console.error("❌ updateRole error:", err);
    return c.json(
      { message: "Erreur serveur lors de la modification du rôle" },
      500
    );
  }
};
