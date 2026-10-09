const path = require("path");
const { processPDF } = require("../services/pdfService");

async function uploadPDF(req, res) {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                type: "NO_FILE",
                message: "Please upload a PDF file."
            });
        }
        const result = await processPDF(req.file.path, path.basename(req.file.originalname));
        if (!result.success) return res.status(400).json(result);
        return res.status(200).json(result);
    } catch (err) {
        console.error("PDF upload failed:", err.message);
        return res.status(500).json({ message: "PDF upload failed." });
    }
}

module.exports = { uploadPDF };
