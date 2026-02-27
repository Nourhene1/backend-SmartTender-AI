export async function adminOnly(c, next) {
  const user = c.get("user");

  if (!user) {
    return c.json({ message: "Non authentifié" }, 401);
  }

  if (user.role !== "ADMIN") {
    return c.json({ message: "Accès réservé aux admins" }, 403);
  }

  await next();
}
