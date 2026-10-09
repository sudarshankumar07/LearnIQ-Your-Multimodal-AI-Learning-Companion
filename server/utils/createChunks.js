function createChunks(text, maxWords = 500, overlapWords = 50) {
    if (!text || !text.trim()) return [];
    const cleanedText = text
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .trim();
    const paragraphs = cleanedText
        .split(/\n\s*\n/)
        .map(paragraph => paragraph.trim())
        .filter(Boolean);
    const chunks = [];
    let currentChunk = [];
    let currentWords = 0;
    for (const paragraph of paragraphs) {
        const paragraphWords = paragraph.split(/\s+/);
        if (currentWords + paragraphWords.length > maxWords && currentChunk.length > 0) {
            const chunkText = currentChunk.join("\n\n");
            chunks.push(chunkText);
            const overlap = chunkText.split(/\s+/).slice(-overlapWords).join(" ");
            currentChunk = [overlap];
            currentWords = overlapWords;
        }
        currentChunk.push(paragraph);
        currentWords += paragraphWords.length;
    }
    if (currentChunk.length > 0) chunks.push(currentChunk.join("\n\n"));
    return chunks.map(chunk => chunk.trim()).filter(Boolean);
}

module.exports = { createChunks };
