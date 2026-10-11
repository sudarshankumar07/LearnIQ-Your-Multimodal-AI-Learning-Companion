const test = require("node:test");
const assert = require("node:assert/strict");

const clientsPath = require.resolve("../config/clients");
const geminiPath = require.resolve("../services/geminiService");
const calls = { upload: [], deleted: [], requests: [] };
let modelText = "";
const fakeAi = {
    files: {
        upload: async params => { calls.upload.push(params); return { name: "files/demo", uri: "https://provider.invalid/demo", mimeType: params.config.mimeType, state: "ACTIVE" }; },
        get: async () => ({ state: "ACTIVE" }),
        delete: async params => { calls.deleted.push(params.name); }
    },
    models: {
        generateContent: async params => { calls.requests.push(params); return { text: modelText }; },
        embedContent: async () => ({ embeddings: [{ values: [1, 2, 3] }] })
    }
};
require.cache[clientsPath] = { id: clientsPath, filename: clientsPath, loaded: true, exports: { ai: fakeAi } };
delete require.cache[geminiPath];
const { analyzePdfPages, describeSlideImages, transcribeVideo } = require("../services/geminiService");

test("PDF multimodal analysis validates page numbers and deletes the temporary provider file", async () => {
    modelText = JSON.stringify({ pages: [
        { pageNumber: 2, recognizedText: "Cellular respiration", visualDescription: "Three connected stages." },
        { pageNumber: 7, recognizedText: "Out of bounds", visualDescription: "Invalid page." },
        { pageNumber: 1, recognizedText: "", visualDescription: "" }
    ] });
    const pages = await analyzePdfPages("sample.pdf", 2);
    assert.deepEqual(pages, [{ pageNumber: 2, recognizedText: "Cellular respiration", visualDescription: "Three connected stages." }]);
    assert.equal(calls.upload.at(-1).config.mimeType, "application/pdf");
    assert.equal(calls.deleted.at(-1), "files/demo");
    assert.match(calls.requests.at(-1).contents[0].parts[0].text, /page by page/);
});

test("PPTX image analysis sends inline media and returns slide-image evidence", async () => {
    modelText = JSON.stringify({ images: [{ imageIndex: 0, recognizedText: "Input", visualDescription: "A diagram points from input to output." }] });
    const result = await describeSlideImages([{ data: Buffer.from([1, 2, 3]), mimeType: "image/png" }], "Diagram of a process");
    assert.deepEqual(result, [{ imageIndex: 0, recognizedText: "Input", visualDescription: "A diagram points from input to output." }]);
    const parts = calls.requests.at(-1).contents[0].parts;
    assert.equal(parts.length, 2);
    assert.equal(parts[1].inlineData.mimeType, "image/png");
    assert.equal(parts[1].inlineData.data, Buffer.from([1, 2, 3]).toString("base64"));
});

test("video transcription sends the original media to Gemini, preserves timestamps, and deletes its temporary copy", async () => {
    const previousKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = "test-only-provider-placeholder";
    modelText = JSON.stringify({ segments: [
        { startSeconds: 3.5, endSeconds: 7.25, text: "A variable represents an unknown value." }
    ] });
    try {
        const segments = await transcribeVideo("lecture.mp4", "video/mp4");
        assert.deepEqual(segments, [{ startSeconds: 3.5, endSeconds: 7.25, text: "A variable represents an unknown value." }]);
        assert.equal(calls.upload.at(-1).file, "lecture.mp4");
        assert.equal(calls.upload.at(-1).config.mimeType, "video/mp4");
        const request = calls.requests.at(-1);
        assert.match(request.contents[0].parts[0].text, /only speech that is actually audible/i);
        assert.equal(request.contents[0].parts[1].fileData.mimeType, "video/mp4");
        assert.equal(calls.deleted.at(-1), "files/demo");
    } finally {
        if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
        else process.env.GEMINI_API_KEY = previousKey;
    }
});

test("video transcription deletes its temporary Gemini file when transcription output is invalid", async () => {
    const previousKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = "test-only-provider-placeholder";
    modelText = "not-json";
    const deletedBefore = calls.deleted.length;
    try {
        await assert.rejects(transcribeVideo("lecture.mp4", "video/mp4"), SyntaxError);
        assert.equal(calls.deleted.length, deletedBefore + 1);
        assert.equal(calls.deleted.at(-1), "files/demo");
    } finally {
        if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
        else process.env.GEMINI_API_KEY = previousKey;
    }
});
