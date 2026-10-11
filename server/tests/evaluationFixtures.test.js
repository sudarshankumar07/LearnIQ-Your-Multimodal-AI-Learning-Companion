const test = require("node:test");
const assert = require("node:assert/strict");
const { PDFParse } = require("pdf-parse");
const dataset = require("../../evaluation/datasets/v1.json");
const { fixtures, makePdf } = require("../../evaluation/fixtures/makeKnownPdfFixtures");
const { aggregate, summarizeCase } = require("../../evaluation/lib/metrics");

test("versioned source-backed benchmark fixtures are valid single-page PDFs", async () => {
    assert.equal(dataset.version, "1.0.0");
    assert.equal(dataset.questions.length, 5);
    for (const fixture of fixtures) {
        const parser = new PDFParse({ data: makePdf(fixture.lines) });
        try {
            const parsed = await parser.getText();
            assert.equal(parsed.total, 1);
            for (const line of fixture.lines) assert.ok(parsed.text.includes(line), `PDF should preserve: ${line}`);
            const document = dataset.documents.find(item => item.file.endsWith(fixture.name));
            assert.ok(parsed.text.includes(document.sourceText), `fixture text should match its labeled source: ${fixture.name}`);
        } finally { await parser.destroy(); }
    }
});

test("benchmark metrics score evidence recall, citation, and unsupported refusals without inventing model-judge metrics", () => {
    const question = dataset.questions[0];
    const documentKeyById = new Map([["cedar-id", "cedar"]]);
    const retrieval = [{ id: "point-1", score: 0.9, payload: { documentId: "cedar-id", sourceType: "pdf", pageNumber: 1, text: "Cedar: 40 ml water/day; 12 cm after 7 days; 6 h sun/day." } }];
    const answer = { answer: "It reached 12 cm after 7 days [S1].", sources: [{ id: 1, documentId: "cedar-id", locationType: "page", locationNumber: 1 }] };
    const result = summarizeCase(question, retrieval, answer, documentKeyById);
    assert.equal(result.metrics.recallAtK, 1);
    assert.equal(result.metrics.contextPrecision, 1);
    assert.equal(result.metrics.contextRecall, 1);
    assert.equal(result.metrics.citationCorrect, true);
    assert.equal(aggregate([result]).faithfulness, null);
    const unsupported = summarizeCase(dataset.questions[3], [], { answer: "The soil pH is not provided in the source.", sources: [] }, documentKeyById);
    assert.equal(unsupported.metrics.unsupportedRefusal, true);
    const causal = summarizeCase(dataset.questions[4], [], { answer: "These observations do not establish that water caused the difference.", sources: [] }, documentKeyById);
    assert.equal(causal.metrics.unsupportedRefusal, true);
});
