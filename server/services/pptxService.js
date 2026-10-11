const fs = require("fs");
const { randomUUID } = require("crypto");
const { createChunks } = require("../utils/createChunks");
const { extractSlidesWithMedia } = require("../utils/extractPptxSlides");
const { indexChunks } = require("./indexChunksService");
const { describeSlideImages } = require("./geminiService");

async function processPptx(filePath, sourceName, { documentId = randomUUID(), ownerId } = {}) {
    try {
        const buffer = fs.readFileSync(filePath);
        const slides = extractSlidesWithMedia(buffer);
        const enrichedSlides = [];
        for (const slide of slides) {
            const visual = slide.images.length ? await describeSlideImages(slide.images, slide.text) : [];
            const visualText = visual.flatMap((item, index) => [
                item.recognizedText && `Text recognized from slide image ${item.imageIndex + 1}: ${item.recognizedText}`,
                item.visualDescription && `Figure or diagram description for slide image ${item.imageIndex + 1}: ${item.visualDescription}`
            ]).filter(Boolean);
            enrichedSlides.push({ ...slide, content: [slide.text, ...visualText].filter(Boolean).join("\n\n") });
        }
        const units = enrichedSlides.filter(slide => slide.content).map(slide => ({ locationType: "slide", locationNumber: slide.slideNumber, content: slide.content }));
        const chunks = enrichedSlides.flatMap(slide => createChunks(slide.content).map((text, chunkIndex) => ({ text, slideNumber: slide.slideNumber, chunkIndex })));
        if (!chunks.length) return { success: false, type: "NO_TEXT", message: "No extractable slide text was found in this presentation." };
        if (chunks.length > 1000) return { success: false, type: "CHUNK_LIMIT", message: "This presentation contains too much text to index in one upload." };
        const result = await indexChunks({ chunks, sourceName, sourceType: "pptx", documentId, ownerId });
        return { ...result, type: "MULTIMODAL", pages: slides.length, sourceUnits: units };
    } catch (error) {
        console.error("PPTX processing failed:", error.message);
        return {
            success: false,
            type: error.code || "PPTX_PARSE_ERROR",
            message: error.code ? error.message : "The presentation could not be processed. Check that it is a valid PPTX file."
        };
    }
}

module.exports = { processPptx };
