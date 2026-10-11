const test = require("node:test");
const assert = require("node:assert/strict");
const { buildPdfChunks } = require("../utils/buildPdfChunks");

test("scanned PDF OCR and figure descriptions retain page provenance", () => {
    const chunks = buildPdfChunks(
        [{ num: 1, text: "" }, { num: 2, text: "A variable is a symbol used for an unknown value." }],
        [
            { pageNumber: 1, recognizedText: "Cellular respiration", visualDescription: "A diagram shows glucose moving through three stages." },
            { pageNumber: 2, recognizedText: "A variable is a symbol used for an unknown value.", visualDescription: "A coordinate graph labels x and y." }
        ]
    );
    assert.equal(chunks.length, 2);
    assert.equal(chunks[0].pageNumber, 1);
    assert.match(chunks[0].text, /Text recognized from page image: Cellular respiration/);
    assert.match(chunks[1].text, /A variable is a symbol/);
    assert.doesNotMatch(chunks[1].text, /Text recognized from page image/);
    assert.match(chunks[1].text, /Figure or diagram description/);
    assert.equal(chunks[1].pageNumber, 2);
});
