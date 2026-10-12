const path = require("path");
const fs = require("fs");
const { createHash } = require("crypto");
const { DatabaseSync } = require("node:sqlite");

const dataDir = process.env.LEARNIQ_DATA_DIR || path.join(__dirname, "..", "data");
fs.mkdirSync(dataDir, { recursive: true });
const dbPath = process.env.LEARNIQ_DB_PATH || path.join(dataDir, "learniq.sqlite");
const db = new DatabaseSync(dbPath);
db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE,
        password_salt TEXT NOT NULL, password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL, storage_path TEXT NOT NULL, pages INTEGER NOT NULL, source_type TEXT NOT NULL DEFAULT 'pdf',
        created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS documents_user_idx ON documents(user_id, created_at);
    CREATE TABLE IF NOT EXISTS quiz_sessions (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        questions_json TEXT NOT NULL, expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS question_history (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        fingerprint TEXT NOT NULL, question_text TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
        PRIMARY KEY(user_id, fingerprint)
    );
    CREATE TABLE IF NOT EXISTS assessments (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        score INTEGER NOT NULL, total INTEGER NOT NULL, accuracy INTEGER NOT NULL,
        topics_json TEXT NOT NULL, results_json TEXT NOT NULL, diagnostics_json TEXT NOT NULL DEFAULT '{}',
        mode TEXT NOT NULL DEFAULT 'practice', created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS assessments_user_idx ON assessments(user_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS mastery (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        topic TEXT NOT NULL, alpha REAL NOT NULL DEFAULT 1, beta REAL NOT NULL DEFAULT 1,
        attempts INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL,
        PRIMARY KEY(user_id, topic)
    );
    CREATE TABLE IF NOT EXISTS source_units (
        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        location_type TEXT NOT NULL, location_number INTEGER NOT NULL, content TEXT NOT NULL,
        PRIMARY KEY(document_id, location_type, location_number)
    );
    CREATE TABLE IF NOT EXISTS topics (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        slug TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('topic','subtopic','concept')),
        UNIQUE(owner_id, slug),
        UNIQUE(owner_id, id)
    );
    CREATE TABLE IF NOT EXISTS topic_sources (
        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        topic_id TEXT NOT NULL,
        evidence TEXT NOT NULL,
        location_type TEXT NOT NULL,
        location_number INTEGER NOT NULL,
        PRIMARY KEY(document_id, topic_id, location_type, location_number),
        FOREIGN KEY(user_id, topic_id) REFERENCES topics(owner_id, id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS chunk_topics (
        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        chunk_index INTEGER NOT NULL,
        topic_id TEXT NOT NULL,
        PRIMARY KEY(document_id, chunk_index, topic_id),
        FOREIGN KEY(user_id, topic_id) REFERENCES topics(owner_id, id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS topic_relations (
        owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        from_topic_id TEXT NOT NULL,
        to_topic_id TEXT NOT NULL,
        relation_type TEXT NOT NULL CHECK(relation_type IN ('prerequisite','subtopic')),
        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        source_location_type TEXT NOT NULL,
        source_location_number REAL NOT NULL,
        evidence TEXT NOT NULL,
        confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
        PRIMARY KEY(owner_id, from_topic_id, to_topic_id, relation_type, document_id),
        CHECK(from_topic_id <> to_topic_id),
        FOREIGN KEY(owner_id, from_topic_id) REFERENCES topics(owner_id, id) ON DELETE CASCADE,
        FOREIGN KEY(owner_id, to_topic_id) REFERENCES topics(owner_id, id) ON DELETE CASCADE
    );
`);
const documentColumns = new Set(db.prepare("PRAGMA table_info(documents)").all().map(column => column.name));
if (!documentColumns.has("source_type")) db.exec("ALTER TABLE documents ADD COLUMN source_type TEXT NOT NULL DEFAULT 'pdf'");
const questionHistoryColumns = new Set(db.prepare("PRAGMA table_info(question_history)").all().map(column => column.name));
if (!questionHistoryColumns.has("question_text")) db.exec("ALTER TABLE question_history ADD COLUMN question_text TEXT NOT NULL DEFAULT ''");
const assessmentColumns = new Set(db.prepare("PRAGMA table_info(assessments)").all().map(column => column.name));
if (!assessmentColumns.has("mode")) db.exec("ALTER TABLE assessments ADD COLUMN mode TEXT NOT NULL DEFAULT 'practice'");
if (!assessmentColumns.has("diagnostics_json")) db.exec("ALTER TABLE assessments ADD COLUMN diagnostics_json TEXT NOT NULL DEFAULT '{}'");
const relationColumns = new Set(db.prepare("PRAGMA table_info(topic_relations)").all().map(column => column.name));
if (!relationColumns.has("source_location_type")) db.exec("ALTER TABLE topic_relations ADD COLUMN source_location_type TEXT NOT NULL DEFAULT 'page'");
if (!relationColumns.has("source_location_number")) db.exec("ALTER TABLE topic_relations ADD COLUMN source_location_number REAL NOT NULL DEFAULT 1");

const nowIso = () => new Date().toISOString();
function createUser({ id, email, salt, passwordHash }) {
    db.prepare("INSERT INTO users(id,email,password_salt,password_hash,created_at) VALUES(?,?,?,?,?)").run(id, email, salt, passwordHash, nowIso());
}
function findUserByEmail(email) {
    return db.prepare("SELECT id,email,password_salt AS salt,password_hash AS passwordHash FROM users WHERE email=?").get(email);
}
function saveSession(tokenHash, userId, expiresAt) {
    db.prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)").run(tokenHash, userId, expiresAt);
}
function findSession(tokenHash) {
    const now = Date.now();
    db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
    return db.prepare("SELECT users.id,users.email FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.token_hash=? AND sessions.expires_at>?").get(tokenHash, now);
}
function deleteSession(tokenHash) { db.prepare("DELETE FROM sessions WHERE token_hash=?").run(tokenHash); }
function createDocument({ id, userId, title, storagePath, pages, sourceType = "pdf", sourceUnits = [] }) {
    const insertDocument = db.prepare("INSERT INTO documents(id,user_id,title,storage_path,pages,source_type,created_at) VALUES(?,?,?,?,?,?,?)");
    const insertUnit = db.prepare("INSERT INTO source_units(document_id,user_id,location_type,location_number,content) VALUES(?,?,?,?,?)");
    db.exec("BEGIN IMMEDIATE");
    try {
        insertDocument.run(id, userId, title, storagePath, pages, sourceType, nowIso());
        for (const unit of sourceUnits) insertUnit.run(id, userId, unit.locationType, unit.locationNumber, unit.content);
        db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
}
function listDocuments(userId) {
    return db.prepare("SELECT id,title AS name,pages,source_type AS sourceType,created_at AS createdAt FROM documents WHERE user_id=? ORDER BY created_at DESC").all(userId);
}
function getDocument(userId, id) {
    return db.prepare("SELECT id,title,storage_path AS storagePath,pages,source_type AS sourceType FROM documents WHERE user_id=? AND id=?").get(userId, id);
}
function getSourceUnit(userId, documentId, locationType, locationNumber) {
    return db.prepare("SELECT content FROM source_units WHERE user_id=? AND document_id=? AND location_type=? AND location_number=?").get(userId, documentId, locationType, locationNumber);
}
function topicKey(name) {
    return String(name).normalize("NFKC").trim().toLocaleLowerCase().replace(/\s+/g, " ");
}
function stableTopicId(userId, name) {
    return `topic-${createHash("sha256").update(`${userId}\0${topicKey(name)}`).digest("hex").slice(0, 32)}`;
}
function topicSlug(name) { return topicKey(name); }
function persistTaxonomy(userId, documentId, taxonomy) {
    const document = getDocument(userId, documentId);
    if (!document) throw new Error("Document is not owned by this user.");
    const names = new Map((taxonomy?.topics || []).map(topic => [topicKey(topic.name), topic]));
    const idByName = new Map([...names].map(([key, topic]) => [key, stableTopicId(userId, topic.name)]));
    const findSourceLocation = location => {
        if (location?.locationType === "time") return Number.isFinite(location.locationNumber) && location.locationNumber >= 0;
        return Number.isInteger(location?.locationNumber) && location.locationNumber >= 1 && location.locationNumber <= document.pages;
    };
    db.exec("BEGIN IMMEDIATE");
    try {
        db.prepare("DELETE FROM topic_sources WHERE document_id=? AND user_id=?").run(documentId, userId);
        db.prepare("DELETE FROM chunk_topics WHERE document_id=? AND user_id=?").run(documentId, userId);
        db.prepare("DELETE FROM topic_relations WHERE document_id=? AND owner_id=?").run(documentId, userId);
        const upsertTopic = db.prepare(`INSERT INTO topics(id,owner_id,slug,name,description,kind) VALUES(?,?,?,?,?,?)
            ON CONFLICT(owner_id,slug) DO UPDATE SET name=excluded.name,description=excluded.description,kind=excluded.kind`);
        const insertSource = db.prepare("INSERT OR IGNORE INTO topic_sources(document_id,user_id,topic_id,evidence,location_type,location_number) VALUES(?,?,?,?,?,?)");
        const insertChunk = db.prepare("INSERT OR IGNORE INTO chunk_topics(document_id,user_id,chunk_index,topic_id) VALUES(?,?,?,?)");
        const insertRelation = db.prepare("INSERT OR IGNORE INTO topic_relations(owner_id,from_topic_id,to_topic_id,relation_type,document_id,evidence,confidence,source_location_type,source_location_number) VALUES(?,?,?,?,?,?,?,?,?)");
        for (const [key, topic] of names) {
            const id = idByName.get(key);
            const kind = ["topic", "subtopic", "concept"].includes(topic.kind) ? topic.kind : "topic";
            upsertTopic.run(id, userId, topicSlug(topic.name), String(topic.name).trim().slice(0, 120), String(topic.description || "").trim().slice(0, 500), kind);
            for (const source of topic.sources || []) {
                if (!findSourceLocation(source) || typeof source.evidence !== "string" || !source.evidence.trim()) continue;
                insertSource.run(documentId, userId, id, source.evidence.slice(0, 500), source.locationType, source.locationNumber);
            }
            for (const index of new Set(topic.chunkIndexes || [])) {
                if (Number.isInteger(index) && index >= 0) insertChunk.run(documentId, userId, index, id);
            }
        }
        const edges = [];
        for (const [key, topic] of names) {
            const fromId = idByName.get(key);
            const candidates = [
                ...(topic.parentName ? [{ name: topic.parentName, type: "subtopic", evidence: topic.parentEvidence, confidence: topic.parentConfidence, locationType: topic.parentLocationType, locationNumber: topic.parentLocationNumber }] : []),
                ...(topic.prerequisites || []).map(item => ({ name: item.name, type: "prerequisite", evidence: item.evidence, confidence: item.confidence, locationType: item.locationType, locationNumber: item.locationNumber }))
            ];
            for (const relation of candidates) {
                const toId = idByName.get(topicKey(relation.name));
                const confidence = Number(relation.confidence);
                if (!toId || toId === fromId || typeof relation.evidence !== "string" || !relation.evidence.trim() || !Number.isFinite(confidence) || confidence < 0.85 || confidence > 1) continue;
                if (!findSourceLocation({ locationType: relation.locationType, locationNumber: relation.locationNumber })) continue;
                edges.push({ fromId, toId, type: relation.type, evidence: relation.evidence.slice(0, 500), confidence, locationType: relation.locationType, locationNumber: relation.locationNumber });
            }
        }
        const adjacency = new Map();
        for (const relation of db.prepare("SELECT from_topic_id AS fromId,to_topic_id AS toId FROM topic_relations WHERE owner_id=?").all(userId)) {
            const children = adjacency.get(relation.fromId) || [];
            children.push(relation.toId);
            adjacency.set(relation.fromId, children);
        }
        for (const edge of edges) {
            const stack = [edge.toId], visited = new Set();
            let cyclic = false;
            while (stack.length) {
                const node = stack.pop();
                if (node === edge.fromId) { cyclic = true; break; }
                if (visited.has(node)) continue;
                visited.add(node);
                stack.push(...(adjacency.get(node) || []));
            }
            if (cyclic) continue;
            insertRelation.run(userId, edge.fromId, edge.toId, edge.type, documentId, edge.evidence, edge.confidence, edge.locationType, edge.locationNumber);
            const children = adjacency.get(edge.fromId) || [];
            children.push(edge.toId);
            adjacency.set(edge.fromId, children);
        }
        db.prepare("DELETE FROM topics WHERE owner_id=? AND id NOT IN (SELECT topic_id FROM topic_sources UNION SELECT topic_id FROM chunk_topics)").run(userId);
        db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
}
function getTopicMap(userId, documentId) {
    const scope = documentId || null;
    const topics = db.prepare(`SELECT DISTINCT t.id,t.name,t.description,t.kind
        FROM topics t JOIN topic_sources s ON s.user_id=t.owner_id AND s.topic_id=t.id
        WHERE t.owner_id=? AND (? IS NULL OR s.document_id=?) ORDER BY t.name`).all(userId, scope, scope);
    const sourceRows = db.prepare(`SELECT s.topic_id,s.document_id,d.title AS source,s.evidence,s.location_type AS locationType,s.location_number AS locationNumber
        FROM topic_sources s JOIN documents d ON d.id=s.document_id AND d.user_id=s.user_id
        WHERE s.user_id=? AND (? IS NULL OR s.document_id=?) ORDER BY d.title,s.location_number`).all(userId, scope, scope);
    const relations = db.prepare(`SELECT r.from_topic_id AS fromId,r.to_topic_id AS toId,r.relation_type AS type,r.document_id AS documentId,d.title AS source,r.evidence,r.confidence,r.source_location_type AS locationType,r.source_location_number AS locationNumber
        FROM topic_relations r JOIN documents d ON d.id=r.document_id AND d.user_id=r.owner_id
        WHERE r.owner_id=? AND (? IS NULL OR r.document_id=?)`).all(userId, scope, scope);
    const chunkRows = db.prepare("SELECT topic_id,document_id,chunk_index AS chunkIndex FROM chunk_topics WHERE user_id=? AND (? IS NULL OR document_id=?) ORDER BY document_id,chunk_index").all(userId, scope, scope);
    const sourcesByTopic = new Map();
    const chunksByTopic = new Map();
    for (const source of sourceRows) {
        const list = sourcesByTopic.get(source.topic_id) || [];
        list.push({ documentId: source.document_id, source: source.source, evidence: source.evidence, locationType: source.locationType, locationNumber: source.locationNumber });
        sourcesByTopic.set(source.topic_id, list);
    }
    for (const chunk of chunkRows) {
        const list = chunksByTopic.get(chunk.topic_id) || [];
        list.push({ documentId: chunk.document_id, chunkIndex: chunk.chunkIndex });
        chunksByTopic.set(chunk.topic_id, list);
    }
    return { topics: topics.map(topic => ({ ...topic, sources: sourcesByTopic.get(topic.id) || [], chunks: chunksByTopic.get(topic.id) || [] })), relations };
}
function deleteDocument(userId, id) {
    db.exec("BEGIN IMMEDIATE");
    try {
        const deleted = db.prepare("DELETE FROM documents WHERE user_id=? AND id=?").run(userId, id).changes > 0;
        db.prepare("DELETE FROM topics WHERE owner_id=? AND id NOT IN (SELECT topic_id FROM topic_sources UNION SELECT topic_id FROM chunk_topics)").run(userId);
        db.exec("COMMIT");
        return deleted;
    } catch (error) { db.exec("ROLLBACK"); throw error; }
}
function saveGeneratedQuiz(id, userId, questions, expiresAt) {
    const insertHistory = db.prepare("INSERT OR IGNORE INTO question_history(user_id,fingerprint,question_text,created_at) VALUES(?,?,?,?)");
    const insertSession = db.prepare("INSERT INTO quiz_sessions(id,user_id,questions_json,expires_at) VALUES(?,?,?,?)");
    db.exec("BEGIN IMMEDIATE");
    try {
        for (const question of questions) {
            if (insertHistory.run(userId, question.hash, String(question.question || ""), nowIso()).changes === 0) throw new Error("Duplicate question generated concurrently.");
        }
        insertSession.run(id, userId, JSON.stringify(questions), expiresAt);
        db.exec("COMMIT");
        return true;
    } catch (error) { db.exec("ROLLBACK"); if (error.message.includes("Duplicate question")) return false; throw error; }
}
function hasQuestionFingerprint(userId, fingerprint) {
    return Boolean(db.prepare("SELECT 1 FROM question_history WHERE user_id=? AND fingerprint=?").get(userId, fingerprint));
}
function recentQuestions(userId, limit = 100) {
    const safeLimit = Math.max(1, Math.min(100, Math.floor(Number(limit) || 100)));
    return db.prepare("SELECT question_text AS question FROM question_history WHERE user_id=? ORDER BY created_at DESC LIMIT ?")
        .all(userId, safeLimit).map(row => row.question).filter(Boolean);
}
function getQuizSession(id, userId) {
    db.prepare("DELETE FROM quiz_sessions WHERE expires_at<=?").run(Date.now());
    const row = db.prepare("SELECT questions_json AS questionsJson FROM quiz_sessions WHERE id=? AND user_id=? AND expires_at>?").get(id, userId, Date.now());
    return row ? JSON.parse(row.questionsJson) : null;
}
function deleteQuizSession(id, userId) { db.prepare("DELETE FROM quiz_sessions WHERE id=? AND user_id=?").run(id, userId); }
function recordAssessment({ id, userId, score, total, accuracy, topics, results, mode = "practice", possibleMisconceptions = [] }) {
    const insertAssessment = db.prepare("INSERT INTO assessments(id,user_id,score,total,accuracy,topics_json,results_json,diagnostics_json,mode,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)");
    const selectMastery = db.prepare("SELECT alpha,beta,attempts FROM mastery WHERE user_id=? AND topic=?");
    const upsertMastery = db.prepare(`INSERT INTO mastery(user_id,topic,alpha,beta,attempts,updated_at) VALUES(?,?,?,?,?,?)
        ON CONFLICT(user_id,topic) DO UPDATE SET alpha=excluded.alpha,beta=excluded.beta,attempts=excluded.attempts,updated_at=excluded.updated_at`);
    db.exec("BEGIN IMMEDIATE");
    try {
        insertAssessment.run(id, userId, score, total, accuracy, JSON.stringify(topics), JSON.stringify(results), JSON.stringify({ possibleMisconceptions }), mode, nowIso());
        for (const result of results) {
            const old = selectMastery.get(userId, result.topic) || { alpha: 1, beta: 1, attempts: 0 };
            upsertMastery.run(userId, result.topic, old.alpha + (result.correct ? 1 : 0), old.beta + (result.correct ? 0 : 1), old.attempts + 1, nowIso());
        }
        db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
}
function getMastery(userId) {
    return db.prepare("SELECT topic,alpha,beta,attempts,updated_at AS updatedAt FROM mastery WHERE user_id=? ORDER BY (alpha/(alpha+beta)) ASC").all(userId)
        .map(row => ({ ...row, mastery: Math.round(row.alpha / (row.alpha + row.beta) * 100) }));
}
function getProgress(userId) {
    const assessments = db.prepare("SELECT id,score,total,accuracy,mode,topics_json AS topicsJson,results_json AS resultsJson,diagnostics_json AS diagnosticsJson,created_at AS createdAt FROM assessments WHERE user_id=? ORDER BY created_at DESC LIMIT 50").all(userId)
        .map(row => ({ id: row.id, score: row.score, total: row.total, accuracy: row.accuracy, mode: row.mode, topics: JSON.parse(row.topicsJson), results: JSON.parse(row.resultsJson), possibleMisconceptions: JSON.parse(row.diagnosticsJson).possibleMisconceptions || [], createdAt: row.createdAt }));
    return { mastery: getMastery(userId), assessments };
}

module.exports = { db, createUser, findUserByEmail, saveSession, findSession, deleteSession, createDocument, listDocuments, getDocument, getSourceUnit, persistTaxonomy, getTopicMap, stableTopicId, deleteDocument, saveGeneratedQuiz, hasQuestionFingerprint, recentQuestions, getQuizSession, deleteQuizSession, recordAssessment, getMastery, getProgress };
