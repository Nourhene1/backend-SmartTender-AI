import nodemailer from "nodemailer";

async function sendTestMail() {
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: {
      user: "nourheneabbes12@gmail.com",
      pass: "jmmvgehuxmubkfuq", // 🔴 App Password (16 chars)
    },
  });

  const info = await transporter.sendMail({
    from: '"Test SMTP" <nourheneabbes12@gmail.com>',
    to: "abbesnourhene12@gmail.com",
    subject: "Test mail",
    text: "Mail OK 🎉 SMTP fonctionne",
  });

  console.log("📧 MAIL ENVOYÉ !");
  console.log("MessageId:", info.messageId);
  console.log("Accepted:", info.accepted);
  console.log("Rejected:", info.rejected);
}

sendTestMail().catch(console.error);
