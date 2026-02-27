import request from "supertest";
import { serve } from "@hono/node-server";
import app from "../server.js";
import { getDB } from "../models/db.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

let server;
let baseUrl;
let adminToken;
let jobId;
let adminUserId;

beforeAll(async () => {
  // Start test server
  server = serve({
    fetch: app.fetch,
    port: 4002,
  });

  baseUrl = "http://localhost:4002";

  // Wait for server to start
  await new Promise((r) => setTimeout(r, 500));

  const db = getDB();

  // 🧹 Clean database
  await db.collection("users").deleteMany({ email: /test-admin/ });
  await db.collection("job_offers").deleteMany({ titre: /Test Job/ });

  console.log("🧹 Database cleaned");

  // ✅ CREATE ADMIN USER DIRECTLY IN DATABASE
  const hashedPassword = await bcrypt.hash("123456", 10);
  
  const adminUser = await db.collection("users").insertOne({
    nom: "Test",
    prenom: "Admin",
    email: "test-admin@test.com",
    password: hashedPassword,
    role: "ADMIN", // ⚠️ UPPERCASE to match middleware: user.role !== "ADMIN"
    createdAt: new Date(),
  });

  adminUserId = adminUser.insertedId;
  console.log("👤 Admin user created directly in DB:", adminUserId);

  // ✅ VERIFY USER IN DB
  const userInDb = await db.collection("users").findOne({ _id: adminUserId });
  console.log("🔍 User in DB:", {
    id: userInDb._id,
    email: userInDb.email,
    role: userInDb.role,
  });

  // ✅ GENERATE JWT TOKEN DIRECTLY
  const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key-here";
  
  // 🔑 Token payload - MUST match what authMiddleware expects
  const tokenPayload = {
    userId: adminUserId.toString(),
    email: "test-admin@test.com",
    role: "ADMIN", // ⚠️ UPPERCASE to match middleware check
  };

  adminToken = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: "24h" });

  console.log("🔑 Admin token generated");

  // ✅ VERIFY TOKEN
  try {
    const decoded = jwt.verify(adminToken, JWT_SECRET);
    console.log("✅ Token verified - role:", decoded.role);
  } catch (err) {
    console.error("❌ Token verification failed:", err.message);
    throw new Error("Token generation failed");
  }
});

afterAll(async () => {
  // Clean up test data
  const db = getDB();
  await db.collection("users").deleteMany({ email: /test-admin/ });
  await db.collection("job_offers").deleteMany({ titre: /Test Job/ });
  
  console.log("🧹 Test data cleaned up");
  
  // Close server
  if (server && typeof server.close === 'function') {
    await server.close();
  }
});

describe("Jobs API (admin)", () => {
  
  // ✅ CREATE
  test("admin can create a job with dateCloture", async () => {
    const res = await request(baseUrl)
      .post("/jobs")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        titre: "Test Job Backend",
        description: "Node.js + MongoDB",
        technologies: ["Node.js", "JWT"],
        dateCloture: "2025-06-30",
        scores: {
          skillsFit: 30,
          experienceFit: 25,
          projectsFit: 20,
          educationFit: 15,
          communicationFit: 10,
        },
      });

    console.log("📝 Create job response:", res.status, res.body);

    expect(res.statusCode).toBe(201);
    expect(res.body.id).toBeDefined();

    jobId = res.body.id;
  });

  // ✅ GET ALL
  test("can get all jobs", async () => {
    const res = await request(baseUrl).get("/jobs");

    console.log("📋 Get all jobs response:", res.status);

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  // ✅ GET BY ID
  test("can get job by id", async () => {
    if (!jobId) {
      console.warn("⚠️ Skipping test: jobId is undefined");
      return;
    }

    const res = await request(baseUrl).get(`/jobs/${jobId}`);

    console.log("🔍 Get job by ID response:", res.status);

    expect(res.statusCode).toBe(200);
    expect(res.body._id).toBeDefined();
    expect(res.body.titre).toBe("Test Job Backend");
  });

  // ✅ UPDATE
  test("admin can update a job dateCloture", async () => {
    if (!jobId) {
      console.warn("⚠️ Skipping test: jobId is undefined");
      return;
    }

    const res = await request(baseUrl)
      .put(`/jobs/${jobId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        titre: "Updated Job Title",
        description: "Updated description",
        technologies: ["Node.js", "MongoDB", "JWT"],
        dateCloture: "2025-07-31",
      });

    console.log("✏️ Update job response:", res.status, res.body);

    expect(res.statusCode).toBe(200);
    expect(res.body.message).toBe("Offre mise à jour");
  });

  // ✅ GET WITH CANDIDATURE COUNT
  test("admin can get jobs with candidature count", async () => {
    const res = await request(baseUrl)
      .get("/jobs/with-candidatures-count")
      .set("Authorization", `Bearer ${adminToken}`);

    console.log("📊 Get jobs with count response:", res.status);

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  // ✅ GET COUNT
  test("admin can get job count", async () => {
    const res = await request(baseUrl)
      .get("/jobs/count")
      .set("Authorization", `Bearer ${adminToken}`);

    console.log("🔢 Get job count response:", res.status, res.body);

    expect(res.statusCode).toBe(200);
    expect(res.body.count).toBeDefined();
    expect(typeof res.body.count).toBe("number");
  });

  // ✅ CHECK IF CLOSED
  test("can check if job is closed", async () => {
    if (!jobId) {
      console.warn("⚠️ Skipping test: jobId is undefined");
      return;
    }

    const res = await request(baseUrl).get(`/jobs/${jobId}/is-closed`);

    console.log("🔒 Check job closed response:", res.status, res.body);

    expect(res.statusCode).toBe(200);
    expect(res.body.isClosed).toBeDefined();
    expect(typeof res.body.isClosed).toBe("boolean");
  });

  // ✅ DELETE
  test("admin can delete a job", async () => {
    if (!jobId) {
      console.warn("⚠️ Skipping test: jobId is undefined");
      return;
    }

    const res = await request(baseUrl)
      .delete(`/jobs/${jobId}`)
      .set("Authorization", `Bearer ${adminToken}`);

    console.log("🗑️ Delete job response:", res.status, res.body);

    expect(res.statusCode).toBe(200);
    expect(res.body.message).toBe("Offre supprimée");
  });

  // ✅ VERIFY DELETION
  test("deleted job should not be found", async () => {
    if (!jobId) {
      console.warn("⚠️ Skipping test: jobId is undefined");
      return;
    }

    const res = await request(baseUrl).get(`/jobs/${jobId}`);

    console.log("🔍 Get deleted job response:", res.status);

    expect(res.statusCode).toBe(404);
  });
});

describe("Jobs API (validation)", () => {
  
  // ✅ INVALID ID
  test("returns 400 for invalid job ID", async () => {
    const res = await request(baseUrl).get("/jobs/invalid-id");

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe("ID invalide");
  });

  // ✅ MISSING REQUIRED FIELDS
  test("admin cannot create job without required fields", async () => {
    const res = await request(baseUrl)
      .post("/jobs")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        technologies: ["Node.js"],
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe("Titre et description obligatoires");
  });

  // ✅ UNAUTHORIZED ACCESS
  test("cannot access admin routes without token", async () => {
    const res = await request(baseUrl).post("/jobs").send({
      titre: "Test",
      description: "Test",
    });

    expect(res.statusCode).toBe(401);
  });
});