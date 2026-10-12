const { PostgresStore, stableTopicId } = require("./postgresStore");
const { SqliteStore } = require("./sqliteStore");

function resolveStore() {
    const isProd = process.env.NODE_ENV === "production";
    const rawDbUrl = process.env.DATABASE_URL;
    const isPostgresUrl = typeof rawDbUrl === "string" && (rawDbUrl.startsWith("postgres://") || rawDbUrl.startsWith("postgresql://"));

    if (isProd && !isPostgresUrl) {
        throw new Error("DATABASE_URL is not configured. A valid PostgreSQL connection string is required in production.");
    }

    if (isPostgresUrl) {
        return new PostgresStore(rawDbUrl);
    }
    return new SqliteStore();
}

let activeStore = resolveStore();

module.exports = {
    get db() { return activeStore.db; },
    get pool() { return activeStore.pool; },
    isPostgresActive: () => activeStore instanceof PostgresStore,
    initDatabase: () => activeStore.init(),
    closeDatabase: () => activeStore.close(),
    _setStore: (store) => { activeStore = store; },
    _resetStore: () => { activeStore = resolveStore(); },

    stableTopicId,
    createUser: (...args) => activeStore.createUser(...args),
    findUserByEmail: (...args) => activeStore.findUserByEmail(...args),
    saveSession: (...args) => activeStore.saveSession(...args),
    findSession: (...args) => activeStore.findSession(...args),
    deleteSession: (...args) => activeStore.deleteSession(...args),
    deleteUserSessions: (...args) => activeStore.deleteUserSessions ? activeStore.deleteUserSessions(...args) : undefined,
    createDocument: (...args) => activeStore.createDocument(...args),
    listDocuments: (...args) => activeStore.listDocuments(...args),
    getDocument: (...args) => activeStore.getDocument(...args),
    getSourceUnit: (...args) => activeStore.getSourceUnit(...args),
    persistTaxonomy: (...args) => activeStore.persistTaxonomy(...args),
    getTopicMap: (...args) => activeStore.getTopicMap(...args),
    deleteDocument: (...args) => activeStore.deleteDocument(...args),
    saveGeneratedQuiz: (...args) => activeStore.saveGeneratedQuiz(...args),
    hasQuestionFingerprint: (...args) => activeStore.hasQuestionFingerprint(...args),
    recentQuestions: (...args) => activeStore.recentQuestions(...args),
    getQuizSession: (...args) => activeStore.getQuizSession(...args),
    deleteQuizSession: (...args) => activeStore.deleteQuizSession(...args),
    recordAssessment: (...args) => activeStore.recordAssessment(...args),
    getMastery: (...args) => activeStore.getMastery(...args),
    getProgress: (...args) => activeStore.getProgress(...args)
};
