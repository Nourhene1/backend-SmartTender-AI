import { ObjectId } from "mongodb";

export async function scheduleInterviewReminders(db, interview) {
  const col = db.collection("interview_reminders");

  const startAt = new Date(interview.startAt);
  const now = new Date();

  const reminders = [
    { type: "D3", ms: 3 * 24 * 60 * 60 * 1000 },
    { type: "D1", ms: 1 * 24 * 60 * 60 * 1000 },
    { type: "H3", ms: 3 * 60 * 60 * 1000 },
  ];

  for (const r of reminders) {
    const sendAt = new Date(startAt.getTime() - r.ms);
    if (sendAt <= now) continue;

    await col.updateOne(
      { interviewId: new ObjectId(String(interview._id)), type: r.type },
      {
        $setOnInsert: {
          interviewId: new ObjectId(String(interview._id)),
          candidateEmail: interview.candidateEmail,
          type: r.type,
          sendAt,
          status: "PENDING",
          createdAt: new Date(),
        },
      },
      { upsert: true }
    );
  }
}