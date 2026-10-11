const { PDFParse } = require("pdf-parse");
const fs = require("fs");
const { buildPdfChunks } = require("../utils/buildPdfChunks");
const { indexChunks } = require("./indexChunksService");
const { analyzePdfPages } = require("./geminiService");

async function processPDF(filePath, sourceName = "Uploaded PDF", { documentId, ownerId } = {}) {
    let parser;
    try {
        const dataBuffer = fs.readFileSync(filePath);
        if (!dataBuffer || dataBuffer.length === 0) {
            return { success: false, type: "EMPTY_FILE", message: "Uploaded PDF file is empty." };
        }
        parser = new PDFParse({ data: dataBuffer });
        const pdfData = await parser.getText();
        if (pdfData.total > 500) return { success: false, type: "PAGE_LIMIT", message: "PDFs are limited to 500 pages." };
        const text = pdfData.text?.trim() || "";
        const visualPages = await analyzePdfPages(filePath, pdfData.total);
        const chunks = buildPdfChunks(pdfData.pages || [], visualPages);
        if (chunks.length === 0) {
            return { success: false, type: text ? "NO_CHUNKS" : "NO_TEXT", message: "No selectable or visually extractable course text was found in this PDF." };
        }
        if (chunks.length > 1000) return { success: false, type: "CHUNK_LIMIT", message: "This PDF contains too much extractable text. Split it into smaller files." };

        const indexed = await indexChunks({ chunks, sourceName, sourceType: "pdf", documentId, ownerId });
        return { ...indexed, type: text ? "MULTIMODAL" : "OCR", pages: pdfData.total };
    } catch (error) {
        console.error("PDF processing failed:", error.message);
        return {
            success: false,
            type: error.code || "PDF_PARSE_ERROR",
            message: error.code ? error.message : "The PDF could not be processed. Check that it is valid and contains extractable text."
        };
    } finally {
        if (parser) {
            try {
                await parser.destroy();
            } catch (destroyError) {
                console.error("Failed to destroy PDF parser:", destroyError);
            }
        }
    }
}

module.exports = { processPDF };
