import request from "supertest";
import { serve } from "@hono/node-server";
import app from "../server.js";
import { closeDB } from "../models/db.js";

let server;
let baseUrl;
let token; 

beforeAll((done) => {
  server = serve({
    fetch: app.fetch,
    port: 4001,
  });

  baseUrl = "http://localhost:4001";

  setTimeout(done, 500);
}, 10000);

afterAll(async () => {
  await closeDB();
  server.close();
});

describe("Auth API (Register, Login, Logout)", () => {

  const user = {
    nom: "Test",
    prenom: "User",
    email: "testuser@test.com",
    password: "123456",
  };

  // ================= REGISTER =================
  test("REGISTER → should create a new user", async () => {
    const res = await request(baseUrl)
      .post("/users/register")
      .send(user);

    expect([201, 409]).toContain(res.statusCode);
  }, 10000);

  // ================= LOGIN =================
  test("LOGIN → should return JWT token", async () => {
    const res = await request(baseUrl)
      .post("/users/login")
      .send({
        email: user.email,
        password: user.password,
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.token).toBeDefined();

    token = res.body.token; // 💾 sauvegarde pour logout
  }, 10000);

  // ================= LOGOUT =================
  test("LOGOUT → should logout user (token accepted)", async () => {
    const res = await request(baseUrl)
      .post("/users/logout")
      .set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.message).toBeDefined();
  }, 10000);

});
