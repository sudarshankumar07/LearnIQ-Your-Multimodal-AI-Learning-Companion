const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { deleteDocument } = require("../services/qdrantService");
const store = require("../services/dataStore");
const { unlink } = require("fs/promises");
const { uploadPDF } = require("../controllers/uploadController");

const router = express.Router();
const uploadDir = process.env.LEARNIQ_UPLOADS_DIR || path.join(__dirname, "..", "uploads");
fs.mkdirSync(uploadDir, { recursive: true });

function resolveFilePath(storagePath) {
    if (fs.existsSync(storagePath)) return storagePath;
    const fallbackPath = path.join(uploadDir, path.basename(storagePath));
    if (fs.existsSync(fallbackPath)) return fallbackPath;
    return null;
}

const acceptedTypes = {
    ".pdf": ["application/pdf", "application/octet-stream", ""],
    ".pptx": ["application/vnd.openxmlformats-officedocument.presentationml.presentation", "application/zip", "application/octet-stream", ""],
    ".mp4": ["video/mp4", "application/octet-stream", ""],
    ".mov": ["video/quicktime", "video/mp4", "application/octet-stream", ""],
    ".webm": ["video/webm", "application/octet-stream", ""]
};
const upload = multer({
    dest: uploadDir,
    limits: { fileSize: 100 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, done) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (!acceptedTypes[ext] || !acceptedTypes[ext].includes(file.mimetype)) {
            return done(new multer.MulterError("LIMIT_UNEXPECTED_FILE", "material"));
        }
        done(null, true);
    }
});

router.post("/", upload.single("material"), uploadPDF);
router.get("/", async (_req, res) => {
    try { res.json({ documents: await store.listDocuments(_req.user.id) }); }
    catch (err) { console.error("Document listing failed:", err.message); res.status(503).json({ message: "Could not load indexed documents." }); }
});
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]); }
router.get("/:documentId/source", async (req, res) => {
    if (!/^[0-9a-f-]{36}$/i.test(req.params.documentId)) return res.status(404).json({ message: "Document not found." });
    const document = await store.getDocument(req.user.id, req.params.documentId);
    if (!document) return res.status(404).json({ message: "Document not found." });
    const isVideo = document.sourceType === "video";
    const isSlide = document.sourceType === "pptx";
    const locationType = isVideo ? "time" : isSlide ? "slide" : "page";
    const locationParam = isVideo ? req.query.time : isSlide ? req.query.slide : req.query.page;
    const location = locationParam === undefined ? (isVideo ? 0 : 1) : Number(locationParam);
    if (isVideo && Number.isInteger(location) && location >= 0 && location <= document.pages) return res.redirect(302, `/upload/${document.id}/file#t=${location}`);
    if (!Number.isInteger(location) || location < 1 || location > document.pages) return res.status(400).json({ message: `Choose a valid ${locationType} number.` });
    if (isSlide) {
        const unit = await store.getSourceUnit(req.user.id, document.id, "slide", location);
        if (!unit) return res.status(404).json({ message: "No extractable text is available for this slide." });
        res.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
        res.set("X-Content-Type-Options", "nosniff");
        return res.type("html").send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(document.title)} - Slide ${location}</title><style>body{font:16px system-ui;max-width:800px;margin:40px auto;padding:0 20px;line-height:1.6}pre{white-space:pre-wrap;font:inherit}</style></head><body><h1>${escapeHtml(document.title)}</h1><h2>Slide ${location}</h2><pre>${escapeHtml(unit.content)}</pre><p><a href="/upload/${document.id}/file">Download original presentation</a></p></body></html>`);
    }
    const filePath = resolveFilePath(document.storagePath);
    if (!filePath) {
        return res.status(404).json({ message: "Original file is not available on this server. Please re-upload the document." });
    }
    res.type("application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${req.params.documentId}.pdf"`);
    res.set("X-Content-Type-Options", "nosniff");
    return res.sendFile(filePath);
});
router.get("/:documentId/file", async (req, res) => {
    if (!/^[0-9a-f-]{36}$/i.test(req.params.documentId)) return res.status(404).json({ message: "Document not found." });
    const document = await store.getDocument(req.user.id, req.params.documentId);
    if (!document) return res.status(404).json({ message: "Document not found." });
    const filePath = resolveFilePath(document.storagePath);
    if (!filePath) {
        return res.status(404).json({ message: "Original file is not available on this server. Please re-upload the document." });
    }
    if (document.sourceType === "video") {
        const mime = { ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm" }[path.extname(filePath).toLowerCase()];
        res.type(mime || "application/octet-stream");
        res.set("Content-Disposition", "inline");
        res.set("X-Content-Type-Options", "nosniff");
        return res.sendFile(filePath);
    }
    return res.download(filePath, document.title);
});
router.delete("/:documentId", async (req, res) => {
    if (!/^[0-9a-f-]{36}$/i.test(req.params.documentId)) return res.status(404).json({ message: "Document not found." });
    const document = await store.getDocument(req.user.id, req.params.documentId);
    if (!document) return res.status(404).json({ message: "Document not found." });
    try {
        await deleteDocument(document.id, req.user.id);
        await store.deleteDocument(req.user.id, document.id);
        const filePath = resolveFilePath(document.storagePath);
        if (filePath) await unlink(filePath).catch(error => console.error("Document file cleanup failed:", error.message));
        return res.json({ success: true });
    } catch (error) {
        console.error("Document deletion failed:", error.message);
        return res.status(503).json({ message: "Could not delete the document." });
    }
});

module.exports = router;
