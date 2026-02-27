// middleware/auth.js
import { createMiddleware } from "hono/factory";
import jwt from "jsonwebtoken";

export const verifyToken = createMiddleware(async (c, next) => {
  const auth = c.req.header("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

  if (!token) return c.json({ message: "Unauthorized" }, 401);

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    c.set("user", payload);
    await next();
  } catch (e) {
    return c.json({ message: "Unauthorized" }, 401);
  }
});
