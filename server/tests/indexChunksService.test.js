process.env.LEARNIQ_DB_PATH = ":memory:";
const test = require("node:test");
const assert = require("node:assert/strict");

const qdrantPath = require.resolve("../services/qdrantService");
const geminiPath = require.resolve("../services/geminiService");
const pointsStored = [];
let taxonomyResponse = {
    topics: [
        { name: "Variables", description: "Symbols for values", kind: "concept", chunkIndexes: [0], evidence: "A variable is a symbol", prerequisites: [] },
        { name: "Equations", description: "Equality statements", kind: "topic", chunkIndexes: [1], evidence: "An equation states equality", prerequisites: [] }
    ]
};
require.cache[qdrantPath] = {
    id: qdrantPath,
    filename: qdrantPath,
    loaded: true,
    exports: {
        storePoints: async (_points) => pointsStored.push(_points),
        deleteDocument: async () => {}
    }
};
require.cache[geminiPath] = {
    id: geminiPath,
    filename: geminiPath,
    loaded: true,
    exports: {
        createEmbedding: async text => [text.length, 1, 2],
        generateContent: async () => ({ text: JSON.stringify(taxonomyResponse) })
    }
};
const { indexChunks } = require("../services/indexChunksService");

test("indexing attaches source-backed topics and stable point IDs for re-indexes", async () => {
    const chunks = [
        { text: "A variable is a symbol used for a value.", pageNumber: 1, chunkIndex: 0 },
        { text: "An equation states equality between expressions.", pageNumber: 2, chunkIndex: 0 }
    ];
    const first = await indexChunks({ chunks, sourceName: "algebra.pdf", sourceType: "pdf", documentId: "doc-stable", ownerId: "learner-a" });
    const second = await indexChunks({ chunks, sourceName: "algebra.pdf", sourceType: "pdf", documentId: "doc-stable", ownerId: "learner-a" });
    assert.equal(first.totalChunks, 2);
    assert.equal(pointsStored.length, 2);
    const firstBatch = pointsStored[0], secondBatch = pointsStored[1];
    assert.deepEqual(firstBatch.map(point => point.id), secondBatch.map(point => point.id));
    assert.notEqual(firstBatch[0].id, firstBatch[1].id);
    assert.match(firstBatch[0].id, /^[0-9a-f-]{36}$/i);
    assert.deepEqual(firstBatch[0].payload.topicIds, [second.taxonomy.topics.find(topic => topic.name === "Variables") && require("../services/dataStore").stableTopicId("learner-a", "Variables")]);
    assert.equal(firstBatch[0].payload.globalChunkIndex, 0);
    assert.equal(firstBatch[1].payload.globalChunkIndex, 1);
});

test("indexing preserves an unclassified chunk with its text and no invented topic IDs", async () => {
    taxonomyResponse = {
        topics: [
            { name: "Invented topic", kind: "topic", assignments: [{ chunkIndex: 0, evidence: "evidence absent from source" }], prerequisites: [] }
        ]
    };
    const sourceText = "The source text remains available to retrieval without an unsupported topic label.";
    const result = await indexChunks({
        chunks: [{ text: sourceText, pageNumber: 5, chunkIndex: 0 }],
        sourceName: "unclassified.pdf",
        sourceType: "pdf",
        documentId: "doc-unclassified",
        ownerId: "learner-a"
    });
    const storedPoint = pointsStored.at(-1)[0];
    assert.equal(result.unclassifiedChunkCount, 1);
    assert.match(result.warnings[0], /indexed without topic labels/);
    assert.equal(result.taxonomy.topics.length, 0);
    assert.deepEqual(storedPoint.payload.topicIds, []);
    assert.equal(storedPoint.payload.text, sourceText);
    assert.equal(storedPoint.payload.ownerId, "learner-a");
    assert.equal(storedPoint.payload.documentId, "doc-unclassified");
});

test("video transcript text is embedded and stored with owner, document, and timestamp provenance", async () => {
    taxonomyResponse = {
        topics: [{ name: "Orbits", description: "Motion around a star", kind: "concept", chunkIndexes: [0], evidence: "Objects orbit a star", prerequisites: [] }]
    };
    const transcriptText = "Objects orbit a star because gravity provides centripetal force.";
    const documentId = "doc-video";
    const ownerId = "learner-video";
    const result = await indexChunks({
        chunks: [{ text: transcriptText, startSeconds: 18, endSeconds: 26, chunkIndex: 0 }],
        sourceName: "orbits-lecture.mp4",
        sourceType: "video",
        documentId,
        ownerId
    });

    const storedPoint = pointsStored.at(-1)[0];
    assert.equal(result.success, true);
    assert.equal(result.sourceType, "video");
    assert.deepEqual(storedPoint.vector, [transcriptText.length, 1, 2]);
    assert.equal(storedPoint.payload.text, transcriptText);
    assert.equal(storedPoint.payload.startSeconds, 18);
    assert.equal(storedPoint.payload.endSeconds, 26);
    assert.equal(storedPoint.payload.sourceType, "video");
    assert.equal(storedPoint.payload.ownerId, ownerId);
    assert.equal(storedPoint.payload.documentId, documentId);
    assert.equal(storedPoint.payload.source, "orbits-lecture.mp4");
});
