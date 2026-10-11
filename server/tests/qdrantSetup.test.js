const test = require("node:test");
const assert = require("node:assert/strict");

const clientsPath = require.resolve("../config/clients");
const geminiPath = require.resolve("../services/geminiService");
const qdrant = {
    exists: true,
    collection: { config: { params: { vectors: { size: 3072, distance: "Cosine" } } }, payload_schema: {} },
    createError: null,
    payloadIndexError: null,
    existenceChecks: 0,
    collectionReads: 0,
    createCalls: [],
    payloadIndexCalls: [],
    queryArgs: null,
    async collectionExists(name) {
        this.existenceChecks += 1;
        assert.equal(name, "pdf_chunks");
        return this.exists;
    },
    async getCollection(name) {
        this.collectionReads += 1;
        assert.equal(name, "pdf_chunks");
        return this.collection;
    },
    async createCollection(...args) {
        this.createCalls.push(args);
        if (this.createError) throw this.createError;
        this.exists = true;
        return { status: "ok" };
    },
    async createPayloadIndex(name, params) {
        assert.equal(name, "pdf_chunks");
        this.payloadIndexCalls.push([name, params]);
        if (this.payloadIndexError) {
            const error = this.payloadIndexError;
            this.payloadIndexError = null;
            if (error.simulateConcurrentIndex) {
                this.collection.payload_schema[params.field_name] = { data_type: params.field_schema, points: 21 };
            }
            throw error;
        }
        this.collection.payload_schema[params.field_name] = { data_type: params.field_schema, points: 21 };
        return { status: "ok" };
    },
    async query(...args) {
        this.queryArgs = args;
        return { points: [{ id: "scoped-point", payload: { ownerId: "owner-a", documentId: "document-a" } }] };
    }
};

require.cache[clientsPath] = {
    id: clientsPath,
    filename: clientsPath,
    loaded: true,
    exports: { qdrant }
};
require.cache[geminiPath] = {
    id: geminiPath,
    filename: geminiPath,
    loaded: true,
    exports: {
        createEmbedding: async () => Array(3072).fill(0.1),
        validateEmbedding: vector => vector,
        EMBEDDING_DIMENSION: 3072
    }
};
delete require.cache[require.resolve("../services/qdrantService")];
const { setupQdrant, semanticSearch } = require("../services/qdrantService");

function resetQdrant() {
    qdrant.exists = true;
    qdrant.collection = { config: { params: { vectors: { size: 3072, distance: "Cosine" } } }, payload_schema: {} };
    qdrant.createError = null;
    qdrant.payloadIndexError = null;
    qdrant.existenceChecks = 0;
    qdrant.collectionReads = 0;
    qdrant.createCalls = [];
    qdrant.payloadIndexCalls = [];
    qdrant.queryArgs = null;
}

test("setup reuses an existing compatible collection and creates both missing filter indexes", async () => {
    resetQdrant();
    const result = await setupQdrant();
    assert.deepEqual(result, { collection: "pdf_chunks", created: false });
    assert.equal(qdrant.existenceChecks, 1);
    assert.equal(qdrant.collectionReads, 1);
    assert.deepEqual(qdrant.createCalls, []);
    assert.deepEqual(qdrant.payloadIndexCalls, [
        ["pdf_chunks", { field_name: "ownerId", field_schema: "keyword", wait: true }],
        ["pdf_chunks", { field_name: "documentId", field_schema: "keyword", wait: true }]
    ]);
    assert.deepEqual(qdrant.collection.payload_schema, {
        ownerId: { data_type: "keyword", points: 21 },
        documentId: { data_type: "keyword", points: 21 }
    });
});

test("setup skips compatible existing keyword and UUID indexes on repeated startup", async () => {
    resetQdrant();
    qdrant.collection.payload_schema = {
        ownerId: { data_type: "keyword", points: 21 },
        documentId: { data_type: "uuid", points: 21 }
    };
    await setupQdrant();
    await setupQdrant();
    assert.deepEqual(qdrant.payloadIndexCalls, []);
    assert.deepEqual(qdrant.createCalls, []);
});

test("setup creates the collection only when it is confirmed missing", async () => {
    resetQdrant();
    qdrant.exists = false;
    const result = await setupQdrant();
    assert.deepEqual(result, { collection: "pdf_chunks", created: true });
    assert.equal(qdrant.existenceChecks, 1);
    assert.equal(qdrant.collectionReads, 1);
    assert.deepEqual(qdrant.createCalls, [["pdf_chunks", { vectors: { size: 3072, distance: "Cosine" } }]]);
    assert.deepEqual(qdrant.payloadIndexCalls.map(([, args]) => args.field_name), ["ownerId", "documentId"]);
});

test("setup rejects an incompatible existing collection without creating or deleting it", async () => {
    resetQdrant();
    qdrant.collection = { config: { params: { vectors: { dense: { size: 3072, distance: "Cosine" } } } } };
    const originalError = console.error;
    console.error = () => {};
    try {
        await assert.rejects(setupQdrant(), error => {
            assert.equal(error.code, "QDRANT_COLLECTION_INCOMPATIBLE");
            assert.match(error.message, /expected one unnamed 3072-dimensional Cosine vector/);
            return true;
        });
        assert.equal(qdrant.collectionReads, 1);
        assert.deepEqual(qdrant.createCalls, []);
        assert.deepEqual(qdrant.payloadIndexCalls, []);
    } finally {
        console.error = originalError;
    }
});

test("setup rechecks and validates the collection after a concurrent create returns HTTP 409", async () => {
    resetQdrant();
    qdrant.exists = false;
    qdrant.createError = Object.assign(new Error("Collection already exists"), { status: 409 });
    const result = await setupQdrant();
    assert.deepEqual(result, { collection: "pdf_chunks", created: false });
    assert.equal(qdrant.existenceChecks, 1);
    assert.equal(qdrant.createCalls.length, 1);
    assert.equal(qdrant.collectionReads, 1);
    assert.deepEqual(qdrant.payloadIndexCalls.map(([, args]) => args.field_name), ["ownerId", "documentId"]);
});

test("setup rejects an existing incompatible filter index without deleting or replacing it", async () => {
    resetQdrant();
    qdrant.collection.payload_schema.ownerId = { data_type: "integer", points: 21 };
    const originalError = console.error;
    console.error = () => {};
    try {
        await assert.rejects(setupQdrant(), error => error.code === "QDRANT_PAYLOAD_INDEX_INCOMPATIBLE");
        assert.deepEqual(qdrant.createCalls, []);
        assert.deepEqual(qdrant.payloadIndexCalls, []);
        assert.equal(qdrant.collection.payload_schema.ownerId.data_type, "integer");
    } finally {
        console.error = originalError;
    }
});

test("setup rechecks a filter index after a concurrent create returns HTTP 409", async () => {
    resetQdrant();
    qdrant.payloadIndexError = Object.assign(new Error("Index already exists"), { status: 409, simulateConcurrentIndex: true });
    const result = await setupQdrant();
    assert.deepEqual(result, { collection: "pdf_chunks", created: false });
    assert.equal(qdrant.collectionReads, 2);
    assert.deepEqual(qdrant.collection.payload_schema, {
        ownerId: { data_type: "keyword", points: 21 },
        documentId: { data_type: "keyword", points: 21 }
    });
    assert.deepEqual(qdrant.payloadIndexCalls.map(([, args]) => args.field_name), ["ownerId", "documentId"]);
    assert.deepEqual(qdrant.createCalls, []);
});

test("semantic retrieval retains owner and document filters after index setup", async () => {
    resetQdrant();
    const originalUrl = process.env.QDRANT_URL;
    process.env.QDRANT_URL = "https://qdrant.example.test";
    try {
        await setupQdrant();
        const results = await semanticSearch("safe test query", 3, "owner-a", "document-a");
        assert.equal(results.length, 1);
        assert.deepEqual(qdrant.queryArgs[1].filter, {
            must: [
                { key: "ownerId", match: { value: "owner-a" } },
                { key: "documentId", match: { value: "document-a" } }
            ]
        });
        assert.deepEqual(qdrant.payloadIndexCalls.map(([, args]) => args.field_name), ["ownerId", "documentId"]);
    } finally {
        if (originalUrl === undefined) delete process.env.QDRANT_URL;
        else process.env.QDRANT_URL = originalUrl;
    }
});
