const test = require("node:test");
const assert = require("node:assert/strict");

const clientsPath = require.resolve("../config/clients");
let deleteCall;
require.cache[clientsPath] = {
    id: clientsPath,
    filename: clientsPath,
    loaded: true,
    exports: { qdrant: { delete: async (...args) => { deleteCall = args; return { status: "completed" }; } } }
};
const servicePath = require.resolve("../services/qdrantService");
delete require.cache[servicePath];
const { deleteDocument } = require("../services/qdrantService");

test("document deletion targets only that document and authenticated owner in Qdrant", async () => {
    await deleteDocument("doc-owned", "owner-a");
    assert.equal(deleteCall[0], "pdf_chunks");
    assert.deepEqual(deleteCall[1].filter, { must: [
        { key: "ownerId", match: { value: "owner-a" } },
        { key: "documentId", match: { value: "doc-owned" } }
    ] });
    assert.equal(deleteCall[1].wait, true);
});
