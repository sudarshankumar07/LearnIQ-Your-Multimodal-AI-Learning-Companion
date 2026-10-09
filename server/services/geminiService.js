const { ai } = require("../config/clients");

async function createEmbedding(text) {
    if (!text || !text.trim()) throw new Error("Cannot create embedding for empty text");
    const response = await ai.models.embedContent({
        model: "gemini-embedding-2",
        contents: text
    });
    const embedding = response?.embeddings?.[0]?.values;
    if (!embedding || !Array.isArray(embedding)) throw new Error("Invalid embedding response from Gemini");
    return embedding;
}

async function generateContent(contents) {
    return ai.models.generateContent({ model: "gemini-3.5-flash-lite", contents });
}

module.exports = { createEmbedding, generateContent };
