function locationKey(location) {
    return `${location.documentKey}:${location.locationType}:${location.locationNumber}`;
}

function summarizeCase(question, retrieval, answer, documentKeyById) {
    const expectedLocations = new Set(question.expectedLocations.map(locationKey));
    const expectedEvidence = question.expectedEvidence || [];
    const relevantChunks = retrieval.filter(point => {
        const payload = point.payload || {};
        const key = locationKey({ documentKey: documentKeyById.get(payload.documentId), locationType: payload.sourceType === "video" ? "time" : payload.sourceType === "pptx" ? "slide" : "page", locationNumber: payload.sourceType === "video" ? Math.floor(payload.startSeconds || 0) : payload.slideNumber || payload.pageNumber });
        return expectedLocations.has(key) && expectedEvidence.some(evidence => String(payload.text || "").includes(evidence));
    });
    const foundEvidence = new Set();
    for (const point of retrieval) for (const evidence of expectedEvidence) if (String(point.payload?.text || "").includes(evidence)) foundEvidence.add(evidence);
    const retrievedLocations = new Set(retrieval.map(point => {
        const payload = point.payload || {};
        return locationKey({ documentKey: documentKeyById.get(payload.documentId), locationType: payload.sourceType === "video" ? "time" : payload.sourceType === "pptx" ? "slide" : "page", locationNumber: payload.sourceType === "video" ? Math.floor(payload.startSeconds || 0) : payload.slideNumber || payload.pageNumber });
    }));
    const citedIds = new Set((answer.answer.match(/\[S\d+\]/g) || []).map(citation => Number(citation.slice(2, -1))));
    const citedLocations = new Set([...citedIds].map(id => answer.sources.find(source => source.id === id)).filter(Boolean).map(source => locationKey({ documentKey: documentKeyById.get(source.documentId), locationType: source.locationType, locationNumber: source.locationNumber })));
    const refusalPattern = /not (?:enough|provided|available|specified|prove|establish)|does not (?:provide|say|prove|establish|show|support)|do not (?:prove|establish|show|support)|doesn't (?:prove|establish|show)|don't (?:prove|establish|show)|cannot (?:determine|conclude|prove|establish)|can't determine|unable to determine|not included|isn't (?:provided|specified)/i;
    const refused = refusalPattern.test(answer.answer);
    const citationCorrect = question.shouldAnswer
        ? expectedLocations.size > 0 && [...expectedLocations].every(location => citedLocations.has(location))
        : refused;
    return {
        id: question.id,
        expectedEvidence,
        retrieved: retrieval.map(point => ({ documentId: point.payload?.documentId, documentKey: documentKeyById.get(point.payload?.documentId), sourceType: point.payload?.sourceType, locationNumber: point.payload?.sourceType === "video" ? Math.floor(point.payload?.startSeconds || 0) : point.payload?.slideNumber || point.payload?.pageNumber, score: Number.isFinite(point.score) ? point.score : null, text: point.payload?.text || "" })),
        answer: answer.answer,
        citedLocations: [...citedLocations],
        metrics: {
            recallAtK: expectedLocations.size ? [...expectedLocations].filter(location => retrievedLocations.has(location)).length / expectedLocations.size : null,
            contextPrecision: retrieval.length ? relevantChunks.length / retrieval.length : 0,
            contextRecall: expectedEvidence.length ? foundEvidence.size / expectedEvidence.length : null,
            citationCorrect,
            unsupportedRefusal: question.shouldAnswer ? null : refused,
            faithfulness: null,
            answerRelevance: null
        }
    };
}

function aggregate(results) {
    const mean = key => {
        const values = results.map(result => result.metrics[key]).filter(value => typeof value === "number");
        return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    };
    return {
        sampleCount: results.length,
        recallAtK: mean("recallAtK"),
        contextPrecision: mean("contextPrecision"),
        contextRecall: mean("contextRecall"),
        citationCorrectness: mean("citationCorrect"),
        unsupportedRefusalRate: mean("unsupportedRefusal"),
        faithfulness: null,
        answerRelevance: null,
        manualReviewRequired: ["faithfulness", "answerRelevance", "causal restraint", "answer correctness"]
    };
}

module.exports = { locationKey, summarizeCase, aggregate };
