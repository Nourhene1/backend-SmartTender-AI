/* =========================
   ENV & MOCKS (IMPORTANT)
========================= */
process.env.JWT_SECRET = "test_secret";

import { jest } from "@jest/globals";

// 🧨 mock mailer
jest.mock("../config/mailer.js", () => ({
  sendMail: jest.fn().mockResolvedValue(true),
}));

// 🧨 mock ML service
global.fetch = jest.fn();

import request from "supertest";
import { serve } from "@hono/node-server";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { ObjectId } from "mongodb";
import path from "path";
import fs from "fs";

import app from "../server.js";
import { getDB } from "../models/db.js";

/* =========================
   GLOBAL VARS
========================= */
let server;
let baseUrl;

let adminToken;
let userToken;
let jobId;
let candidatureId;
let userId;
let adminId;

/* =========================
   SETUP
========================= */
beforeAll(async () => {
  server = serve({
    fetch: app.fetch,
    port: 4010,
  });

  baseUrl = "http://localhost:4010";
  await new Promise((r) => setTimeout(r, 500));

  const db = getDB();

  // 🧹 CLEAN DB
  await db.collection("users").deleteMany({ email: /test-(admin|user)/ });
  await db.collection("job_offers").deleteMany({ titre: /Test Job For CV/ });
  await db.collection("candidatures").deleteMany({});

  /* ========= CREATE ADMIN ========= */
  adminId = new ObjectId();
  await db.collection("users").insertOne({
    _id: adminId,
    email: "test-admin@test.com",
    password: await bcrypt.hash("123456", 10),
    nom: "Admin",
    prenom: "Test",
    role: "ADMIN",
    createdAt: new Date(),
  });

  // ✅ FIX: Use correct token structure (id not userId)
  adminToken = jwt.sign(
    {
      id: adminId.toString(),
      userId: adminId.toString(), // Some middleware may use userId
      email: "test-admin@test.com",
      role: "ADMIN",
    },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );

  console.log("✅ Admin token created");

  /* ========= CREATE USER ========= */
  userId = new ObjectId();
  await db.collection("users").insertOne({
    _id: userId,
    email: "test-user@test.com",
    password: await bcrypt.hash("123456", 10),
    nom: "User",
    prenom: "Test",
    role: "USER",
    createdAt: new Date(),
  });

  // ✅ FIX: Use correct token structure (id not userId)
  userToken = jwt.sign(
    {
      id: userId.toString(),
      userId: userId.toString(), // Some middleware may use userId
      email: "test-user@test.com",
      role: "USER",
    },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );

  console.log("✅ User token created");

  /* ========= CREATE JOB ========= */
  const jobRes = await request(baseUrl)
    .post("/jobs")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      titre: "Test Job For CV",
      description: "Test job description",
      technologies: ["Node.js"],
      dateCloture: "2025-06-30",
    });

  expect(jobRes.statusCode).toBe(201);
  jobId = jobRes.body.id;
  
  console.log("✅ Test job created:", jobId);

  // ✅ CREATE TEST PDF IF NOT EXISTS
  const testPdfPath = path.join(process.cwd(), "tests", "fixtures", "cv_test.pdf");
  const fixturesDir = path.dirname(testPdfPath);
  
  if (!fs.existsSync(fixturesDir)) {
    fs.mkdirSync(fixturesDir, { recursive: true });
  }
  
  if (!fs.existsSync(testPdfPath)) {
    // Create a minimal PDF file
    const minimalPdf = Buffer.from([
      0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, // %PDF-1.4
      0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a, // binary comment
      0x31, 0x20, 0x30, 0x20, 0x6f, 0x62, 0x6a, 0x0a, // 1 0 obj
      0x3c, 0x3c, 0x2f, 0x54, 0x79, 0x70, 0x65, 0x2f, 0x43, 0x61, 0x74, 0x61, 0x6c, 0x6f, 0x67, 0x2f, 0x50, 0x61, 0x67, 0x65, 0x73, 0x20, 0x32, 0x20, 0x30, 0x20, 0x52, 0x3e, 0x3e, 0x0a, // <</Type/Catalog/Pages 2 0 R>>
      0x65, 0x6e, 0x64, 0x6f, 0x62, 0x6a, 0x0a, // endobj
      0x32, 0x20, 0x30, 0x20, 0x6f, 0x62, 0x6a, 0x0a, // 2 0 obj
      0x3c, 0x3c, 0x2f, 0x54, 0x79, 0x70, 0x65, 0x2f, 0x50, 0x61, 0x67, 0x65, 0x73, 0x2f, 0x4b, 0x69, 0x64, 0x73, 0x5b, 0x33, 0x20, 0x30, 0x20, 0x52, 0x5d, 0x2f, 0x43, 0x6f, 0x75, 0x6e, 0x74, 0x20, 0x31, 0x3e, 0x3e, 0x0a, // <</Type/Pages/Kids[3 0 R]/Count 1>>
      0x65, 0x6e, 0x64, 0x6f, 0x62, 0x6a, 0x0a, // endobj
      0x33, 0x20, 0x30, 0x20, 0x6f, 0x62, 0x6a, 0x0a, // 3 0 obj
      0x3c, 0x3c, 0x2f, 0x54, 0x79, 0x70, 0x65, 0x2f, 0x50, 0x61, 0x67, 0x65, 0x2f, 0x50, 0x61, 0x72, 0x65, 0x6e, 0x74, 0x20, 0x32, 0x20, 0x30, 0x20, 0x52, 0x2f, 0x4d, 0x65, 0x64, 0x69, 0x61, 0x42, 0x6f, 0x78, 0x5b, 0x30, 0x20, 0x30, 0x20, 0x36, 0x31, 0x32, 0x20, 0x37, 0x39, 0x32, 0x5d, 0x3e, 0x3e, 0x0a, // <</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>
      0x65, 0x6e, 0x64, 0x6f, 0x62, 0x6a, 0x0a, // endobj
      0x78, 0x72, 0x65, 0x66, 0x0a, // xref
      0x30, 0x20, 0x34, 0x0a, // 0 4
      0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x20, 0x36, 0x35, 0x35, 0x33, 0x35, 0x20, 0x66, 0x20, 0x0a, // 0000000000 65535 f
      0x74, 0x72, 0x61, 0x69, 0x6c, 0x65, 0x72, 0x0a, // trailer
      0x3c, 0x3c, 0x2f, 0x53, 0x69, 0x7a, 0x65, 0x20, 0x34, 0x2f, 0x52, 0x6f, 0x6f, 0x74, 0x20, 0x31, 0x20, 0x30, 0x20, 0x52, 0x3e, 0x3e, 0x0a, // <</Size 4/Root 1 0 R>>
      0x73, 0x74, 0x61, 0x72, 0x74, 0x78, 0x72, 0x65, 0x66, 0x0a, // startxref
      0x32, 0x31, 0x38, 0x0a, // 218
      0x25, 0x25, 0x45, 0x4f, 0x46 // %%EOF
    ]);
    fs.writeFileSync(testPdfPath, minimalPdf);
    console.log("✅ Test PDF created");
  }
});

/* =========================
   TEARDOWN
========================= */
afterAll(async () => {
  const db = getDB();
  await db.collection("users").deleteMany({ email: /test-(admin|user)/ });
  await db.collection("job_offers").deleteMany({ titre: /Test Job For CV/ });
  await db.collection("candidatures").deleteMany({});
  
  await server.close();
  console.log("🧹 Cleanup completed");
});

/* =========================
   TESTS
========================= */
describe("Candidatures API (Extract + Count)", () => {

  test("EXTRACT -> success", async () => {
    // ✅ Mock ML service response
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        personal_info: {
          full_name: "Test Candidate",
          email: "test@mail.com",
        },
        skills: ["Node.js", "React"],
      }),
    });

    const pdfPath = path.join(
      process.cwd(),
      "tests",
      "fixtures",
      "cv_test.pdf"
    );

    const res = await request(baseUrl)
      .post("/candidatures/extract")
      .set("Authorization", `Bearer ${userToken}`)
      .field("jobOfferId", jobId.toString())
      .attach("cv", pdfPath);

    console.log("📝 Extract response:", res.status, res.body);

    expect(res.statusCode).toBe(200);
    expect(res.body.candidatureId).toBeDefined();
    
    // Save for next tests
    candidatureId = res.body.candidatureId;
  });

  test("COUNT -> admin OK", async () => {
    const res = await request(baseUrl)
      .get("/candidatures/count")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.statusCode).toBe(200);
    expect(typeof res.body.count).toBe("number");
  });

  test("COUNT -> user forbidden", async () => {
    const res = await request(baseUrl)
      .get("/candidatures/count")
      .set("Authorization", `Bearer ${userToken}`);

    expect(res.statusCode).toBe(403);
  });

  test("EXTRACT -> missing jobOfferId", async () => {
    const pdfPath = path.join(
      process.cwd(),
      "tests",
      "fixtures",
      "cv_test.pdf"
    );

    const res = await request(baseUrl)
      .post("/candidatures/extract")
      .set("Authorization", `Bearer ${userToken}`)
      .attach("cv", pdfPath);

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe("jobOfferId est requis");
  });

  test("EXTRACT -> missing CV", async () => {
    const res = await request(baseUrl)
      .post("/candidatures/extract")
      .set("Authorization", `Bearer ${userToken}`)
      .field("jobOfferId", jobId.toString());

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe("Fichier CV requis");
  });

  test("EXTRACT -> CV present", async () => {
    // ✅ Mock ML service response
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        personal_info: { full_name: "Test", email: "test@mail.com" },
        skills: [],
      }),
    });

    const pdfPath = path.join(
      process.cwd(),
      "tests",
      "fixtures",
      "cv_test.pdf"
    );

    const res = await request(baseUrl)
      .post("/candidatures/extract")
      .set("Authorization", `Bearer ${userToken}`)
      .field("jobOfferId", jobId.toString())
      .attach("cv", pdfPath);

    expect(res.statusCode).toBe(200);
  });

  test("AUTH -> candidatures routes require token", async () => {
    const res = await request(baseUrl)
      .get("/candidatures/my");

    expect(res.statusCode).toBe(401);
    expect(res.body.message).toBe("Token manquant");
  });

  test("GET MY CANDIDATURES -> returns user candidatures", async () => {
    const res = await request(baseUrl)
      .get("/candidatures/my")
      .set("Authorization", `Bearer ${userToken}`);

    console.log("📋 My candidatures response:", res.status);

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test("PATCH personal info -> success", async () => {
    if (!candidatureId) {
      console.warn("⚠️ Skipping: candidatureId not set");
      return;
    }

    const res = await request(baseUrl)
      .patch(`/candidatures/${candidatureId}/personal-info`)
      .send({ telephone: "12345678" });

    console.log("✏️ Update personal info response:", res.status, res.body);

    expect(res.statusCode).toBe(200);
  });

  test("GET candidatures with job -> admin OK", async () => {
    const res = await request(baseUrl)
      .get("/candidatures/with-job")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.statusCode).toBe(200);
  });

  test("GET candidatures with job -> user forbidden", async () => {
    const res = await request(baseUrl)
      .get("/candidatures/with-job")
      .set("Authorization", `Bearer ${userToken}`);

    expect(res.statusCode).toBe(403);
  });
});