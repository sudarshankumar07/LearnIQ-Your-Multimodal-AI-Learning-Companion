#!/usr/bin/env node
const path = require("path");
const fs = require("fs");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { DatabaseSync } = require("node:sqlite");
const { Pool } = require("pg");
const { initPostgresSchema } = require("../services/postgresSchema");

async function migrate() {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl || (!databaseUrl.startsWith("postgres://") && !databaseUrl.startsWith("postgresql://"))) {
        console.error("Migration error: DATABASE_URL must be configured with a valid PostgreSQL connection string.");
        process.exit(1);
    }

    const dataDir = process.env.LEARNIQ_DATA_DIR || path.join(__dirname, "..", "data");
    const sqlitePath = process.env.LEARNIQ_DB_PATH || path.join(dataDir, "learniq.sqlite");

    const pool = new Pool({
        connectionString: databaseUrl,
        ssl: process.env.NODE_ENV === "production" || databaseUrl.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined
    });

    try {
        console.log("Initializing PostgreSQL schema if not present...");
        const client = await pool.connect();
        try {
            await initPostgresSchema(client);
        } finally {
            client.release();
        }
        console.log("PostgreSQL schema is ready.");

        if (!fs.existsSync(sqlitePath)) {
            console.log(`No SQLite database found at: ${sqlitePath}`);
            console.log("PostgreSQL schema initialized successfully. Nothing to migrate.");
            await pool.end();
            return;
        }

        console.log(`Opening SQLite database in read-only mode from: ${sqlitePath}`);
        const sqlite = new DatabaseSync(sqlitePath, { readOnly: true });

        const pgClient = await pool.connect();
        try {
            await pgClient.query("BEGIN");
            const counts = {};

            // 1. Users
            try {
                const users = sqlite.prepare("SELECT id, email, password_salt, password_hash, created_at FROM users").all();
                let userCount = 0;
                for (const u of users) {
                    const res = await pgClient.query(
                        `INSERT INTO users(id, email, password_salt, password_hash, created_at)
                         VALUES($1, $2, $3, $4, $5)
                         ON CONFLICT(id) DO NOTHING`,
                        [u.id, u.email, u.password_salt, u.password_hash, u.created_at]
                    );
                    if (res.rowCount > 0) userCount++;
                }
                counts.users = userCount;
            } catch (err) {
                if (!err.message.includes("no such table")) throw err;
                counts.users = 0;
            }

            // 2. Sessions
            try {
                const sessions = sqlite.prepare("SELECT token_hash, user_id, expires_at FROM sessions").all();
                let sessionCount = 0;
                for (const s of sessions) {
                    const res = await pgClient.query(
                        `INSERT INTO sessions(token_hash, user_id, expires_at)
                         VALUES($1, $2, $3)
                         ON CONFLICT(token_hash) DO NOTHING`,
                        [s.token_hash, s.user_id, Number(s.expires_at)]
                    );
                    if (res.rowCount > 0) sessionCount++;
                }
                counts.sessions = sessionCount;
            } catch (err) {
                if (!err.message.includes("no such table")) throw err;
                counts.sessions = 0;
            }

            // 3. Documents
            try {
                const documents = sqlite.prepare("SELECT id, user_id, title, storage_path, pages, source_type, created_at FROM documents").all();
                let docCount = 0;
                for (const d of documents) {
                    const res = await pgClient.query(
                        `INSERT INTO documents(id, user_id, title, storage_path, pages, source_type, created_at)
                         VALUES($1, $2, $3, $4, $5, $6, $7)
                         ON CONFLICT(id) DO NOTHING`,
                        [d.id, d.user_id, d.title, d.storage_path, Number(d.pages), d.source_type || "pdf", d.created_at]
                    );
                    if (res.rowCount > 0) docCount++;
                }
                counts.documents = docCount;
            } catch (err) {
                if (!err.message.includes("no such table")) throw err;
                counts.documents = 0;
            }

            // 4. Quiz sessions
            try {
                const quizSessions = sqlite.prepare("SELECT id, user_id, questions_json, expires_at FROM quiz_sessions").all();
                let quizCount = 0;
                for (const q of quizSessions) {
                    const res = await pgClient.query(
                        `INSERT INTO quiz_sessions(id, user_id, questions_json, expires_at)
                         VALUES($1, $2, $3, $4)
                         ON CONFLICT(id) DO NOTHING`,
                        [q.id, q.user_id, q.questions_json, Number(q.expires_at)]
                    );
                    if (res.rowCount > 0) quizCount++;
                }
                counts.quiz_sessions = quizCount;
            } catch (err) {
                if (!err.message.includes("no such table")) throw err;
                counts.quiz_sessions = 0;
            }

            // 5. Question history
            try {
                const history = sqlite.prepare("SELECT user_id, fingerprint, question_text, created_at FROM question_history").all();
                let histCount = 0;
                for (const h of history) {
                    const res = await pgClient.query(
                        `INSERT INTO question_history(user_id, fingerprint, question_text, created_at)
                         VALUES($1, $2, $3, $4)
                         ON CONFLICT(user_id, fingerprint) DO NOTHING`,
                        [h.user_id, h.fingerprint, h.question_text || "", h.created_at]
                    );
                    if (res.rowCount > 0) histCount++;
                }
                counts.question_history = histCount;
            } catch (err) {
                if (!err.message.includes("no such table")) throw err;
                counts.question_history = 0;
            }

            // 6. Assessments
            try {
                const assessments = sqlite.prepare("SELECT id, user_id, score, total, accuracy, topics_json, results_json, diagnostics_json, mode, created_at FROM assessments").all();
                let assessCount = 0;
                for (const a of assessments) {
                    const res = await pgClient.query(
                        `INSERT INTO assessments(id, user_id, score, total, accuracy, topics_json, results_json, diagnostics_json, mode, created_at)
                         VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                         ON CONFLICT(id) DO NOTHING`,
                        [a.id, a.user_id, Number(a.score), Number(a.total), Number(a.accuracy), a.topics_json, a.results_json, a.diagnostics_json || "{}", a.mode || "practice", a.created_at]
                    );
                    if (res.rowCount > 0) assessCount++;
                }
                counts.assessments = assessCount;
            } catch (err) {
                if (!err.message.includes("no such table")) throw err;
                counts.assessments = 0;
            }

            // 7. Mastery
            try {
                const mastery = sqlite.prepare("SELECT user_id, topic, alpha, beta, attempts, updated_at FROM mastery").all();
                let mastCount = 0;
                for (const m of mastery) {
                    const res = await pgClient.query(
                        `INSERT INTO mastery(user_id, topic, alpha, beta, attempts, updated_at)
                         VALUES($1, $2, $3, $4, $5, $6)
                         ON CONFLICT(user_id, topic) DO NOTHING`,
                        [m.user_id, m.topic, Number(m.alpha), Number(m.beta), Number(m.attempts), m.updated_at]
                    );
                    if (res.rowCount > 0) mastCount++;
                }
                counts.mastery = mastCount;
            } catch (err) {
                if (!err.message.includes("no such table")) throw err;
                counts.mastery = 0;
            }

            // 8. Source units
            try {
                const units = sqlite.prepare("SELECT document_id, user_id, location_type, location_number, content FROM source_units").all();
                let unitCount = 0;
                for (const u of units) {
                    const res = await pgClient.query(
                        `INSERT INTO source_units(document_id, user_id, location_type, location_number, content)
                         VALUES($1, $2, $3, $4, $5)
                         ON CONFLICT(document_id, location_type, location_number) DO NOTHING`,
                        [u.document_id, u.user_id, u.location_type, Number(u.location_number), u.content]
                    );
                    if (res.rowCount > 0) unitCount++;
                }
                counts.source_units = unitCount;
            } catch (err) {
                if (!err.message.includes("no such table")) throw err;
                counts.source_units = 0;
            }

            // 9. Topics
            try {
                const topics = sqlite.prepare("SELECT id, owner_id, slug, name, description, kind FROM topics").all();
                let topicCount = 0;
                for (const t of topics) {
                    const res = await pgClient.query(
                        `INSERT INTO topics(id, owner_id, slug, name, description, kind)
                         VALUES($1, $2, $3, $4, $5, $6)
                         ON CONFLICT(id) DO NOTHING`,
                        [t.id, t.owner_id, t.slug, t.name, t.description || "", t.kind]
                    );
                    if (res.rowCount > 0) topicCount++;
                }
                counts.topics = topicCount;
            } catch (err) {
                if (!err.message.includes("no such table")) throw err;
                counts.topics = 0;
            }

            // 10. Topic sources
            try {
                const topicSources = sqlite.prepare("SELECT document_id, user_id, topic_id, evidence, location_type, location_number FROM topic_sources").all();
                let tsCount = 0;
                for (const ts of topicSources) {
                    const res = await pgClient.query(
                        `INSERT INTO topic_sources(document_id, user_id, topic_id, evidence, location_type, location_number)
                         VALUES($1, $2, $3, $4, $5, $6)
                         ON CONFLICT(document_id, topic_id, location_type, location_number) DO NOTHING`,
                        [ts.document_id, ts.user_id, ts.topic_id, ts.evidence, ts.location_type, Number(ts.location_number)]
                    );
                    if (res.rowCount > 0) tsCount++;
                }
                counts.topic_sources = tsCount;
            } catch (err) {
                if (!err.message.includes("no such table")) throw err;
                counts.topic_sources = 0;
            }

            // 11. Chunk topics
            try {
                const chunkTopics = sqlite.prepare("SELECT document_id, user_id, chunk_index, topic_id FROM chunk_topics").all();
                let ctCount = 0;
                for (const ct of chunkTopics) {
                    const res = await pgClient.query(
                        `INSERT INTO chunk_topics(document_id, user_id, chunk_index, topic_id)
                         VALUES($1, $2, $3, $4)
                         ON CONFLICT(document_id, chunk_index, topic_id) DO NOTHING`,
                        [ct.document_id, ct.user_id, Number(ct.chunk_index), ct.topic_id]
                    );
                    if (res.rowCount > 0) ctCount++;
                }
                counts.chunk_topics = ctCount;
            } catch (err) {
                if (!err.message.includes("no such table")) throw err;
                counts.chunk_topics = 0;
            }

            // 12. Topic relations
            try {
                const relations = sqlite.prepare("SELECT owner_id, from_topic_id, to_topic_id, relation_type, document_id, evidence, confidence, source_location_type, source_location_number FROM topic_relations").all();
                let relCount = 0;
                for (const r of relations) {
                    const res = await pgClient.query(
                        `INSERT INTO topic_relations(owner_id, from_topic_id, to_topic_id, relation_type, document_id, evidence, confidence, source_location_type, source_location_number)
                         VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9)
                         ON CONFLICT(owner_id, from_topic_id, to_topic_id, relation_type, document_id) DO NOTHING`,
                        [r.owner_id, r.from_topic_id, r.to_topic_id, r.relation_type, r.document_id, r.evidence, Number(r.confidence), r.source_location_type || "page", Number(r.source_location_number || 1)]
                    );
                    if (res.rowCount > 0) relCount++;
                }
                counts.topic_relations = relCount;
            } catch (err) {
                if (!err.message.includes("no such table")) throw err;
                counts.topic_relations = 0;
            }

            await pgClient.query("COMMIT");
            console.log("Migration completed successfully. Rows copied to PostgreSQL:");
            for (const [table, count] of Object.entries(counts)) {
                console.log(`  - ${table}: ${count} rows`);
            }
        } catch (err) {
            await pgClient.query("ROLLBACK");
            console.error("Migration failed; transaction rolled back. Error:", err.message);
            process.exit(1);
        } finally {
            pgClient.release();
        }
    } finally {
        await pool.end();
    }
}

if (require.main === module) {
    migrate().catch(err => {
        console.error("Migration failed:", err.message);
        process.exit(1);
    });
}

module.exports = { migrate };

