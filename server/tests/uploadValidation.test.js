process.env.LEARNIQ_DB_PATH = ":memory:";
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { once } = require("node:events");
const { randomUUID } = require("node:crypto");

for (const [service, method] of [["pdfService", "processPDF"], ["pptxService", "processPptx"], ["videoService", "processVideo"]]) {
    const servicePath = require.resolve(`../services/${service}`);
    require.cache[servicePath] = { id: servicePath, filename: servicePath, loaded: true, exports: { [method]: async () => { throw new Error("Must not process a rejected upload"); } } };
}
const clientsPath = require.resolve("../config/clients");
require.cache[clientsPath] = { id: clientsPath, filename: clientsPath, loaded: true, exports: { qdrant: { delete: async () => ({}) } } };
const store = require("../services/dataStore");
const ownerId = randomUUID();
store.createUser({ id: ownerId, email: `${ownerId}@example.edu`, salt: "salt", passwordHash: "hash" });
const uploadRoutes = require("../routes/uploadRoutes");

const app = express();
app.use("/upload", (req, _res, next) => { req.user = { id: ownerId }; next(); }, uploadRoutes);
app.use((error, _req, res, _next) => {
    if (error instanceof require("multer").MulterError) return res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ message: "Upload rejected." });
    return res.status(500).json({ message: "Request failed." });
});
let server, base;

test.before(async () => {
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => { if (server) await new Promise(resolve => server.close(resolve)); });

async function uploadPdf(bytes, name = "fixture.pdf") {
    const form = new FormData();
    form.append("material", new Blob([bytes], { type: "application/pdf" }), name);
    return fetch(`${base}/upload`, { method: "POST", body: form });
}

test("malformed PDF signatures are rejected before any parser/provider call", async () => {
    const response = await uploadPdf(Buffer.from("this is not a PDF"));
    assert.equal(response.status, 400);
    assert.equal(store.listDocuments(ownerId).length, 0);
});

test("PDFs above the 20 MB limit are rejected without indexing", async () => {
    const oversized = Buffer.alloc(20 * 1024 * 1024 + 1, 0x20);
    Buffer.from("%PDF-1.4").copy(oversized);
    const response = await uploadPdf(oversized, "oversized.pdf");
    assert.equal(response.status, 413);
    assert.equal(store.listDocuments(ownerId).length, 0);
});
