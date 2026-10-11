const test = require("node:test");
const assert = require("node:assert/strict");
const { QdrantClientUnexpectedResponseError } = require("@qdrant/js-client-rest");

const clientsPath = require.resolve("../config/clients");
const geminiPath = require.resolve("../services/geminiService");
let queryArgs;
let collectionCalls = 0;
let queryBehavior = "failure";
let embeddingFactory = async () => Array(3072).fill(0.1);
const fakeQdrant = {
    async query(...args) {
        queryArgs = args;
        if (queryBehavior === "success") return { points: [{ id: "point-1", score: 0.9, payload: { ownerId: "owner-a", documentId: "doc-a" } }] };
        if (queryBehavior === "nested-error") {
            const error = new Error("Bad Request");
            error.status = 400;
            error.data = { status: { error: "Wrong input: validation rejected; payload: private document sentence; token=private-token" }, time: 0 };
            throw error;
        }
        throw QdrantClientUnexpectedResponseError.forResponse({
            status: 400,
            statusText: "Bad Request",
            data: { status: { error: "Wrong input: vector dimension error, expected dim: 1536, got 3072; payload: private document sentence; token=private-token" }, time: 0 }
        });
    },
    async getCollection() {
        collectionCalls += 1;
        return { config: { params: { vectors: { size: 3072, distance: "Cosine" } } } };
    }
};

require.cache[clientsPath] = {
    id: clientsPath,
    filename: clientsPath,
    loaded: true,
    exports: { qdrant: fakeQdrant }
};
require.cache[geminiPath] = {
    id: geminiPath,
    filename: geminiPath,
    loaded: true,
    exports: {
        createEmbedding: (...args) => embeddingFactory(...args),
        validateEmbedding(embedding) {
            if (!Array.isArray(embedding) || embedding.length !== 3072 || !embedding.every(value => typeof value === "number" && Number.isFinite(value))) {
                const error = new Error("Embedding must contain 3072 finite numeric values.");
                error.code = "EMBEDDING_INVALID_RESPONSE";
                throw error;
            }
            return embedding;
        },
        EMBEDDING_DIMENSION: 3072
    }
};
delete require.cache[require.resolve("../services/qdrantService")];
const { semanticSearch } = require("../services/qdrantService");

test("successful Qdrant retrieval uses the collection, embedding, and owner filter", async () => {
    const previous = { nodeEnv: process.env.NODE_ENV, qdrantUrl: process.env.QDRANT_URL };
    process.env.NODE_ENV = "production";
    process.env.QDRANT_URL = "https://qdrant.example";
    queryBehavior = "success";
    try {
        const points = await semanticSearch("safe query", 3, "owner-a");
        assert.deepEqual(points, [{ id: "point-1", score: 0.9, payload: { ownerId: "owner-a", documentId: "doc-a" } }]);
        assert.equal(queryArgs[0], "pdf_chunks");
        assert.equal(queryArgs[1].query.length, 3072);
        assert.equal(queryArgs[1].limit, 3);
        assert.deepEqual(queryArgs[1].filter, { must: [{ key: "ownerId", match: { value: "owner-a" } }] });
        assert.equal(queryArgs[1].with_payload, true);
    } finally {
        queryBehavior = "failure";
        if (previous.nodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = previous.nodeEnv;
        if (previous.qdrantUrl === undefined) delete process.env.QDRANT_URL;
        else process.env.QDRANT_URL = previous.qdrantUrl;
    }
});

test("Qdrant query failure diagnostics in development preserve the original provider status/body safely", async () => {
    const previous = {
        nodeEnv: process.env.NODE_ENV,
        qdrantUrl: process.env.QDRANT_URL,
        error: console.error
    };
    const lines = [];
    process.env.NODE_ENV = "development";
    process.env.QDRANT_URL = "https://url-user:url-secret@qdrant.example:6333/private/path?api_key=url-key#fragment";
    console.error = line => lines.push(line);
    try {
        await assert.rejects(semanticSearch("safe query", 5, "owner-private", "document-private"), error => {
            assert.equal(error.code, "QDRANT_QUERY_FAILED");
            assert.equal(error.ragStage, "vector_search");
            return true;
        });

        assert.equal(queryArgs[0], "pdf_chunks");
        assert.equal(queryArgs[1].limit, 5);
        assert.equal(queryArgs[1].query.length, 3072);
        assert.deepEqual(queryArgs[1].filter, { must: [
            { key: "ownerId", match: { value: "owner-private" } },
            { key: "documentId", match: { value: "document-private" } }
        ] });

        assert.equal(lines.length, 1);
        const diagnostic = JSON.parse(lines[0]);
        assert.equal(diagnostic.event, "qdrant_query_diagnostic");
        assert.equal(diagnostic.endpointHost, "qdrant.example");
        assert.equal(diagnostic.collection, "pdf_chunks");
        assert.equal(diagnostic.queryVectorDimension, 3072);
        assert.equal(diagnostic.queryVectorFinite, true);
        assert.equal(diagnostic.collectionExists, true);
        assert.equal(diagnostic.vectorSchema.usesNamedVectors, false);
        assert.equal(diagnostic.vectorSchema.configuredVectorDimension, 3072);
        assert.equal(diagnostic.searchMethod, "query");
        assert.deepEqual(diagnostic.filter, { must: [
            { key: "ownerId", match: { value: "[REDACTED]" } },
            { key: "documentId", match: { value: "[REDACTED]" } }
        ] });
        assert.equal(diagnostic.httpStatus, 400);
        assert.equal(diagnostic.providerResponseStatus, 400);
        assert.match(diagnostic.providerResponseBody.status.error, /expected dim: 1536, got 3072/);
        assert.match(diagnostic.providerResponseBody.summary, /expected 1536, received 3072/);
        assert.equal(diagnostic.exceptionClass, "QdrantClientUnexpectedResponseError");
        assert.equal(diagnostic.exceptionName, "QdrantClientUnexpectedResponseError");
        assert.deepEqual(diagnostic.errorProperties, ["name", "message", "stack"]);
        assert.deepEqual(diagnostic.responseProperties, []);
        assert.deepEqual(diagnostic.dataProperties, []);
        assert.match(diagnostic.errorMessage, /Unexpected Response: 400/);
        assert.match(diagnostic.errorSummary, /expected 1536, received 3072/);
        assert.match(diagnostic.stackTrace, /at /);
        for (const secret of [
            "url-user", "url-secret", "url-key", "private/path", "fragment",
            "owner-private", "document-private", "private document sentence", "private-token"
        ]) assert.equal(lines[0].includes(secret), false, `diagnostic leaked ${secret}`);
    } finally {
        console.error = previous.error;
        if (previous.nodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = previous.nodeEnv;
        if (previous.qdrantUrl === undefined) delete process.env.QDRANT_URL;
        else process.env.QDRANT_URL = previous.qdrantUrl;
    }
});

test("Qdrant diagnostics extract a structured response body when the error message only says Bad Request", async () => {
    const previous = { nodeEnv: process.env.NODE_ENV, qdrantUrl: process.env.QDRANT_URL, error: console.error, behavior: queryBehavior };
    const lines = [];
    process.env.NODE_ENV = "development";
    process.env.QDRANT_URL = "https://qdrant.example";
    queryBehavior = "nested-error";
    console.error = line => lines.push(line);
    try {
        await assert.rejects(semanticSearch("safe query", 3, "owner-private", "document-private"), { code: "QDRANT_QUERY_FAILED" });
        assert.equal(lines.length, 1);
        const diagnostic = JSON.parse(lines[0]);
        assert.equal(diagnostic.httpStatus, 400);
        assert.equal(diagnostic.providerResponseStatus, 400);
        assert.match(diagnostic.errorMessage, /^Bad Request$/);
        assert.match(diagnostic.providerResponseBody.status.error, /validation rejected/);
        assert.deepEqual(diagnostic.errorProperties, ["message", "status", "data", "stack"]);
        assert.deepEqual(diagnostic.dataProperties, ["status"]);
        for (const secret of ["private document sentence", "private-token", "owner-private", "document-private"])
            assert.equal(lines[0].includes(secret), false, `diagnostic leaked ${secret}`);
    } finally {
        console.error = previous.error;
        queryBehavior = previous.behavior;
        if (previous.nodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = previous.nodeEnv;
        if (previous.qdrantUrl === undefined) delete process.env.QDRANT_URL;
        else process.env.QDRANT_URL = previous.qdrantUrl;
    }
});

test("invalid query embeddings are rejected before the Qdrant search call", async () => {
    const previous = { nodeEnv: process.env.NODE_ENV, qdrantUrl: process.env.QDRANT_URL, embeddingFactory };
    process.env.NODE_ENV = "production";
    process.env.QDRANT_URL = "https://qdrant.example";
    const queryCallsBefore = queryArgs;
    embeddingFactory = async () => [1, Number.NaN];
    try {
        await assert.rejects(semanticSearch("safe query", 3, "owner-a"), error => {
            assert.equal(error.code, "EMBEDDING_INVALID_RESPONSE");
            assert.equal(error.ragStage, "query_embedding");
            return true;
        });
        assert.equal(queryArgs, queryCallsBefore);
    } finally {
        embeddingFactory = previous.embeddingFactory;
        if (previous.nodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = previous.nodeEnv;
        if (previous.qdrantUrl === undefined) delete process.env.QDRANT_URL;
        else process.env.QDRANT_URL = previous.qdrantUrl;
    }
});

test("Qdrant query failure does not emit diagnostics or probe collection in production", async () => {
    const previous = { nodeEnv: process.env.NODE_ENV, qdrantUrl: process.env.QDRANT_URL, error: console.error };
    const lines = [];
    process.env.NODE_ENV = "production";
    process.env.QDRANT_URL = "https://qdrant.example";
    console.error = line => lines.push(line);
    const collectionCallsBefore = collectionCalls;
    try {
        await assert.rejects(semanticSearch("safe query", 3, "owner-a"), { code: "QDRANT_QUERY_FAILED" });
        assert.deepEqual(lines, []);
        assert.equal(collectionCalls, collectionCallsBefore);
    } finally {
        console.error = previous.error;
        if (previous.nodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = previous.nodeEnv;
        if (previous.qdrantUrl === undefined) delete process.env.QDRANT_URL;
        else process.env.QDRANT_URL = previous.qdrantUrl;
    }
});

test("Qdrant query diagnostics stay off when NODE_ENV is unset", async () => {
    const previous = { nodeEnv: process.env.NODE_ENV, qdrantUrl: process.env.QDRANT_URL, error: console.error };
    const lines = [];
    delete process.env.NODE_ENV;
    process.env.QDRANT_URL = "https://qdrant.example";
    console.error = line => lines.push(line);
    const collectionCallsBefore = collectionCalls;
    try {
        await assert.rejects(semanticSearch("safe query", 3, "owner-a"), { code: "QDRANT_QUERY_FAILED" });
        assert.deepEqual(lines, []);
        assert.equal(collectionCalls, collectionCallsBefore);
    } finally {
        console.error = previous.error;
        if (previous.nodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = previous.nodeEnv;
        if (previous.qdrantUrl === undefined) delete process.env.QDRANT_URL;
        else process.env.QDRANT_URL = previous.qdrantUrl;
    }
});
