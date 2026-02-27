import request from "supertest";
import { serve } from "@hono/node-server";
import jwt from "jsonwebtoken";
import { ObjectId } from "mongodb";
import bcrypt from "bcryptjs";

import app from "../server.js";
import { getDB } from "../models/db.js";

let server;
let baseUrl;
let adminToken;
let userId;

beforeAll(async () => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || "test_secret";

  server = serve({
    fetch: app.fetch,
    port: 4020,
  });

  baseUrl = "http://localhost:4020";

  await new Promise(r => setTimeout(r, 300));

  const db = getDB();

  // 🧹 clean
  await db.collection("users").deleteMany({ email: /test-user/ });

  // ✅ create ADMIN directly
  const adminId = new ObjectId();
  const adminPass = await bcrypt.hash("123456", 10);

  await db.collection("users").insertOne({
    _id: adminId,
    email: "test-user-admin@test.com",
    password: adminPass,
    nom: "Admin",
    prenom: "Test",
    role: "ADMIN",
    createdAt: new Date(),
  });

  // ✅ JWT admin (role required by adminOnly)
  adminToken = jwt.sign(
    {
      id: adminId.toString(),
      email: "test-user-admin@test.com",
      role: "ADMIN",
    },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );
});

afterAll(async () => {
  await server.close();
});

describe("Users API", () => {

  test("admin can register recruiter", async () => {
    const res = await request(baseUrl)
      .post("/users/register")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        nom: "Test",
        prenom: "User",
        email: "test-user1@test.com",
        password: "123456",
        role: "RECRUITER"
      });

    expect(res.statusCode).toBe(201);
  });


  test("user can login", async () => {
    const res = await request(baseUrl)
      .post("/users/login")
      .send({
        email: "test-user1@test.com",
        password: "123456",
      });

    expect(res.statusCode).toBe(200);
    userId = res.body.user.id;
  });


  test("admin can get users", async () => {
    const res = await request(baseUrl)
      .get("/users")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.statusCode).toBe(200);
  });


  test("admin can update user", async () => {
    const res = await request(baseUrl)
      .patch(`/users/${userId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ nom: "Updated" });

    expect(res.statusCode).toBe(200);
  });


  /* ✅ DELETE AVANT LOGOUT */
  test("admin can delete user", async () => {
    const res = await request(baseUrl)
      .delete(`/users/${userId}`)
      .set("Authorization", `Bearer ${adminToken}`);

    console.log("DELETE STATUS =", res.statusCode, res.body);
    expect(res.statusCode).toBe(200);
  });


  /* ✅ LOGOUT EN DERNIER */
  test("admin can logout", async () => {
    const res = await request(baseUrl)
      .post("/users/logout")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.statusCode).toBe(200);
  });

});
