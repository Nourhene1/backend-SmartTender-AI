import { jest } from "@jest/globals";
import request from "supertest";
import { serve } from "@hono/node-server";
import path from "path";

const mockAxios = {
  post: jest.fn(),
  get: jest.fn(),
};

jest.unstable_mockModule("axios", () => ({
  default: mockAxios,
}));

const app = (await import("../server.js")).default;
const { getDB } = await import("../models/db.js");

let server;
let baseUrl;
let adminToken;
let jobId;
let candidatureId;

beforeAll(async () => {
  server = serve({
    fetch: app.fetch,
    port: 4004,
  });

  baseUrl = "http://localhost:4004";
  await new Promise((r) => setTimeout(r, 300));

  const db = getDB();

  // تنظيف
  await db.collection("users").deleteMany({ email: /test-admin/ });
  await db.collection("job_offers").deleteMany({ titre: /Test Job Backend/ });
  await db.collection("candidatures").deleteMany({});

  // 👤 REGISTER
  await request(baseUrl).post("/users/register").send({
    nom: "Test",
    prenom: "admin",
    email: "test-admin@test.com",
    password: "123456",
  });

  // فرض role
  await db.collection("users").updateOne(
    { email: "test-admin@test.com" },
    { $set: { role: "admin" } }
  );

  // 🔐 LOGIN
  const loginRes = await request(baseUrl).post("/users/login").send({
    email: "test-admin@test.com",
    password: "123456",
  });

  adminToken = loginRes.body.token;

  // 📌 CREATE JOB
  const jobRes = await request(baseUrl)
    .post("/jobs")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      titre: "Test Job Backend",
      description: "Node.js + MongoDB",
      technologies: ["Node.js", "JWT"],
      dateCloture: "2025-06-30",
    });

  jobId = jobRes.body.id;
});

afterAll(async () => {
  await server.close();
});

describe("Applications API (Upload CV + Confirm)", () => {
  test("UPLOAD CV -> should return candidatureId + extracted data", async () => {
    // FastAPI start extraction
    mockAxios.post.mockResolvedValueOnce({
      data: { job_id: "fake_job_123" },
    });

    // FastAPI status
    mockAxios.get.mockResolvedValueOnce({
      data: {
        status: "COMPLETED",
        result: {
          personal_info: { full_name: "Test Candidate", email: "test@mail.com" },
          skills: ["Node.js", "React"],
        },
      },
    });

    const pdfPath = path.join(process.cwd(), "tests", "fixtures", "cv_test.pdf");

    const res = await request(baseUrl)
      .post(`/api/applications/${jobId}/cv`)
      .attach("cv", pdfPath);

    expect(res.statusCode).toBe(200);
    expect(res.body.candidatureId).toBeDefined();
    expect(res.body.extracted).toBeDefined();

    candidatureId = res.body.candidatureId;
  });

  test("CONFIRM -> should submit candidature", async () => {
    const res = await request(baseUrl)
      .post(`/api/applications/${candidatureId}/confirm`)
      .send({
        message: "Je confirme ma candidature",
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.message).toBe("Candidature envoyée");
  });
});
