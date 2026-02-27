import multer from "multer";
import path from "path";

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/cv"),
  filename: (req, file, cb) =>
    cb(null, Date.now() + "-" + file.originalname.replace(/\s+/g, "_")),
});

function fileFilter(req, file, cb) {
  if (file.mimetype !== "application/pdf") return cb(new Error("PDF only"), false);
  cb(null, true);
}

export const uploadCv = multer({ storage, fileFilter, limits: { fileSize: 5 * 1024 * 1024 } });
