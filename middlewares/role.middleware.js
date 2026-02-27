// src/middlewares/role.middleware.js
export function requireRole(...allowedRoles) {
  return async (c, next) => {
    const user = c.get("user");
    if (!user) return c.json({ message: "Non authentifié" }, 401);

    // ✅ support plusieurs formats JWT
    const role =
      user.role ||
      user?.user?.role ||
      user?.payload?.role ||
      user?.data?.role;

    if (!role) {
      return c.json({ message: "Rôle manquant dans le token" }, 403);
    }

    if (!allowedRoles.includes(role)) {
      return c.json(
        { message: `Accès refusé. Rôle requis: ${allowedRoles.join(", ")}` },
        403
      );
    }

    await next();
  };
}