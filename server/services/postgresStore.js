const { Pool } = require("pg");
const fs = require("fs");
const { createHash } = require("crypto");
const { initPostgresSchema } = require("./postgresSchema");

function topicKey(name) {
    return String(name).normalize("NFKC").trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function stableTopicId(userId, name) {
    return `topic-${createHash("sha256").update(`${userId}\0${topicKey(name)}`).digest("hex").slice(0, 32)}`;
}

function topicSlug(name) { return topicKey(name); }

function getPoolConfig(databaseUrl) {
    const config = {
        connectionString: databaseUrl,
        max: Number(process.env.PG_MAX_CONNECTIONS) || 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000
    };

    try {
        const url = new URL(databaseUrl.replace(/^postgres:/i, "postgresql:"));
        const sslMode = url.searchParams.get("sslmode");
        if (sslMode === "disable") {
            config.ssl = false;
        } else if (process.env.PGSSLROOTCERT && fs.existsSync(process.env.PGSSLROOTCERT)) {
            config.ssl = { ca: fs.readFileSync(process.env.PGSSLROOTCERT, "utf8") };
        } else if (process.env.DATABASE_SSL_NO_VERIFY === "true" || sslMode === "no-verify") {
            config.ssl = { rejectUnauthorized: false };
        } else if (process.env.NODE_ENV === "production" || sslMode === "require") {
            config.ssl = { rejectUnauthorized: false };
        }
    } catch {
        if (process.env.NODE_ENV === "production") {
            config.ssl = { rejectUnauthorized: false };
        }
    }
    return config;
}

class PostgresStore {
    constructor(databaseUrl = process.env.DATABASE_URL) {
        if (!databaseUrl) {
            throw new Error("PostgresStore requires a connection string.");
        }
        this.databaseUrl = databaseUrl;
        this.pool = new Pool(getPoolConfig(databaseUrl));
        this.pool.on("error", (err) => {
            console.error("Unexpected error on idle PostgreSQL client:", err.message);
        });
        this._initialized = false;
    }

    async init() {
        if (this._initialized) return;
        const client = await this.pool.connect();
        try {
            await initPostgresSchema(client);
            this._initialized = true;
        } finally {
            client.release();
        }
    }

    async close() {
        await this.pool.end();
    }

    nowIso() {
        return new Date().toISOString();
    }

    async createUser({ id, email, salt, passwordHash }) {
        await this.pool.query(
            "INSERT INTO users(id, email, password_salt, password_hash, created_at) VALUES($1, $2, $3, $4, $5)",
            [id, email, salt, passwordHash, this.nowIso()]
        );
    }

    async findUserByEmail(email) {
        const res = await this.pool.query(
            "SELECT id, email, password_salt AS salt, password_hash AS \"passwordHash\" FROM users WHERE email = $1",
            [email]
        );
        return res.rows[0] || undefined;
    }

    async saveSession(tokenHash, userId, expiresAt) {
        await this.pool.query(
            "INSERT INTO sessions(token_hash, user_id, expires_at) VALUES($1, $2, $3)",
            [tokenHash, userId, expiresAt]
        );
    }

    async findSession(tokenHash) {
        const now = Date.now();
        await this.pool.query("DELETE FROM sessions WHERE expires_at <= $1", [now]);
        const res = await this.pool.query(
            `SELECT u.id, u.email
             FROM sessions s
             JOIN users u ON u.id = s.user_id
             WHERE s.token_hash = $1 AND s.expires_at > $2`,
            [tokenHash, now]
        );
        return res.rows[0] || undefined;
    }

    async deleteSession(tokenHash) {
        await this.pool.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash]);
    }

    async deleteUserSessions(userId) {
        await this.pool.query("DELETE FROM sessions WHERE user_id = $1", [userId]);
    }

    async createDocument({ id, userId, title, storagePath, pages, sourceType = "pdf", sourceUnits = [] }) {
        const client = await this.pool.connect();
        try {
            await client.query("BEGIN");
            await client.query(
                "INSERT INTO documents(id, user_id, title, storage_path, pages, source_type, created_at) VALUES($1, $2, $3, $4, $5, $6, $7)",
                [id, userId, title, storagePath, pages, sourceType, this.nowIso()]
            );
            for (const unit of sourceUnits) {
                await client.query(
                    "INSERT INTO source_units(document_id, user_id, location_type, location_number, content) VALUES($1, $2, $3, $4, $5)",
                    [id, userId, unit.locationType, unit.locationNumber, unit.content]
                );
            }
            await client.query("COMMIT");
        } catch (error) {
            await client.query("ROLLBACK");
            throw error;
        } finally {
            client.release();
        }
    }

    async listDocuments(userId) {
        const res = await this.pool.query(
            "SELECT id, title AS name, pages, source_type AS \"sourceType\", created_at AS \"createdAt\" FROM documents WHERE user_id = $1 ORDER BY created_at DESC",
            [userId]
        );
        return res.rows.map(row => ({
            id: row.id,
            name: row.name,
            pages: Number(row.pages),
            sourceType: row.sourceType,
            createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt
        }));
    }

    async getDocument(userId, id) {
        const res = await this.pool.query(
            "SELECT id, title, storage_path AS \"storagePath\", pages, source_type AS \"sourceType\" FROM documents WHERE user_id = $1 AND id = $2",
            [userId, id]
        );
        const row = res.rows[0];
        if (!row) return undefined;
        return {
            id: row.id,
            title: row.title,
            storagePath: row.storagePath,
            pages: Number(row.pages),
            sourceType: row.sourceType
        };
    }

    async getSourceUnit(userId, documentId, locationType, locationNumber) {
        const res = await this.pool.query(
            "SELECT content FROM source_units WHERE user_id = $1 AND document_id = $2 AND location_type = $3 AND location_number = $4",
            [userId, documentId, locationType, locationNumber]
        );
        return res.rows[0] || undefined;
    }

    async persistTaxonomy(userId, documentId, taxonomy) {
        const docRes = await this.pool.query(
            "SELECT id, pages FROM documents WHERE user_id = $1 AND id = $2",
            [userId, documentId]
        );
        const document = docRes.rows[0];
        if (!document) throw new Error("Document is not owned by this user.");

        const names = new Map((taxonomy?.topics || []).map(topic => [topicKey(topic.name), topic]));
        const idByName = new Map([...names].map(([key, topic]) => [key, stableTopicId(userId, topic.name)]));

        const findSourceLocation = location => {
            if (location?.locationType === "time") return Number.isFinite(location.locationNumber) && location.locationNumber >= 0;
            return Number.isInteger(location?.locationNumber) && location.locationNumber >= 1 && location.locationNumber <= Number(document.pages);
        };

        const client = await this.pool.connect();
        try {
            await client.query("BEGIN");
            await client.query("DELETE FROM topic_sources WHERE document_id = $1 AND user_id = $2", [documentId, userId]);
            await client.query("DELETE FROM chunk_topics WHERE document_id = $1 AND user_id = $2", [documentId, userId]);
            await client.query("DELETE FROM topic_relations WHERE document_id = $1 AND owner_id = $2", [documentId, userId]);

            for (const [key, topic] of names) {
                const id = idByName.get(key);
                const kind = ["topic", "subtopic", "concept"].includes(topic.kind) ? topic.kind : "topic";
                await client.query(
                    `INSERT INTO topics(id, owner_id, slug, name, description, kind)
                     VALUES($1, $2, $3, $4, $5, $6)
                     ON CONFLICT(owner_id, slug) DO UPDATE
                     SET name = EXCLUDED.name, description = EXCLUDED.description, kind = EXCLUDED.kind`,
                    [id, userId, topicSlug(topic.name), String(topic.name).trim().slice(0, 120), String(topic.description || "").trim().slice(0, 500), kind]
                );

                for (const source of topic.sources || []) {
                    if (!findSourceLocation(source) || typeof source.evidence !== "string" || !source.evidence.trim()) continue;
                    await client.query(
                        `INSERT INTO topic_sources(document_id, user_id, topic_id, evidence, location_type, location_number)
                         VALUES($1, $2, $3, $4, $5, $6)
                         ON CONFLICT DO NOTHING`,
                        [documentId, userId, id, source.evidence.slice(0, 500), source.locationType, source.locationNumber]
                    );
                }

                for (const index of new Set(topic.chunkIndexes || [])) {
                    if (Number.isInteger(index) && index >= 0) {
                        await client.query(
                            `INSERT INTO chunk_topics(document_id, user_id, chunk_index, topic_id)
                             VALUES($1, $2, $3, $4)
                             ON CONFLICT DO NOTHING`,
                            [documentId, userId, index, id]
                        );
                    }
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

            const existingRelations = (await client.query("SELECT from_topic_id AS \"fromId\", to_topic_id AS \"toId\" FROM topic_relations WHERE owner_id = $1", [userId])).rows;
            const adjacency = new Map();
            for (const relation of existingRelations) {
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

                await client.query(
                    `INSERT INTO topic_relations(owner_id, from_topic_id, to_topic_id, relation_type, document_id, evidence, confidence, source_location_type, source_location_number)
                     VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9)
                     ON CONFLICT DO NOTHING`,
                    [userId, edge.fromId, edge.toId, edge.type, documentId, edge.evidence, edge.confidence, edge.locationType, edge.locationNumber]
                );
                const children = adjacency.get(edge.fromId) || [];
                children.push(edge.toId);
                adjacency.set(edge.fromId, children);
            }

            await client.query(
                "DELETE FROM topics WHERE owner_id = $1 AND id NOT IN (SELECT topic_id FROM topic_sources UNION SELECT topic_id FROM chunk_topics)",
                [userId]
            );
            await client.query("COMMIT");
        } catch (error) {
            await client.query("ROLLBACK");
            throw error;
        } finally {
            client.release();
        }
    }

    async getTopicMap(userId, documentId) {
        const scope = documentId || null;
        const topics = (await this.pool.query(
            `SELECT DISTINCT t.id, t.name, t.description, t.kind
             FROM topics t
             JOIN topic_sources s ON s.user_id = t.owner_id AND s.topic_id = t.id
             WHERE t.owner_id = $1 AND ($2::text IS NULL OR s.document_id = $2::text)
             ORDER BY t.name`,
            [userId, scope]
        )).rows;

        const sourceRows = (await this.pool.query(
            `SELECT s.topic_id, s.document_id, d.title AS source, s.evidence, s.location_type AS "locationType", s.location_number AS "locationNumber"
             FROM topic_sources s
             JOIN documents d ON d.id = s.document_id AND d.user_id = s.user_id
             WHERE s.user_id = $1 AND ($2::text IS NULL OR s.document_id = $2::text)
             ORDER BY d.title, s.location_number`,
            [userId, scope]
        )).rows;

        const relations = (await this.pool.query(
            `SELECT r.from_topic_id AS "fromId", r.to_topic_id AS "toId", r.relation_type AS type, r.document_id AS "documentId", d.title AS source, r.evidence, r.confidence, r.source_location_type AS "locationType", r.source_location_number AS "locationNumber"
             FROM topic_relations r
             JOIN documents d ON d.id = r.document_id AND d.user_id = r.owner_id
             WHERE r.owner_id = $1 AND ($2::text IS NULL OR r.document_id = $2::text)`,
            [userId, scope]
        )).rows;

        const chunkRows = (await this.pool.query(
            `SELECT topic_id, document_id, chunk_index AS "chunkIndex"
             FROM chunk_topics
             WHERE user_id = $1 AND ($2::text IS NULL OR document_id = $2::text)
             ORDER BY document_id, chunk_index`,
            [userId, scope]
        )).rows;

        const sourcesByTopic = new Map();
        const chunksByTopic = new Map();
        for (const source of sourceRows) {
            const list = sourcesByTopic.get(source.topic_id) || [];
            list.push({ documentId: source.document_id, source: source.source, evidence: source.evidence, locationType: source.locationType, locationNumber: Number(source.locationNumber) });
            sourcesByTopic.set(source.topic_id, list);
        }
        for (const chunk of chunkRows) {
            const list = chunksByTopic.get(chunk.topic_id) || [];
            list.push({ documentId: chunk.document_id, chunkIndex: Number(chunk.chunkIndex) });
            chunksByTopic.set(chunk.topic_id, list);
        }

        return {
            topics: topics.map(topic => ({
                id: topic.id,
                name: topic.name,
                description: topic.description,
                kind: topic.kind,
                sources: sourcesByTopic.get(topic.id) || [],
                chunks: chunksByTopic.get(topic.id) || []
            })),
            relations: relations.map(r => ({
                ...r,
                confidence: Number(r.confidence),
                locationNumber: Number(r.locationNumber)
            }))
        };
    }

    async deleteDocument(userId, id) {
        const client = await this.pool.connect();
        try {
            await client.query("BEGIN");
            const res = await client.query("DELETE FROM documents WHERE user_id = $1 AND id = $2 RETURNING id", [userId, id]);
            await client.query(
                "DELETE FROM topics WHERE owner_id = $1 AND id NOT IN (SELECT topic_id FROM topic_sources UNION SELECT topic_id FROM chunk_topics)",
                [userId]
            );
            await client.query("COMMIT");
            return res.rowCount > 0;
        } catch (error) {
            await client.query("ROLLBACK");
            throw error;
        } finally {
            client.release();
        }
    }

    async saveGeneratedQuiz(id, userId, questions, expiresAt) {
        const client = await this.pool.connect();
        try {
            await client.query("BEGIN");
            for (const question of questions) {
                const res = await client.query(
                    `INSERT INTO question_history(user_id, fingerprint, question_text, created_at)
                     VALUES($1, $2, $3, $4)
                     ON CONFLICT(user_id, fingerprint) DO NOTHING
                     RETURNING fingerprint`,
                    [userId, question.hash, String(question.question || ""), this.nowIso()]
                );
                if (res.rowCount === 0) {
                    throw new Error("Duplicate question generated concurrently.");
                }
            }
            await client.query(
                "INSERT INTO quiz_sessions(id, user_id, questions_json, expires_at) VALUES($1, $2, $3, $4)",
                [id, userId, JSON.stringify(questions), expiresAt]
            );
            await client.query("COMMIT");
            return true;
        } catch (error) {
            await client.query("ROLLBACK");
            if (error.message.includes("Duplicate question")) return false;
            throw error;
        } finally {
            client.release();
        }
    }

    async hasQuestionFingerprint(userId, fingerprint) {
        const res = await this.pool.query(
            "SELECT 1 FROM question_history WHERE user_id = $1 AND fingerprint = $2",
            [userId, fingerprint]
        );
        return res.rowCount > 0;
    }

    async recentQuestions(userId, limit = 100) {
        const safeLimit = Math.max(1, Math.min(100, Math.floor(Number(limit) || 100)));
        const res = await this.pool.query(
            "SELECT question_text AS question FROM question_history WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2",
            [userId, safeLimit]
        );
        return res.rows.map(row => row.question).filter(Boolean);
    }

    async getQuizSession(id, userId) {
        const now = Date.now();
        await this.pool.query("DELETE FROM quiz_sessions WHERE expires_at <= $1", [now]);
        const res = await this.pool.query(
            "SELECT questions_json AS \"questionsJson\" FROM quiz_sessions WHERE id = $1 AND user_id = $2 AND expires_at > $3",
            [id, userId, now]
        );
        return res.rows[0] ? JSON.parse(res.rows[0].questionsJson) : null;
    }

    async deleteQuizSession(id, userId) {
        await this.pool.query("DELETE FROM quiz_sessions WHERE id = $1 AND user_id = $2", [id, userId]);
    }

    async recordAssessment({ id, userId, score, total, accuracy, topics, results, mode = "practice", possibleMisconceptions = [] }) {
        const client = await this.pool.connect();
        try {
            await client.query("BEGIN");
            await client.query(
                "INSERT INTO assessments(id, user_id, score, total, accuracy, topics_json, results_json, diagnostics_json, mode, created_at) VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
                [id, userId, score, total, accuracy, JSON.stringify(topics), JSON.stringify(results), JSON.stringify({ possibleMisconceptions }), mode, this.nowIso()]
            );
            for (const result of results) {
                const oldRes = await client.query("SELECT alpha, beta, attempts FROM mastery WHERE user_id = $1 AND topic = $2", [userId, result.topic]);
                const old = oldRes.rows[0] ? { alpha: Number(oldRes.rows[0].alpha), beta: Number(oldRes.rows[0].beta), attempts: Number(oldRes.rows[0].attempts) } : { alpha: 1, beta: 1, attempts: 0 };
                const newAlpha = old.alpha + (result.correct ? 1 : 0);
                const newBeta = old.beta + (result.correct ? 0 : 1);
                const newAttempts = old.attempts + 1;
                await client.query(
                    `INSERT INTO mastery(user_id, topic, alpha, beta, attempts, updated_at)
                     VALUES($1, $2, $3, $4, $5, $6)
                     ON CONFLICT(user_id, topic) DO UPDATE
                     SET alpha = EXCLUDED.alpha, beta = EXCLUDED.beta, attempts = EXCLUDED.attempts, updated_at = EXCLUDED.updated_at`,
                    [userId, result.topic, newAlpha, newBeta, newAttempts, this.nowIso()]
                );
            }
            await client.query("COMMIT");
        } catch (error) {
            await client.query("ROLLBACK");
            throw error;
        } finally {
            client.release();
        }
    }

    async getMastery(userId) {
        const res = await this.pool.query(
            "SELECT topic, alpha, beta, attempts, updated_at AS \"updatedAt\" FROM mastery WHERE user_id = $1 ORDER BY (alpha / (alpha + beta)) ASC",
            [userId]
        );
        return res.rows.map(row => {
            const alpha = Number(row.alpha);
            const beta = Number(row.beta);
            return {
                topic: row.topic,
                alpha,
                beta,
                attempts: Number(row.attempts),
                updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
                mastery: Math.round(alpha / (alpha + beta) * 100)
            };
        });
    }

    async getProgress(userId) {
        const res = await this.pool.query(
            "SELECT id, score, total, accuracy, mode, topics_json AS \"topicsJson\", results_json AS \"resultsJson\", diagnostics_json AS \"diagnosticsJson\", created_at AS \"createdAt\" FROM assessments WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50",
            [userId]
        );
        const assessments = res.rows.map(row => ({
            id: row.id,
            score: Number(row.score),
            total: Number(row.total),
            accuracy: Number(row.accuracy),
            mode: row.mode,
            topics: JSON.parse(row.topicsJson),
            results: JSON.parse(row.resultsJson),
            possibleMisconceptions: JSON.parse(row.diagnosticsJson).possibleMisconceptions || [],
            createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt
        }));
        return { mastery: await this.getMastery(userId), assessments };
    }
}

module.exports = { PostgresStore, stableTopicId };

