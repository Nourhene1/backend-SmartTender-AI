import { verifyToken } from "../utils/jwt.js";
import { isTokenRevoked } from "../models/revokedToken.model.js";

export async function authMiddleware(c, next) {
  const authHeader =
    c.req.header("Authorization") ||
    c.req.header("authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ message: "Token manquant" }, 401);
  }

  const token = authHeader.split(" ")[1];

  // 🔥 check blacklist
  const revoked = await isTokenRevoked(token);
  if (revoked) {
    return c.json({ message: "Token révoqué, veuillez vous reconnecter" }, 401);
  }

  try {
    const decoded = verifyToken(token);
    c.set("user", decoded);
    await next();
  } catch (err) {
    console.error("❌ JWT VERIFY ERROR =", err.message);
    return c.json({ message: "Token invalide ou expiré" }, 401);
  }
}
