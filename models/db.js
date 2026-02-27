// models/db.js
import { MongoClient } from "mongodb";

let client;
let db;

export async function connectDB() {
  if (db) return db;

  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error("MONGO_URI is missing in .env");

  client = new MongoClient(uri);
  await client.connect();

  db = client.db(process.env.DB_NAME || "ia_recruiter");
  console.log("✅ MongoDB connected:", db.databaseName);

  return db;
}

export function getDB() {
  if (!db) throw new Error("DB not initialized. Call connectDB() first.");
  return db;
}
