const { createChunks } = require("./createChunks");

function buildPdfChunks(pages, visualPages = []) {
    const visuals = new Map(visualPages.map(page => [page.pageNumber, page]));
    const pageText = new Map(pages.map(page => [page.num, page.text || ""]));
    const pageNumbers = new Set([...pageText.keys(), ...visuals.keys()]);
    const chunks = [];
    for (const pageNumber of [...pageNumbers].sort((a, b) => a - b)) {
        const existingText = pageText.get(pageNumber) || "";
        const visual = visuals.get(pageNumber);
        const additions = [];
        if (visual?.recognizedText) {
            const normalizedExisting = existingText.toLocaleLowerCase().replace(/\s+/g, " ").trim();
            const normalizedOcr = visual.recognizedText.toLocaleLowerCase().replace(/\s+/g, " ").trim();
            if (!normalizedExisting.includes(normalizedOcr)) additions.push(`Text recognized from page image: ${visual.recognizedText}`);
        }
        if (visual?.visualDescription) additions.push(`Figure or diagram description: ${visual.visualDescription}`);
        const content = [existingText, ...additions].filter(Boolean).join("\n\n");
        createChunks(content).forEach((text, chunkIndex) => chunks.push({ text, pageNumber, chunkIndex }));
    }
    return chunks;
}

module.exports = { buildPdfChunks };
