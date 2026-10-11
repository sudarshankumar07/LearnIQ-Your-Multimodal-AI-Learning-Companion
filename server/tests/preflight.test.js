const test = require("node:test");
const assert = require("node:assert/strict");
const { checkRequiredConfiguration, checkVectorConfiguration, safeProviderFailure } = require("../scripts/preflight");

test("preflight reports configuration presence without values and recognizes placeholders", () => {
    const result = checkRequiredConfiguration({ GEMINI_API_KEY: "redacted-key", QDRANT_URL: "https://example.invalid", QDRANT_API_KEY: "" });
    assert.deepEqual(result, [
        { name: "GEMINI_API_KEY", configured: true, status: "configured" },
        { name: "QDRANT_URL", configured: true, status: "configured" },
        { name: "QDRANT_API_KEY", configured: false, status: "missing" }
    ]);
    assert.equal(checkRequiredConfiguration({ GEMINI_API_KEY: "replace-with-your-key", QDRANT_URL: "https://your-qdrant-cluster", QDRANT_API_KEY: "placeholder" }).some(item => !item.configured), true);
    assert.equal(checkRequiredConfiguration({ GEMINI_API_KEY: "set", QDRANT_URL: "not a URL", QDRANT_API_KEY: "set" })[1].status, "invalid URL");
    assert.equal(JSON.stringify(result).includes("redacted-key"), false);
    assert.match(safeProviderFailure("Qdrant collection", { status: 404 }), /collection exists/i);
    assert.doesNotMatch(safeProviderFailure("Gemini", new Error("private-token")), /private-token/);
});

test("preflight checks the existing unnamed vector size and distance without creating a collection", () => {
    assert.deepEqual(checkVectorConfiguration({ config: { params: { vectors: { size: 3072, distance: "Cosine" } } } }), { compatible: true, reason: "Collection uses 3072-dimensional cosine vectors." });
    assert.equal(checkVectorConfiguration({ config: { params: { vectors: { size: 768, distance: "Cosine" } } } }).compatible, false);
    assert.equal(checkVectorConfiguration({ config: { params: { vectors: { named: { size: 3072, distance: "Cosine" } } } } }).compatible, false);
});
