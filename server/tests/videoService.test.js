const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");

const geminiPath = require.resolve("../services/geminiService");
const indexPath = require.resolve("../services/indexChunksService");
let transcription = async () => [];
let indexImplementation = async () => ({ success: true, sourceType: "video", totalChunks: 1 });
const indexed = [];

require.cache[geminiPath] = {
    id: geminiPath,
    filename: geminiPath,
    loaded: true,
    exports: { transcribeVideo: (...args) => transcription(...args) }
};
require.cache[indexPath] = {
    id: indexPath,
    filename: indexPath,
    loaded: true,
    exports: { indexChunks: async input => { indexed.push(input); return indexImplementation(input); } }
};

const { processVideo } = require("../services/videoService");

test("spoken video transcript is chunked with timestamps and indexed for its owner and document", async () => {
    const documentId = randomUUID();
    const ownerId = randomUUID();
    indexed.length = 0;
    transcription = async (filePath, mimeType) => {
        assert.equal(filePath, "fixture-with-speech.mp4");
        assert.equal(mimeType, "video/mp4");
        return [
            { startSeconds: 4, endSeconds: 7, text: "A variable represents an unknown value." },
            { startSeconds: 1, endSeconds: 3, text: "In algebra," }
        ];
    };
    indexImplementation = async input => ({ success: true, sourceType: "video", totalChunks: input.chunks.length, documentId: input.documentId });

    const result = await processVideo("fixture-with-speech.mp4", "algebra-lecture.mp4", "video/mp4", { documentId, ownerId });

    assert.equal(result.success, true);
    assert.equal(result.durationSeconds, 7);
    assert.equal(result.pages, 7);
    assert.equal(indexed.length, 1);
    assert.equal(indexed[0].sourceType, "video");
    assert.equal(indexed[0].documentId, documentId);
    assert.equal(indexed[0].ownerId, ownerId);
    assert.deepEqual(indexed[0].chunks, [{ text: "In algebra, A variable represents an unknown value.", startSeconds: 1, endSeconds: 7, chunkIndex: 0 }]);
});

test("silent caption video returns an actionable speech-only message and is not indexed", async () => {
    indexed.length = 0;
    transcription = async () => [];

    const result = await processVideo("silent-caption-cards.mp4", "silent-caption-cards.mp4", "video/mp4", { documentId: randomUUID(), ownerId: randomUUID() });

    assert.equal(result.success, false);
    assert.equal(result.type, "NO_SPEECH_TRANSCRIPT");
    assert.match(result.message, /on-screen text cards are not extracted/i);
    assert.match(result.message, /PDF or PPTX/i);
    assert.equal(indexed.length, 0);
});

test("transcript with no usable text or timestamps is reported as invalid instead of silent speech", async () => {
    indexed.length = 0;
    transcription = async () => [
        { startSeconds: 4, endSeconds: 4, text: "A visible card transcription with invalid timing." }
    ];

    const result = await processVideo("bad-transcript.mp4", "bad-transcript.mp4", "video/mp4", { documentId: randomUUID(), ownerId: randomUUID() });

    assert.equal(result.success, false);
    assert.equal(result.type, "INVALID_VIDEO_TRANSCRIPT");
    assert.match(result.message, /transcription could not be validated/i);
    assert.equal(indexed.length, 0);
});

test("video with no extractable content is rejected and never indexed", async () => {
    indexed.length = 0;
    transcription = async () => [{ startSeconds: 0, endSeconds: 2, text: "   " }];

    const result = await processVideo("no-extractable-content.mp4", "no-extractable-content.mp4", "video/mp4", { documentId: randomUUID(), ownerId: randomUUID() });

    assert.equal(result.success, false);
    assert.equal(result.type, "NO_SPEECH_TRANSCRIPT");
    assert.match(result.message, /No usable spoken narration was found/i);
    assert.equal(indexed.length, 0);
});

test("transcription exceptions remain distinct from an empty speech transcript", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const originalError = console.error;
    const lines = [];
    process.env.NODE_ENV = "development";
    console.error = line => lines.push(line);
    indexed.length = 0;
    transcription = async () => {
        const error = new Error("provider timed out");
        error.code = "ETIMEDOUT";
        throw error;
    };

    try {
        const result = await processVideo("provider-failure.mp4", "provider-failure.mp4", "video/mp4", { documentId: randomUUID(), ownerId: randomUUID() });
        assert.equal(result.success, false);
        assert.equal(result.type, "VIDEO_TRANSCRIPTION_FAILED");
        assert.doesNotMatch(result.message, /provider timed out/i);
        assert.equal(indexed.length, 0);
        const diagnostic = JSON.parse(lines[0]);
        assert.equal(diagnostic.event, "video_processing_failed");
        assert.equal(diagnostic.stage, "transcription");
        assert.equal(diagnostic.providerCode, "ETIMEDOUT");
        assert.match(diagnostic.errorMessage, /provider timed out/i);
    } finally {
        console.error = originalError;
        if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = previousNodeEnv;
    }
});
