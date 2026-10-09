const { qdrant } = require("../config/clients");
const { createEmbedding } = require("./geminiService");

async function setupQdrant() {
    try {
        await qdrant.createCollection("pdf_chunks", {
            vectors: { size: 3072, distance: "Cosine" }
        });
    } catch (err) {
        console.log("Qdrant setup : ", err.message);
    }
}

async function storePoints(points) {
    return qdrant.upsert("pdf_chunks", { wait: true, points });
}

async function semanticSearch(query, topK = 3) {
    const queryEmbedding = await createEmbedding(query);
    const result = await qdrant.query("pdf_chunks", {
        query: queryEmbedding,
        limit: topK,
        with_payload: true
    });
    return result.points;
}

module.exports = { setupQdrant, storePoints, semanticSearch };
