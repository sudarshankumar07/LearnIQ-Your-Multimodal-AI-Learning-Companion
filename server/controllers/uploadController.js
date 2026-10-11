const path = require("path");
const { randomUUID } = require("crypto");
const fs = require("fs/promises");
const { processPDF } = require("../services/pdfService");
const { processPptx } = require("../services/pptxService");
const { processVideo } = require("../services/videoService");
const { deleteDocument } = require("../services/qdrantService");
const store = require("../services/dataStore");

async function uploadPDF(req, res) {
    let documentId;
    let retainSource = false;
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                type: "NO_FILE",
                message: "Please upload a PDF, PPTX, MP4, MOV, or WebM file."
            });
        }
        const signature = await fs.open(req.file.path, "r");
        const header = Buffer.alloc(8);
        await signature.read(header, 0, 8, 0);
        await signature.close();
        const extension = path.extname(req.file.originalname).toLowerCase();
        if (extension === ".pdf" && header.subarray(0, 5).toString("ascii") !== "%PDF-") return res.status(400).json({ success: false, message: "The uploaded file is not a valid PDF." });
        if (extension === ".pptx" && !(header[0] === 0x50 && header[1] === 0x4b)) return res.status(400).json({ success: false, message: "The uploaded file is not a valid PPTX presentation." });
        const videoSignatures = extension === ".webm" ? header.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) : [".mp4", ".mov"].includes(extension) && header.subarray(4, 8).toString("ascii") === "ftyp";
        if ([".mp4", ".mov", ".webm"].includes(extension) && !videoSignatures) return res.status(400).json({ success: false, message: "The uploaded file is not a valid supported video." });
        if (![".pdf", ".pptx", ".mp4", ".mov", ".webm"].includes(extension)) return res.status(400).json({ success: false, message: "Upload a PDF, PPTX, MP4, MOV, or WebM file." });
        if (![".mp4", ".mov", ".webm"].includes(extension) && req.file.size > 20 * 1024 * 1024) return res.status(413).json({ success: false, message: "PDF and PPTX files are limited to 20 MB." });
        documentId = randomUUID();
        const title = path.basename(req.file.originalname.replace(/[\\/]/g, path.sep)).slice(0, 180);
        const storagePath = path.join(path.dirname(req.file.path), `${documentId}${extension}`);
        await fs.rename(req.file.path, storagePath);
        req.file.path = storagePath;
        const result = extension === ".pdf"
            ? await processPDF(storagePath, title, { documentId, ownerId: req.user.id })
            : extension === ".pptx"
                ? await processPptx(storagePath, title, { documentId, ownerId: req.user.id })
                : await processVideo(storagePath, title, { ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm" }[extension], { documentId, ownerId: req.user.id });
        if (!result.success) return res.status(400).json(result);
        store.createDocument({ id: documentId, userId: req.user.id, title, storagePath, pages: result.pages, sourceType: result.sourceType, sourceUnits: result.sourceUnits });
        store.persistTaxonomy(req.user.id, documentId, result.taxonomy);
        retainSource = true;
        const { taxonomy: _taxonomy, sourceUnits: _sourceUnits, ...uploadResponse } = result;
        return res.status(200).json(uploadResponse);
    } catch (err) {
        if (documentId) {
            await deleteDocument(documentId, req.user.id).catch(() => {});
            try { store.deleteDocument(req.user.id, documentId); }
            catch (cleanupError) { console.error("Upload metadata cleanup failed:", cleanupError.message); }
        }
        console.error("Material upload failed:", err.message);
        return res.status(500).json({ message: "Material upload failed." });
    } finally {
        if (req.file?.path && !retainSource) await fs.unlink(req.file.path).catch(() => {});
    }
}

module.exports = { uploadPDF };
