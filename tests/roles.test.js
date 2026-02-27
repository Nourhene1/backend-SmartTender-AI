import request from "supertest";
import { serve } from "@hono/node-server";
import jwt from "jsonwebtoken";
import { ObjectId } from "mongodb";

import app from "../server.js";
import { getDB } from "../models/db.js";

let server;
let baseUrl;
let adminToken;
let roleId;

beforeAll(async () => {
  // ✅ IMPORTANT — même secret que verifyToken()
  process.env.JWT_SECRET = process.env.JWT_SECRET || "test_secret";

  server = serve({
    fetch: app.fetch,
    port: 4010,
  });

  baseUrl = "http://localhost:4010";

  await new Promise((r) => setTimeout(r, 300));

  const db = getDB();

  // 🧹 clean test data
  await db.collection("roles").deleteMany({ name: /TEST_ROLE/ });
  await db.collection("users").deleteMany({ email: "admin-test@test.com" });

  // ✅ ensure ADMIN role exists
  const adminRole = await db.collection("roles").findOne({ name: "ADMIN" });
  if (!adminRole) {
    await db.collection("roles").insertOne({
      name: "ADMIN",
      createdAt: new Date(),
    });
  }

  // ✅ create admin user directly in DB
  const adminUser = {
    _id: new ObjectId(),
    email: "admin-test@test.com",
    nom: "Admin",
    prenom: "Test",
    password: "hashed",
    role: "ADMIN",
    createdAt: new Date(),
  };

  await db.collection("users").insertOne(adminUser);

  // ✅ generate JWT manually (same structure authMiddleware expects)
  adminToken = jwt.sign(
    {
      id: adminUser._id.toString(),
      role: "ADMIN",
      email: adminUser.email,
    },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );
});

afterAll(async () => {
  await server.close();
});

describe("Roles API", () => {

  test("admin can create role", async () => {
    const res = await request(baseUrl)
      .post("/roles")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "TEST_ROLE_DEV" });

    expect(res.statusCode).toBe(201);
    expect(res.body.role).toBeDefined();

    roleId = res.body.role._id;
  });


  test("duplicate role blocked", async () => {
    const res = await request(baseUrl)
      .post("/roles")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "TEST_ROLE_DEV" });

    expect(res.statusCode).toBe(409);
  });


  test("get roles", async () => {
    const res = await request(baseUrl)
      .get("/roles")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.roles)).toBe(true);
  });


  test("admin can update role", async () => {
    const res = await request(baseUrl)
      .put(`/roles/${roleId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "TEST_ROLE_UPDATED" });

    expect(res.statusCode).toBe(200);
    expect(res.body.role.name).toBe("TEST_ROLE_UPDATED");
  });


  test("admin can delete role", async () => {
    const res = await request(baseUrl)
      .delete(`/roles/${roleId}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.message).toBe("Role deleted");
  });

});
