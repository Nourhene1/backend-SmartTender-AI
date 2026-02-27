import { sendCandidateReminderEmail } from "../services/interview-mail.service.js";

export function startReminderCron(db) {
  setInterval(async () => {
    const now = new Date();

    const reminders = await db
      .collection("interview_reminders")
      .find({ status: "PENDING", sendAt: { $lte: now } })
      .limit(10)
      .toArray();

    for (const r of reminders) {
      try {
        const interview = await db
          .collection("interviews")
          .findOne({ _id: r.interviewId });

        if (!interview) continue;

        await sendCandidateReminderEmail(interview, r.type);

        await db.collection("interview_reminders").updateOne(
          { _id: r._id },
          { $set: { status: "SENT", sentAt: new Date() } }
        );
      } catch (e) {
        await db.collection("interview_reminders").updateOne(
          { _id: r._id },
          { $set: { lastError: String(e) }, $inc: { attempts: 1 } }
        );
      }
    }
  }, 60 * 1000); // كل دقيقة
}