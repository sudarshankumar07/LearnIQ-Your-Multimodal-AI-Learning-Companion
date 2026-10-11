const test = require("node:test");
const assert = require("node:assert/strict");

const geminiPath = require.resolve("../services/geminiService");
const servicePath = require.resolve("../services/topicExtractionService");
let response;
require.cache[geminiPath] = {
    id: geminiPath,
    filename: geminiPath,
    loaded: true,
    exports: { generateContent: async prompt => { response.lastPrompt = prompt; const value = typeof response.value === "function" ? response.value(prompt) : response.value; return { text: JSON.stringify(value) }; } }
};
delete require.cache[servicePath];
const { extractTaxonomy } = require("../services/topicExtractionService");

test("taxonomy extraction validates evidence and retains source locations", async () => {
    response = { value: { topics: [
        { name: "Variables", description: "Symbols for unknown values", kind: "concept", chunkIndexes: [0], evidence: "A variable is a symbol", prerequisites: [] }
    ] } };
    const chunks = [{ text: "A variable is a symbol used to represent an unknown value.", pageNumber: 3, chunkIndex: 0 }];
    const taxonomy = await extractTaxonomy(chunks, "pdf");
    assert.equal(taxonomy.topics[0].name, "Variables");
    assert.deepEqual(taxonomy.topics[0].chunkIndexes, [0]);
    assert.deepEqual(taxonomy.topics[0].sources[0], { locationType: "page", locationNumber: 3, evidence: "A variable is a symbol" });
    assert.match(response.lastPrompt, /untrusted reference data/);
});

test("taxonomy extraction leaves invented evidence unclassified without creating a source claim", async () => {
    response = { value: { topics: [
        { name: "Variables", kind: "topic", assignments: [{ chunkIndex: 0, evidence: "made up quote" }], prerequisites: [] }
    ] } };
    const taxonomy = await extractTaxonomy([{ text: "Source text is here.", pageNumber: 1 }], "pdf");
    assert.deepEqual(taxonomy.topics, []);
    assert.deepEqual(taxonomy.unclassifiedChunks, [{
        chunkIndex: 0,
        locationType: "page",
        locationNumber: 1,
        textLength: 20,
        reasons: ["evidence_not_found"]
    }]);
});

test("taxonomy extraction does not reuse one legacy evidence quote for a different chunk", async () => {
    response = { value: { topics: [
        { name: "Foundations", kind: "topic", chunkIndexes: [0, 1], evidence: "A variable represents an unknown value", prerequisites: [] }
    ] } };
    const taxonomy = await extractTaxonomy([
        { text: "A variable represents an unknown value in an expression.", pageNumber: 1 },
        { text: "An equation balances two expressions using an equal sign.", pageNumber: 2 }
    ], "pdf");
    assert.deepEqual(taxonomy.topics[0].chunkIndexes, [0]);
    assert.deepEqual(taxonomy.unclassifiedChunks.map(chunk => chunk.chunkIndex), [1]);
    assert.deepEqual(taxonomy.unclassifiedChunks[0].reasons, ["evidence_not_found"]);
});

test("taxonomy extraction validates evidence per chunk and preserves the exact source substring across line wrapping", async () => {
    response = { value: { topics: [
        { name: "Foundations", kind: "topic", assignments: [
            { chunkIndex: 0, evidence: "A variable is a symbol" },
            { chunkIndex: 1, evidence: "An equation states equality" }
        ], prerequisites: [] }
    ] } };
    const chunks = [
        { text: "A variable\r\nis a symbol used to represent an unknown value.", pageNumber: 1, chunkIndex: 0 },
        { text: "An equation states equality between expressions.", pageNumber: 2, chunkIndex: 0 }
    ];
    const taxonomy = await extractTaxonomy(chunks, "pdf");
    assert.deepEqual(taxonomy.topics[0].chunkIndexes, [0, 1]);
    assert.equal(taxonomy.topics[0].sources[0].evidence, "A variable\r\nis a symbol");
    assert.equal(taxonomy.topics[0].sources[1].evidence, "An equation states equality");
    assert.deepEqual(taxonomy.unclassifiedChunks, []);
    assert.match(response.lastPrompt, /assignments/);
    assert.match(response.lastPrompt, /Do not reuse one evidence quote for multiple chunks/);
});

test("taxonomy extraction uses global chunk indexes across model batches", async () => {
    const chunks = Array.from({ length: 25 }, (_, index) => ({
        text: `Lesson concept ${index} is supported by this source evidence.`,
        pageNumber: index + 1,
        chunkIndex: 0
    }));
    response = { value: prompt => {
        const indexes = [...prompt.matchAll(/\[C(\d+)\]/g)].map(match => Number(match[1]));
        return { topics: indexes.map(index => ({
            name: `Concept ${index}`,
            kind: "concept",
            assignments: [{ chunkIndex: index, evidence: `Lesson concept ${index} is supported` }],
            prerequisites: []
        })) };
    } };
    const taxonomy = await extractTaxonomy(chunks, "pdf");
    assert.equal(taxonomy.topics.length, 25);
    assert.deepEqual(taxonomy.topics[24].chunkIndexes, [24]);
    assert.deepEqual(taxonomy.unclassifiedChunks, []);
});

test("development diagnostics identify an uncovered chunk without logging its text", async () => {
    const previous = { nodeEnv: process.env.NODE_ENV, error: console.error };
    const lines = [];
    process.env.NODE_ENV = "development";
    console.error = line => lines.push(line);
    response = { value: { topics: [
        { name: "Variables", kind: "topic", assignments: [{ chunkIndex: 0, evidence: "private unsupported sentence" }], prerequisites: [] }
    ] } };
    const privateText = "This private source sentence contains the actual course content.";
    try {
        const taxonomy = await extractTaxonomy([{ text: privateText, pageNumber: 4, chunkIndex: 2 }], "pdf");
        assert.equal(taxonomy.unclassifiedChunks.length, 1);
        assert.equal(lines.length, 1);
        const diagnostic = JSON.parse(lines[0]);
        assert.equal(diagnostic.event, "topic_extraction_diagnostic");
        assert.equal(diagnostic.stage, "source_evidence_validation");
        assert.equal(diagnostic.chunkIndex, 0);
        assert.equal(diagnostic.chunkId, "page:4:chunk:2");
        assert.equal(diagnostic.textLength, privateText.length);
        assert.equal(diagnostic.extractedTopicCount, 0);
        assert.equal(diagnostic.validationFailureReason, "evidence_not_found");
        assert.equal(lines[0].includes(privateText), false);
    } finally {
        console.error = previous.error;
        if (previous.nodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = previous.nodeEnv;
    }
});

test("taxonomy extraction uses timestamp provenance for video chunks", async () => {
    response = { value: { topics: [
        { name: "Photosynthesis", kind: "topic", chunkIndexes: [0], evidence: "Plants convert light energy", prerequisites: [] }
    ] } };
    const taxonomy = await extractTaxonomy([{ text: "Plants convert light energy into chemical energy.", startSeconds: 42.8, endSeconds: 51 }], "video");
    assert.equal(taxonomy.topics[0].sources[0].locationType, "time");
    assert.equal(taxonomy.topics[0].sources[0].locationNumber, 42);
});
