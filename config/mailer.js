import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: process.env.MAIL_HOST,
  port: Number(process.env.MAIL_PORT || 587),
  secure: false,
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS,
  },
});

// optionnel : vérifier connexion au démarrage
transporter.verify((err, success) => {
  if (err) {
    console.error("❌ SMTP error:", err.message);
  } else {
    console.log("✅ SMTP ready");
  }
});

export default transporter;
