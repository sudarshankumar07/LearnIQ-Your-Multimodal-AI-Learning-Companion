const { PDFParse } = require("pdf-parse");
const fs = require("fs");
const { randomUUID } = require("crypto");
const { createChunks } = require("../utils/createChunks");
const { createEmbedding } = require("./geminiService");
const { storePoints } = require("./qdrantService");

async function processPDF(filePath, sourceName = "Uploaded PDF") {
    let parser;
    try {
        const dataBuffer = fs.readFileSync(filePath);
        if (!dataBuffer || dataBuffer.length === 0) {
            return { success: false, type: "EMPTY_FILE", message: "Uploaded PDF file is empty." };
        }
        parser = new PDFParse({ data: dataBuffer });
        const pdfData = await parser.getText();
        const text = pdfData.text?.trim();
        if (!text) {
            return {
                success: false,
                type: "NO_TEXT",
                message: "PDF was opened successfully, but no extractable text was found. It may be a scanned/image-based PDF and require OCR."
            };
        }
        const chunks = pdfData.pages.flatMap(page =>
            createChunks(page.text).map((chunk, chunkIndex) => ({
                text: chunk,
                pageNumber: page.num,
                chunkIndex
            }))
        );
        if (chunks.length === 0) {
            return { success: false, type: "NO_CHUNKS", message: "Text was extracted but no chunks could be created." };
        }

        const points = [];
        const documentId = randomUUID();
        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            const embedding = await createEmbedding(chunk.text);
            points.push({
                id: randomUUID(),
                vector: embedding,
                payload: {
                    text: chunk.text,
                    chunkIndex: chunk.chunkIndex,
                    pageNumber: chunk.pageNumber,
                    documentId,
                    source: sourceName
                }
            });
        }
        await storePoints(points);
        return { success: true, type: "TEXT", pages: pdfData.total, totalChunks: chunks.length, documentId };
    } catch (error) {
        console.error("PDF processing failed:", error);
        return { success: false, type: "PDF_PARSE_ERROR", message: error.message || "Failed to process PDF." };
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
