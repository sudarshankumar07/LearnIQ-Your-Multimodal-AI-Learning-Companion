process.env.LEARNIQ_DB_PATH = ":memory:";
const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");

const qdrantPath = require.resolve("../services/qdrantService");
const geminiPath = require.resolve("../services/geminiService");
const userId = randomUUID();
const documentId = randomUUID();
let providerFailure = null;
let generateContentResponse = async () => ({ text: JSON.stringify({ questions: [] }) });

require.cache[qdrantPath] = {
    id: qdrantPath,
    filename: qdrantPath,
    loaded: true,
    exports: {
        semanticSearch: async (_query, _limit, ownerId, scopedDocumentId) => {
            assert.equal(ownerId, userId);
            assert.equal(scopedDocumentId, undefined);
            return [{ id: "point-a", payload: { text: "A variable represents an unknown value.", source: "notes.pdf", sourceType: "pdf", documentId, ownerId, pageNumber: 1 } }];
        }
    }
};
require.cache[geminiPath] = {
    id: geminiPath,
    filename: geminiPath,
    loaded: true,
    exports: {
        generateContent: async prompt => {
            if (providerFailure) throw providerFailure;
            return generateContentResponse(prompt);
        }
    }
};

const store = require("../services/dataStore");
const { generateQuiz } = require("../services/quizService");
store.createUser({ id: userId, email: `${userId}@example.edu`, salt: "test", passwordHash: "test" });

test("assessment generation keeps its safe 502 response and logs sanitized provider failure in development", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const originalError = console.error;
    const lines = [];
    process.env.NODE_ENV = "development";
    console.error = line => lines.push(line);
    providerFailure = new Error('Gemini request failed; prompt: "PRIVATE COURSE MATERIAL"; api_key=private-key-value');
    providerFailure.name = "GoogleGenAIError";
    providerFailure.status = 503;
    providerFailure.code = "UNAVAILABLE";

    try {
        await assert.rejects(
            generateQuiz({ userId, count: 1, difficulty: "mixed", type: "mcq" }),
            error => {
                assert.equal(error.status, 502);
                assert.equal(error.message, "The question generator returned an unreadable response. Please try again.");
                assert.doesNotMatch(error.message, /PRIVATE COURSE MATERIAL|private-key-value/);
                return true;
            }
        );
        assert.equal(lines.length, 1);
        const diagnostic = JSON.parse(lines[0]);
        assert.equal(diagnostic.event, "assessment_generation_failed");
        assert.equal(diagnostic.stage, "question_generation");
        assert.equal(diagnostic.exceptionName, "GoogleGenAIError");
        assert.equal(diagnostic.providerStatus, 503);
        assert.equal(diagnostic.providerCode, "UNAVAILABLE");
        assert.doesNotMatch(lines[0], /PRIVATE COURSE MATERIAL|private-key-value/);
    } finally {
        providerFailure = null;
        console.error = originalError;
        if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = previousNodeEnv;
    }
});

test("assessment generation diagnostics are disabled in production", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const originalError = console.error;
    const lines = [];
    process.env.NODE_ENV = "production";
    console.error = line => lines.push(line);
    providerFailure = new Error("upstream unavailable");

    try {
        await assert.rejects(generateQuiz({ userId, count: 1, difficulty: "mixed", type: "mcq" }), { status: 502 });
        assert.deepEqual(lines, []);
    } finally {
        providerFailure = null;
        console.error = originalError;
        if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = previousNodeEnv;
    }
});

test("assessment 422 logs only safe candidate rejection counts in development", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const originalError = console.error;
    const lines = [];
    process.env.NODE_ENV = "development";
    console.error = line => lines.push(line);
    const candidate = {
        question: "What does x represent?",
        type: "mcq",
        options: ["An unknown value", "A page number", "A fixed graph", "An equation"],
        correctAnswer: "An unknown value",
        topic: "Variables",
        difficulty: "easy",
        sourceIndex: 2,
        explanation: "The source defines a variable."
    };
    generateContentResponse = async prompt => ({
        text: prompt.startsWith("Create exactly")
            ? JSON.stringify({ questions: [candidate] })
            : JSON.stringify({ checks: [{ supported: true, answerCorrect: true, topicAndDifficultyValid: true, semanticallyNovel: true }] })
    });

    try {
        await assert.rejects(
            generateQuiz({ userId, count: 1, difficulty: "mixed", type: "mixed" }),
            error => {
                assert.equal(error.status, 422);
                assert.equal(error.message, "Only 0 of 1 questions passed validation. Try a broader topic or a different type.");
                return true;
            }
        );
        assert.equal(lines.length, 1);
        const diagnostic = JSON.parse(lines[0]);
        assert.equal(diagnostic.event, "assessment_question_validation_failed");
        assert.equal(diagnostic.requestedCount, 1);
        assert.equal(diagnostic.candidateCount, 1);
        assert.equal(diagnostic.acceptedCount, 0);
        assert.equal(diagnostic.rejectedCount, 1);
        assert.deepEqual(diagnostic.reasonCounts, { source_missing_or_out_of_range: 1 });
        assert.doesNotMatch(lines[0], /What does x represent|unknown value|Variables|notes\.pdf|A variable represents/);
    } finally {
        generateContentResponse = async () => ({ text: JSON.stringify({ questions: [] }) });
        console.error = originalError;
        if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = previousNodeEnv;
    }
});
