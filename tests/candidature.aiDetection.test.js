import { ObjectId } from "mongodb";
import { connectDB, closeDB, getDB } from "../models/db.js";
import {
  createCandidature,
  findPendingAiDetection,
  lockAiDetection,
  markAiDetectionDone,
  markAiDetectionFailed,
} from "../models/candidature.model.js";

describe("Candidature Model – AI Detection", () => {
  let candidatureId;

  // ✅ FIX: Connect to DB in this test file
  beforeAll(async () => {
    // Connect to database
    await connectDB();
    
    // Clean collection
    await getDB().collection("candidatures").deleteMany({});

    // Create test candidature
    const res = await createCandidature({
      userId: new ObjectId(),
      jobOfferId: new ObjectId(),
      cv: { filename: "cv.pdf" },
    });

    candidatureId = res.insertedId;
  }, 30000); // 30 second timeout

  afterAll(async () => {
    // Clean up test data
    if (candidatureId) {
      await getDB().collection("candidatures").deleteMany({ 
        _id: candidatureId 
      });
    }
    
    // Close database connection
    await closeDB();
  }, 10000);

  test("findPendingAiDetection -> should return candidature", async () => {
    const list = await findPendingAiDetection();
    
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThanOrEqual(1);
    
    const found = list.find(c => c._id.equals(candidatureId));
    expect(found).toBeDefined();
  });

  test("lockAiDetection -> should set status PROCESSING", async () => {
    await lockAiDetection(candidatureId);

    const c = await getDB()
      .collection("candidatures")
      .findOne({ _id: candidatureId });

    expect(c).toBeDefined();
    expect(c.analysis).toBeDefined();
    expect(c.analysis.aiDetection).toBeDefined();
    expect(c.analysis.aiDetection.status).toBe("PROCESSING");
  });

  test("markAiDetectionDone -> should save result", async () => {
    await markAiDetectionDone(candidatureId, false, 0.12);

    const c = await getDB()
      .collection("candidatures")
      .findOne({ _id: candidatureId });

    expect(c).toBeDefined();
    expect(c.analysis.aiDetection.status).toBe("DONE");
    expect(c.analysis.aiDetection.isAIGenerated).toBe(false);
    expect(c.analysis.aiDetection.confidence).toBe(0.12);
  });

  test("markAiDetectionFailed -> should set FAILED", async () => {
    await markAiDetectionFailed(candidatureId, "AI error");

    const c = await getDB()
      .collection("candidatures")
      .findOne({ _id: candidatureId });

    expect(c).toBeDefined();
    expect(c.analysis.aiDetection.status).toBe("FAILED");
    expect(c.analysis.aiDetection.error).toBe("AI error");
  });
});