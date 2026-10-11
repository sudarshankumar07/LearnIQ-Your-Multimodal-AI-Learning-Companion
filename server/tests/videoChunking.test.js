const test = require("node:test");
const assert = require("node:assert/strict");
const { buildVideoChunks } = require("../services/videoService");

test("video transcript chunks retain ordered timestamps and join nearby speech", () => {
    const chunks = buildVideoChunks([
        { startSeconds: 8, endSeconds: 15, text: "Second segment" },
        { startSeconds: 1, endSeconds: 7, text: "First segment" },
        { startSeconds: -1, endSeconds: 2, text: "Invalid time" },
        { startSeconds: 15, endSeconds: 16, text: "   " }
    ]);
    assert.deepEqual(chunks, [{ text: "First segment Second segment", startSeconds: 1, endSeconds: 15, chunkIndex: 0 }]);
});

test("video transcript chunking distinguishes absent speech from invalid transcript timestamps", () => {
    assert.throws(() => buildVideoChunks([{ startSeconds: 4, endSeconds: 4, text: "Transcript text with no duration" }]), { code: "INVALID_TRANSCRIPT_SEGMENTS" });
    assert.throws(() => buildVideoChunks([]), { code: "NO_SPEECH_TRANSCRIPT" });
});
