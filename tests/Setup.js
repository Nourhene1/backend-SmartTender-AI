// tests/setup.js
// This file runs once before all tests

import { connectDB, closeDB } from "../models/db.js";

// ✅ Global setup - connect to DB once before all tests
beforeAll(async () => {
  console.log("🔌 Connecting to test database...");
  await connectDB();
  console.log("✅ Database connected");
}, 30000); // 30 second timeout for initial connection

// ✅ Global teardown - close DB connection after all tests
afterAll(async () => {
  console.log("🔌 Closing database connection...");
  await closeDB();
  console.log("✅ Database connection closed");
}, 10000);