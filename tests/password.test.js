import request from "supertest";
import { serve } from "@hono/node-server";
import { ObjectId } from "mongodb";
import bcrypt from "bcryptjs";

import app from "../server.js";
import { getDB } from "../models/db.js";

let server;
let baseUrl;
let resetCode;

beforeAll(async () => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || "test_secret";

  server = serve({
    fetch: app.fetch,
    port: 4021, // Port différent pour éviter les conflits
  });

  baseUrl = "http://localhost:4021";

  await new Promise(r => setTimeout(r, 300));

  const db = getDB();

  // 🧹 Nettoyer les données de test
  await db.collection("users").deleteMany({ email: "test-user-reset@test.com" });
  await db.collection("reset_codes").deleteMany({ email: "test-user-reset@test.com" });

  // ✅ Créer un utilisateur pour les tests
  const hashedPass = await bcrypt.hash("oldpassword", 10);

  await db.collection("users").insertOne({
    _id: new ObjectId(),
    email: "test-user-reset@test.com",
    password: hashedPass,
    nom: "Reset",
    prenom: "Test",
    role: "RECRUITER",
    createdAt: new Date(),
  });
});

afterAll(async () => {
  const db = getDB();
  await db.collection("users").deleteMany({ email: "test-user-reset@test.com" });
  await db.collection("reset_codes").deleteMany({ email: "test-user-reset@test.com" });
  await server.close();
});

/* ========================================
   TESTS POUR RÉCUPÉRATION MOT DE PASSE
======================================== */
describe("Password Recovery API", () => {

  /* ✅ Test: Email obligatoire */
  test("forgot password requires email", async () => {
    const res = await request(baseUrl)
      .post("/password/forgot")
      .send({});

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe("Email obligatoire");
  });


  /* ✅ Test: Email non existant retourne 404 */
  test("forgot password with non-existing email returns 404", async () => {
    const res = await request(baseUrl)
      .post("/password/forgot")
      .send({ email: "nonexistent@test.com" });

    expect(res.statusCode).toBe(404);
    expect(res.body.message).toBe("Aucun compte n'est associé à cet email");
  });


  /* ✅ Test: Email existant envoie le code */
  test("forgot password with existing email sends code", async () => {
    const res = await request(baseUrl)
      .post("/password/forgot")
      .send({ email: "test-user-reset@test.com" });

    expect(res.statusCode).toBe(200);
    expect(res.body.email).toBe("test-user-reset@test.com");

    // Récupérer le code depuis la base pour les tests suivants
    const db = getDB();
    const codeDoc = await db.collection("reset_codes").findOne({
      email: "test-user-reset@test.com",
      used: false,
    });
    resetCode = codeDoc?.code;
  });


  /* ✅ Test: Vérification code - email et code obligatoires */
  test("verify code requires email and code", async () => {
    const res = await request(baseUrl)
      .post("/password/verify-code")
      .send({ email: "test-user-reset@test.com" });

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe("Email et code obligatoires");
  });


  /* ✅ Test: Vérification code invalide */
  test("verify code with invalid code returns error", async () => {
    const res = await request(baseUrl)
      .post("/password/verify-code")
      .send({
        email: "test-user-reset@test.com",
        code: "000000",
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe("Code invalide ou expiré");
  });


  /* ✅ Test: Vérification code valide */
  test("verify code with valid code succeeds", async () => {
    const res = await request(baseUrl)
      .post("/password/verify-code")
      .send({
        email: "test-user-reset@test.com",
        code: resetCode,
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.verified).toBe(true);
  });


  /* ✅ Test: Reset password - validation mot de passe */
  test("reset password requires minimum 6 characters", async () => {
    const res = await request(baseUrl)
      .post("/password/reset")
      .send({
        email: "test-user-reset@test.com",
        code: resetCode,
        newPassword: "123",
        confirmPassword: "123",
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe("Le mot de passe doit contenir au moins 6 caractères");
  });


  /* ✅ Test: Reset password - mots de passe ne correspondent pas */
  test("reset password fails if passwords do not match", async () => {
    const res = await request(baseUrl)
      .post("/password/reset")
      .send({
        email: "test-user-reset@test.com",
        code: resetCode,
        newPassword: "newpassword123",
        confirmPassword: "differentpassword",
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe("Les mots de passe ne correspondent pas");
  });


  /* ✅ Test: Reset password réussi */
  test("reset password succeeds with valid data", async () => {
    const res = await request(baseUrl)
      .post("/password/reset")
      .send({
        email: "test-user-reset@test.com",
        code: resetCode,
        newPassword: "newpassword123",
        confirmPassword: "newpassword123",
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });


  /* ✅ Test: Code déjà utilisé ne fonctionne plus */
  test("used code cannot be reused", async () => {
    const res = await request(baseUrl)
      .post("/password/verify-code")
      .send({
        email: "test-user-reset@test.com",
        code: resetCode,
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe("Code invalide ou expiré");
  });


  /* ✅ Test: Login avec nouveau mot de passe */
  test("user can login with new password", async () => {
    const res = await request(baseUrl)
      .post("/users/login")
      .send({
        email: "test-user-reset@test.com",
        password: "newpassword123",
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.token).toBeDefined();
  });


  /* ✅ Test: Ancien mot de passe ne fonctionne plus */
  test("old password no longer works", async () => {
    const res = await request(baseUrl)
      .post("/users/login")
      .send({
        email: "test-user-reset@test.com",
        password: "oldpassword",
      });

    expect(res.statusCode).toBe(401);
  });


  /* ✅ Test: Resend code fonctionne */
  test("resend code works for existing email", async () => {
    const res = await request(baseUrl)
      .post("/password/resend-code")
      .send({ email: "test-user-reset@test.com" });

    expect(res.statusCode).toBe(200);
  });

});