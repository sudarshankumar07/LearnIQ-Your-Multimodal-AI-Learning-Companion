const { createHash } = require("crypto");
const { createEmbedding } = require("./geminiService");
const { storePoints, deleteDocument } = require("./qdrantService");
const { extractTaxonomy } = require("./topicExtractionService");
const { stableTopicId } = require("./dataStore");

function stablePointId(documentId, chunkIndex) {
    const hash = createHash("sha256").update(`${documentId}:${chunkIndex}`).digest("hex").slice(0, 32);
    const variant = ((parseInt(hash[16], 16) & 0x3) | 0x8).toString(16);
    const uuid = `${hash.slice(0, 12)}5${hash.slice(13, 16)}${variant}${hash.slice(17)}`;
    return `${uuid.slice(0, 8)}-${uuid.slice(8, 12)}-${uuid.slice(12, 16)}-${uuid.slice(16, 20)}-${uuid.slice(20)}`;
}

async function indexChunks({ chunks, sourceName, sourceType, documentId, ownerId }) {
    if (!ownerId) throw new Error("An authenticated owner is required to index learning material.");
    const taxonomy = await extractTaxonomy(chunks, sourceType);
    const topicIdsByChunk = new Map();
    for (const topic of taxonomy.topics) {
        const topicId = stableTopicId(ownerId, topic.name);
        for (const chunkIndex of topic.chunkIndexes) {
            const ids = topicIdsByChunk.get(chunkIndex) || [];
            ids.push(topicId);
            topicIdsByChunk.set(chunkIndex, ids);
        }
    }
    const points = [];
    try {
        for (let start = 0; start < chunks.length; start += 4) {
            const batch = await Promise.all(chunks.slice(start, start + 4).map(async (chunk, batchIndex) => {
                const globalChunkIndex = start + batchIndex;
                return {
                    id: stablePointId(documentId, globalChunkIndex),
                    vector: await createEmbedding(chunk.text),
                    payload: { text: chunk.text, chunkIndex: chunk.chunkIndex, globalChunkIndex, topicIds: topicIdsByChunk.get(globalChunkIndex) || [], pageNumber: chunk.pageNumber, slideNumber: chunk.slideNumber, startSeconds: chunk.startSeconds, endSeconds: chunk.endSeconds, documentId, ownerId, sourceType, source: sourceName }
                };
            }));
            points.push(...batch);
            if (points.length >= 64) await storePoints(points.splice(0, points.length));
        }
        if (points.length) await storePoints(points);
    } catch (error) {
        await deleteDocument(documentId, ownerId).catch(cleanupError => console.error("Partial index cleanup failed:", cleanupError.message));
        error.code = error.code || "INDEXING_FAILED";
        throw error;
    }
    const unclassifiedChunkCount = taxonomy.unclassifiedChunks?.length || 0;
    const warnings = unclassifiedChunkCount
        ? [`${unclassifiedChunkCount} chunk(s) were indexed without topic labels because source evidence could not be validated.`]
        : [];
    return { success: true, sourceType, totalChunks: chunks.length, documentId, taxonomy, unclassifiedChunkCount, warnings };
}

module.exports = { indexChunks };
