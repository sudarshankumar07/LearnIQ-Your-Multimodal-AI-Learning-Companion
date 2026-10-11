const test = require("node:test");
const assert = require("node:assert/strict");

const clientsPath = require.resolve("../config/clients");
const geminiPath = require.resolve("../services/geminiService");
let embedArgs;
let responseEmbedding = Array(3072).fill(0.25);
require.cache[clientsPath] = {
    id: clientsPath,
    filename: clientsPath,
    loaded: true,
    exports: { ai: { models: { embedContent: async (...args) => {
        embedArgs = args;
        return { embeddings: [{ values: responseEmbedding }] };
    } } } }
};
delete require.cache[geminiPath];
const { createEmbedding, EMBEDDING_MODEL, EMBEDDING_DIMENSION } = require("../services/geminiService");

test("indexing and query embedding helper uses the expected model and validates finite dimensions", async () => {
    const previousKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = "test-only-placeholder-value";
    try {
        const vector = await createEmbedding("safe test text");
        assert.equal(embedArgs[0].model, EMBEDDING_MODEL);
        assert.equal(embedArgs[0].model, "gemini-embedding-2");
        assert.equal(embedArgs[0].contents, "safe test text");
        assert.equal(vector.length, EMBEDDING_DIMENSION);
        assert.equal(vector.every(Number.isFinite), true);

        responseEmbedding = [];
        await assert.rejects(createEmbedding("safe test text"), { code: "EMBEDDING_INVALID_RESPONSE" });
        responseEmbedding = Array(3072).fill(0.25);
        responseEmbedding[31] = Number.POSITIVE_INFINITY;
        await assert.rejects(createEmbedding("safe test text"), { code: "EMBEDDING_INVALID_RESPONSE" });
    } finally {
        responseEmbedding = Array(3072).fill(0.25);
        if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
        else process.env.GEMINI_API_KEY = previousKey;
    }
});
