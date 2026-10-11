const test = require("node:test");
const assert = require("node:assert/strict");
const { QdrantClient } = require("@qdrant/js-client-rest");

test("Qdrant SDK 1.19.0 serializes the current query call to the supported Query Points request body", async () => {
    const previousFetch = global.fetch;
    let request;
    global.fetch = async (url, init) => {
        request = { url: String(url), method: init.method, body: JSON.parse(init.body) };
        return new Response(JSON.stringify({ result: { points: [] }, status: "ok", time: 0 }), {
            status: 200,
            headers: { "content-type": "application/json" }
        });
    };

    try {
        const client = new QdrantClient({ url: "https://qdrant.example", checkCompatibility: false });
        await client.query("pdf_chunks", {
            query: [0.25, -0.5],
            limit: 3,
            filter: { must: [
                { key: "ownerId", match: { value: "owner-a" } },
                { key: "documentId", match: { value: "doc-a" } }
            ] },
            with_payload: true
        });

        assert.deepEqual(request, {
            url: "https://qdrant.example:6333/collections/pdf_chunks/points/query",
            method: "POST",
            body: {
                query: [0.25, -0.5],
                limit: 3,
                filter: { must: [
                    { key: "ownerId", match: { value: "owner-a" } },
                    { key: "documentId", match: { value: "doc-a" } }
                ] },
                with_payload: true
            }
        });
    } finally {
        global.fetch = previousFetch;
    }
});

test("Qdrant SDK 1.19.0 serializes keyword payload-index creation to the supported collection index API", async () => {
    const previousFetch = global.fetch;
    let request;
    global.fetch = async (url, init) => {
        request = { url: String(url), method: init.method, body: JSON.parse(init.body) };
        return new Response(JSON.stringify({ result: { operation_id: 1, status: "completed" }, status: "ok", time: 0 }), {
            status: 200,
            headers: { "content-type": "application/json" }
        });
    };

    try {
        const client = new QdrantClient({ url: "https://qdrant.example", checkCompatibility: false });
        await client.createPayloadIndex("pdf_chunks", {
            field_name: "ownerId",
            field_schema: "keyword",
            wait: true
        });

        assert.deepEqual(request, {
            url: "https://qdrant.example:6333/collections/pdf_chunks/index?wait=true",
            method: "PUT",
            body: { field_name: "ownerId", field_schema: "keyword" }
        });
    } finally {
        global.fetch = previousFetch;
    }
});
