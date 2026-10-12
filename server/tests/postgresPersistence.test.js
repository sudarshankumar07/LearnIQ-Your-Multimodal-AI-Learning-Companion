const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID, createHash } = require("node:crypto");
const { TABLES, INDEXES, initPostgresSchema } = require("../services/postgresSchema");
const { PostgresStore, parseConnectionConfig } = require("../services/postgresStore");
const { readToken, readCookie, sessionHash } = require("../middleware/auth");
const { SqliteStore } = require("../services/sqliteStore");

test("PostgreSQL schema defines all required tables, constraints, and indexes", () => {
    const requiredTables = [
        "users",
        "sessions",
        "documents",
        "quiz_sessions",
        "question_history",
        "assessments",
        "mastery",
        "source_units",
        "topics",
        "topic_sources",
        "chunk_topics",
        "topic_relations"
    ];

    for (const table of requiredTables) {
        assert.ok(TABLES[table], `Table definition for ${table} must exist`);
        assert.match(TABLES[table], /CREATE TABLE IF NOT EXISTS/i);
    }

    assert.match(TABLES.users, /PRIMARY KEY \(id\)/);
    assert.match(TABLES.users, /UNIQUE \(email\)/);
    assert.match(TABLES.sessions, /FOREIGN KEY \(user_id\) REFERENCES users\(id\) ON DELETE CASCADE/);
    assert.match(TABLES.documents, /FOREIGN KEY \(user_id\) REFERENCES users\(id\) ON DELETE CASCADE/);
    assert.match(TABLES.quiz_sessions, /FOREIGN KEY \(user_id\) REFERENCES users\(id\) ON DELETE CASCADE/);
    assert.match(TABLES.question_history, /FOREIGN KEY \(user_id\) REFERENCES users\(id\) ON DELETE CASCADE/);
    assert.match(TABLES.assessments, /FOREIGN KEY \(user_id\) REFERENCES users\(id\) ON DELETE CASCADE/);
    assert.match(TABLES.mastery, /FOREIGN KEY \(user_id\) REFERENCES users\(id\) ON DELETE CASCADE/);
    assert.match(TABLES.source_units, /FOREIGN KEY \(user_id\) REFERENCES users\(id\) ON DELETE CASCADE/);
    assert.match(TABLES.topics, /FOREIGN KEY \(user_id\) REFERENCES users\(id\) ON DELETE CASCADE/);
    assert.match(TABLES.topic_sources, /FOREIGN KEY \(user_id\) REFERENCES users\(id\) ON DELETE CASCADE/);
    assert.match(TABLES.chunk_topics, /FOREIGN KEY \(user_id\) REFERENCES users\(id\) ON DELETE CASCADE/);
    assert.match(TABLES.topic_relations, /FOREIGN KEY \(user_id\) REFERENCES users\(id\) ON DELETE CASCADE/);

    assert.ok(INDEXES.length >= 8, "Expected at least 8 optimized indexes");
    for (const index of INDEXES) {
        assert.match(index, /CREATE INDEX IF NOT EXISTS/i);
    }
});

test("initPostgresSchema executes idempotent DDL within transactions", async () => {
    const queries = [];
    const mockClient = {
        async query(sql) {
            queries.push(sql);
            return { rows: [] };
        }
    };
    const mockPool = {
        async connect() {
            return {
                ...mockClient,
                release() { queries.push("RELEASE"); }
            };
        }
    };

    await initPostgresSchema(mockPool);
    assert.ok(queries.includes("BEGIN"));
    assert.ok(queries.includes("COMMIT"));
    assert.ok(queries.includes("RELEASE"));
    assert.ok(queries.some(q => q.includes("CREATE TABLE IF NOT EXISTS users")));
    assert.ok(queries.some(q => q.includes("CREATE TABLE IF NOT EXISTS topic_relations")));
});

test("parseConnectionConfig validates DATABASE_URL and configures TLS appropriately", () => {
    // Valid standard connection string
    const devConfig = parseConnectionConfig("postgresql://user:pass@localhost:5432/mydb", false);
    assert.equal(devConfig.connectionString, "postgresql://user:pass@localhost:5432/mydb");
    assert.equal(devConfig.max, 10);
    assert.equal(devConfig.ssl, false);

    // Production connection string with remote host enforces SSL
    const prodConfig = parseConnectionConfig("postgresql://user:pass@dpg-abc123.oregon-postgres.render.com:5432/dbname", true);
    assert.equal(prodConfig.ssl.rejectUnauthorized, false);

    // Invalid connection strings fail fast
    assert.throws(() => parseConnectionConfig("", false), /DATABASE_URL is required/);
    assert.throws(() => parseConnectionConfig("   ", true), /DATABASE_URL is required/);
    assert.throws(() => parseConnectionConfig("not-a-valid-connection-string", false), /must begin with postgresql:\/\/ or postgres:\/\//);
});

test("PostgresStore fails fast in production when DATABASE_URL is missing", () => {
    const origEnv = process.env.NODE_ENV;
    const origUrl = process.env.DATABASE_URL;
    try {
        process.env.NODE_ENV = "production";
        delete process.env.DATABASE_URL;

        assert.throws(() => {
            new PostgresStore({});
        }, /DATABASE_URL is required in production/);
    } finally {
        process.env.NODE_ENV = origEnv;
        if (origUrl !== undefined) process.env.DATABASE_URL = origUrl;
        else delete process.env.DATABASE_URL;
    }
});

test("PostgresStore transaction rolls back on error in multi-step operations", async () => {
    const executed = [];
    let shouldFail = false;

    const mockClient = {
        async query(sql, params) {
            executed.push({ sql: sql.trim(), params });
            if (shouldFail && sql.includes("UPDATE mastery")) {
                const err = new Error("simulated database failure");
                err.code = "40001";
                throw err;
            }
            return { rows: [], rowCount: 1 };
        },
        release() {
            executed.push({ sql: "RELEASE" });
        }
    };

    const mockPool = {
        async connect() {
            return mockClient;
        },
        async query(sql, params) {
            return mockClient.query(sql, params);
        },
        on() {},
        async end() {}
    };

    const store = new PostgresStore({ pool: mockPool, isProduction: false });

    // Multi-step operation: recordAssessment
    shouldFail = true;
    await assert.rejects(
        async () => {
            await store.recordAssessment({
                id: randomUUID(),
                userId: randomUUID(),
                score: 1,
                total: 1,
                accuracy: 100,
                topics: [],
                results: [{ topic: "Calculus", correct: true }]
            });
        },
        /simulated database failure/
    );

    const sqlCommands = executed.map(e => e.sql);
    assert.ok(sqlCommands.includes("BEGIN"), "Transaction should have started");
    assert.ok(sqlCommands.includes("ROLLBACK"), "Transaction should have rolled back on error");
    assert.ok(!sqlCommands.includes("COMMIT"), "Failed transaction should not commit");
    assert.ok(sqlCommands.includes("RELEASE"), "Client should be released after rollback");
});

test("readToken resolves authentication from both cookie and Bearer Authorization header", () => {
    const validToken = "a".repeat(64);

    // 1. Cookie resolution
    const reqWithCookie = {
        headers: {
            cookie: `other=123; learniq_session=${validToken}; pref=dark`
        }
    };
    assert.equal(readToken(reqWithCookie), validToken);

    // 2. Bearer token resolution
    const reqWithBearer = {
        headers: {
            authorization: `Bearer ${validToken}`
        }
    };
    assert.equal(readToken(reqWithBearer), validToken);

    // 3. Fallback: if cookie is absent, Bearer is used
    const reqWithBoth = {
        headers: {
            cookie: "other=123",
            authorization: `Bearer ${validToken}`
        }
    };
    assert.equal(readToken(reqWithBoth), validToken);

    // 4. Invalid token formats are rejected
    assert.equal(readToken({ headers: { authorization: "Bearer invalid" } }), null);
    assert.equal(readToken({ headers: { cookie: "learniq_session=short" } }), null);
    assert.equal(readToken({ headers: {} }), null);
});

test("SqliteStore and PostgresStore expose identical synchronous/asynchronous public method contracts", () => {
    const sqliteStore = new SqliteStore({ dbPath: ":memory:" });
    const mockPool = {
        async connect() { return { query: async () => ({ rows: [] }), release() {} }; },
        async query() { return { rows: [] }; },
        on() {},
        async end() {}
    };
    const postgresStore = new PostgresStore({ pool: mockPool, isProduction: false });

    const expectedMethods = [
        "createUser",
        "findUserByEmail",
        "findUserById",
        "createSession",
        "findSession",
        "deleteSessionByHash",
        "deleteUserSessions",
        "createDocument",
        "listDocuments",
        "getDocument",
        "deleteDocument",
        "saveGeneratedQuiz",
        "getQuizSession",
        "deleteQuizSession",
        "hasQuestionFingerprint",
        "recentQuestions",
        "recordAssessment",
        "getProgress",
        "getMastery",
        "persistTaxonomy",
        "initDatabase",
        "closeDatabase"
    ];

    for (const method of expectedMethods) {
        assert.equal(typeof sqliteStore[method], "function", `SqliteStore must have method ${method}`);
        assert.equal(typeof postgresStore[method], "function", `PostgresStore must have method ${method}`);
    }

    sqliteStore.closeDatabase();
});

