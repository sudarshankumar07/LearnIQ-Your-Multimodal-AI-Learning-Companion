const test = require("node:test");
const assert = require("node:assert/strict");

const ragServicePath = require.resolve("../services/ragService");
const fakeRagService = {
    answerQuestion: async (query, language, userId) => {
        if (query === "SUCCESS") {
            assert.equal(language, "en");
            assert.equal(userId, "student");
            return { answer: "Data is information [S1].", sources: [{ id: 1, name: "Notes.pdf", locationType: "page", locationNumber: 2 }] };
        }
        if (query === "CONFIG_FAIL") {
            const error = new Error("Gemini is not configured. Add GEMINI_API_KEY to server/.env and restart the server.");
            error.code = "SERVICE_NOT_CONFIGURED";
            throw error;
        }
        if (query === "PROVIDER_FAIL") throw new Error("Private provider response");
        return { answer: "Grounded answer [S1]", sources: [] };
    }
};
require.cache[ragServicePath] = {
    id: ragServicePath,
    filename: ragServicePath,
    loaded: true,
    exports: fakeRagService
};
const { askQuestion } = require("../controllers/ragController");

function response() {
    return {
        statusCode: 200,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(value) { this.body = value; return this; }
    };
}

test("ask route rejects an empty question", async () => {
    const res = response();
    await askQuestion({ body: { query: " " }, user: { id: "student" } }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /question/i);
});

test("ask route rejects an unsupported language", async () => {
    const res = response();
    await askQuestion({ body: { query: "What is data?", language: "fr" }, user: { id: "student" } }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /English, Hindi, or Hinglish/);
});

test("ask route returns the grounded answer and sources", async () => {
    const res = response();
    await askQuestion({ body: { query: "SUCCESS" }, user: { id: "student" } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.answer, "Data is information [S1].");
    assert.equal(res.body.sources[0].locationNumber, 2);
});

test("ask route returns an actionable response when provider configuration is missing", async () => {
    const res = response();
    await askQuestion({ body: { query: "CONFIG_FAIL" }, user: { id: "student" } }, res);
    assert.equal(res.statusCode, 503);
    assert.match(res.body.message, /GEMINI_API_KEY/);
});

test("ask route keeps provider failures behind a generic response", async () => {
    const res = response();
    await askQuestion({ body: { query: "PROVIDER_FAIL" }, user: { id: "student" } }, res);
    assert.equal(res.statusCode, 500);
    assert.deepEqual(res.body, { message: "Could not answer from the uploaded material." });
});
