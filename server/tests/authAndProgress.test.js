process.env.LEARNIQ_DB_PATH = ":memory:";
const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const store = require("../services/dataStore");
const auth = require("../controllers/authController");
const { readCookie, sessionHash, authenticate, verifyBrowserOrigin } = require("../middleware/auth");
const ownerFilter = require("../utils/ownerFilter");

function response() {
    return {
        statusCode: 200, body: null, headers: {},
        status(code) { this.statusCode = code; return this; },
        json(value) { this.body = value; return this; },
        setHeader(name, value) { this.headers[name] = value; }
    };
}

test("registration hashes a password and issues an HTTP-only session", async () => {
    const res = response();
    await auth.register({ body: { email: "Student@Example.edu", password: "a long unique passphrase" } }, res);
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.user.email, "student@example.edu");
    const cookie = res.headers["Set-Cookie"];
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    const token = readCookie(cookie.split(";")[0]);
    assert.equal(store.findSession(sessionHash(token)).id, res.body.user.id);
    const saved = store.findUserByEmail("student@example.edu");
    assert.notEqual(saved.passwordHash, "a long unique passphrase");
});

test("accounts cannot list one another's documents or assessments", () => {
    const owner = { id: randomUUID(), email: `${randomUUID()}@example.edu` };
    const other = { id: randomUUID(), email: `${randomUUID()}@example.edu` };
    for (const user of [owner, other]) store.createUser({ ...user, salt: "salt", passwordHash: "hash" });
    const documentId = randomUUID();
    store.createDocument({ id: documentId, userId: owner.id, title: "Private.pdf", storagePath: "private.pdf", pages: 3 });
    assert.equal(store.listDocuments(owner.id).length, 1);
    assert.equal(store.listDocuments(other.id).length, 0);
    assert.equal(store.getDocument(other.id, documentId), undefined);
    store.recordAssessment({ id: randomUUID(), userId: owner.id, score: 1, total: 1, accuracy: 100, topics: [], results: [{ topic: "Algebra", correct: true }] });
    assert.equal(store.getProgress(owner.id).mastery[0].mastery, 67);
    assert.equal(store.getProgress(other.id).mastery.length, 0);
});

test("sessions and quiz records are scoped to their user", () => {
    const ownerId = randomUUID(), otherId = randomUUID(), quizId = randomUUID();
    for (const id of [ownerId, otherId]) store.createUser({ id, email: `${id}@example.edu`, salt: "salt", passwordHash: "hash" });
    const question = { hash: "test-fingerprint", id: randomUUID(), correctAnswer: "4" };
    assert.equal(store.saveGeneratedQuiz(quizId, ownerId, [question], Date.now() + 60_000), true);
    assert.equal(store.hasQuestionFingerprint(ownerId, question.hash), true);
    assert.equal(store.hasQuestionFingerprint(otherId, question.hash), false);
    assert.equal(store.getQuizSession(quizId, otherId), null);
    assert.equal(store.getQuizSession(quizId, ownerId)[0].correctAnswer, "4");
});

test("auth middleware rejects missing sessions and browser origins are checked", () => {
    const res = response();
    let continued = false;
    authenticate({ headers: {} }, res, () => { continued = true; });
    assert.equal(continued, false);
    assert.equal(res.statusCode, 401);
    const denied = response();
    verifyBrowserOrigin({ get: () => "https://attacker.invalid" }, denied, () => { continued = true; });
    assert.equal(denied.statusCode, 403);
});

test("vector filters always include owner and optionally document scope", () => {
    assert.deepEqual(ownerFilter("owner-a", [{ key: "documentId", match: { value: "doc-a" } }]), {
        must: [
            { key: "ownerId", match: { value: "owner-a" } },
            { key: "documentId", match: { value: "doc-a" } }
        ]
    });
    assert.throws(() => ownerFilter(undefined), /owner scope/);
});

test("topic taxonomy is stable, provenance-backed, owner-scoped, and cycle-safe on re-index", () => {
    const owner = { id: randomUUID(), email: `${randomUUID()}@example.edu` };
    const other = { id: randomUUID(), email: `${randomUUID()}@example.edu` };
    for (const user of [owner, other]) store.createUser({ ...user, salt: "salt", passwordHash: "hash" });
    const documentId = randomUUID();
    store.createDocument({ id: documentId, userId: owner.id, title: "Algebra.pdf", storagePath: "private.pdf", pages: 2, sourceUnits: [{ locationType: "page", locationNumber: 1, content: "A variable is a symbol." }] });
    const taxonomy = { topics: [
        { name: "Variables", kind: "concept", description: "Symbols for unknown values", chunkIndexes: [0], sources: [{ evidence: "A variable is a symbol", locationType: "page", locationNumber: 1 }], prerequisites: [{ name: "Linear equations", evidence: "variables appear in linear equations", confidence: 0.95, locationType: "page", locationNumber: 1 }] },
        { name: "Linear equations", kind: "topic", description: "Equations with variables", chunkIndexes: [1], sources: [{ evidence: "A linear equation contains a variable", locationType: "page", locationNumber: 2 }], prerequisites: [{ name: "Variables", evidence: "A variable is a symbol", confidence: 0.95, locationType: "page", locationNumber: 2 }] }
    ] };
    store.persistTaxonomy(owner.id, documentId, taxonomy);
    const stableId = store.getTopicMap(owner.id).topics.find(topic => topic.name === "Variables").id;
    store.persistTaxonomy(owner.id, documentId, taxonomy);
    const map = store.getTopicMap(owner.id, documentId);
    assert.equal(map.topics.length, 2);
    assert.equal(map.topics.find(topic => topic.name === "Variables").id, stableId);
    assert.equal(map.topics.find(topic => topic.name === "Variables").sources.length, 1);
    assert.equal(map.topics.find(topic => topic.name === "Variables").chunks.length, 1);
    assert.equal(map.relations.length, 1, "the second edge would create a cycle and must be omitted: " + JSON.stringify(map));
    assert.equal(store.getTopicMap(other.id).topics.length, 0);
    assert.throws(() => store.persistTaxonomy(other.id, documentId, taxonomy), /not owned/);
    store.deleteDocument(owner.id, documentId);
    assert.equal(store.getDocument(owner.id, documentId), undefined);
    assert.equal(store.getSourceUnit(owner.id, documentId, "page", 1), undefined);
    assert.equal(store.getTopicMap(owner.id).topics.length, 0);
});
