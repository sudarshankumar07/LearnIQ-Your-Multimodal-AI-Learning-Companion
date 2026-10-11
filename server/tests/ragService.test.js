const test = require("node:test");
const assert = require("node:assert/strict");

const qdrantPath = require.resolve("../services/qdrantService");
const geminiPath = require.resolve("../services/geminiService");
const ragPath = require.resolve("../services/ragService");
let searchArgs;
let generatedPrompt;
let generate = async prompt => {
    generatedPrompt = prompt;
    return { text: "Data is organized information [S1]. Unsupported detail [S3]." };
};

require.cache[qdrantPath] = {
    id: qdrantPath,
    filename: qdrantPath,
    loaded: true,
    exports: {
        semanticSearch: async (...args) => {
            searchArgs = args;
            return [
                { id: "point-a", score: 0.84, payload: { documentId: "doc-a", source: "notes.pdf", sourceType: "pdf", pageNumber: 4, text: "Data is organized information." } },
                { id: "point-b", score: 0.12, payload: { documentId: "doc-b", source: "other.pdf", sourceType: "pdf", pageNumber: 2, text: "An unrelated short excerpt." } },
                { id: "point-empty", score: 0.02, payload: { documentId: "doc-c" } }
            ];
        }
    }
};
require.cache[geminiPath] = {
    id: geminiPath,
    filename: geminiPath,
    loaded: true,
    exports: {
        generateContent: prompt => generate(prompt)
    }
};
delete require.cache[ragPath];
const { answerQuestion } = require("../services/ragService");

test("RAG keeps owner scope, filters empty chunks, and reports safe retrieval diagnostics", async () => {
    const originalInfo = console.info;
    const lines = [];
    console.info = line => lines.push(line);
    try {
        const result = await answerQuestion("What is data?", "en", "owner-a");
        assert.deepEqual(searchArgs, ["What is data?", 3, "owner-a"]);
        assert.match(generatedPrompt, /notes\.pdf, page 4/);
        assert.match(generatedPrompt, /other\.pdf, page 2/);
        assert.equal(result.sources.length, 2);
        assert.match(result.answer, /\[S1\]/);
        assert.doesNotMatch(result.answer, /\[S3\]/);
        const diagnostic = JSON.parse(lines[0]);
        assert.equal(diagnostic.event, "rag_retrieval");
        assert.equal(diagnostic.retrievedCount, 3);
        assert.equal(diagnostic.usableCount, 2);
        assert.equal(diagnostic.sources[0].pointId, "point-a");
        assert.equal(diagnostic.sources[0].score, 0.84);
        assert.match(diagnostic.sources[0].preview, /Data is organized information/);
        assert.equal(diagnostic.sources[2].preview, "");
    } finally {
        console.info = originalInfo;
    }
});

test("RAG records the failed stage without exposing provider error text", async () => {
    const originalGenerate = generate;
    const failure = new Error("private provider response");
    generate = async () => { throw failure; };
    try {
        await assert.rejects(answerQuestion("Question", "en", "owner-a"), error => {
            assert.equal(error.ragStage, "answer_generation");
            assert.equal(error.message, "private provider response");
            return true;
        });
    } finally {
        generate = originalGenerate;
    }
});
