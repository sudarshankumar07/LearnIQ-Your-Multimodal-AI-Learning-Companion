// LearnIQ PostgreSQL Schema Definition and Migration Runner

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(64) PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_salt VARCHAR(128) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
    token_hash VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS documents (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    storage_path TEXT NOT NULL,
    pages INTEGER NOT NULL,
    source_type VARCHAR(32) NOT NULL DEFAULT 'pdf',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS documents_user_idx ON documents(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS quiz_sessions (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    questions_json TEXT NOT NULL,
    expires_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS quiz_sessions_user_idx ON quiz_sessions(user_id);

CREATE TABLE IF NOT EXISTS question_history (
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    fingerprint VARCHAR(128) NOT NULL,
    question_text TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY(user_id, fingerprint)
);
CREATE INDEX IF NOT EXISTS question_history_user_idx ON question_history(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS assessments (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    score INTEGER NOT NULL,
    total INTEGER NOT NULL,
    accuracy INTEGER NOT NULL,
    topics_json TEXT NOT NULL,
    results_json TEXT NOT NULL,
    diagnostics_json TEXT NOT NULL DEFAULT '{}',
    mode VARCHAR(32) NOT NULL DEFAULT 'practice',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS assessments_user_idx ON assessments(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS mastery (
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    topic VARCHAR(255) NOT NULL,
    alpha DOUBLE PRECISION NOT NULL DEFAULT 1,
    beta DOUBLE PRECISION NOT NULL DEFAULT 1,
    attempts INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY(user_id, topic)
);

CREATE TABLE IF NOT EXISTS source_units (
    document_id VARCHAR(64) NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    location_type VARCHAR(32) NOT NULL,
    location_number INTEGER NOT NULL,
    content TEXT NOT NULL,
    PRIMARY KEY(document_id, location_type, location_number)
);
CREATE INDEX IF NOT EXISTS source_units_user_doc_idx ON source_units(user_id, document_id);

CREATE TABLE IF NOT EXISTS topics (
    id VARCHAR(64) PRIMARY KEY,
    owner_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    slug VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    kind VARCHAR(32) NOT NULL CHECK(kind IN ('topic','subtopic','concept')),
    UNIQUE(owner_id, slug),
    UNIQUE(owner_id, id)
);
CREATE INDEX IF NOT EXISTS topics_owner_idx ON topics(owner_id);

CREATE TABLE IF NOT EXISTS topic_sources (
    document_id VARCHAR(64) NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    topic_id VARCHAR(64) NOT NULL,
    evidence TEXT NOT NULL,
    location_type VARCHAR(32) NOT NULL,
    location_number INTEGER NOT NULL,
    PRIMARY KEY(document_id, topic_id, location_type, location_number),
    FOREIGN KEY(user_id, topic_id) REFERENCES topics(owner_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS topic_sources_user_doc_idx ON topic_sources(user_id, document_id);

CREATE TABLE IF NOT EXISTS chunk_topics (
    document_id VARCHAR(64) NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    topic_id VARCHAR(64) NOT NULL,
    PRIMARY KEY(document_id, chunk_index, topic_id),
    FOREIGN KEY(user_id, topic_id) REFERENCES topics(owner_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS chunk_topics_user_doc_idx ON chunk_topics(user_id, document_id);

CREATE TABLE IF NOT EXISTS topic_relations (
    owner_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    from_topic_id VARCHAR(64) NOT NULL,
    to_topic_id VARCHAR(64) NOT NULL,
    relation_type VARCHAR(32) NOT NULL CHECK(relation_type IN ('prerequisite','subtopic')),
    document_id VARCHAR(64) NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    source_location_type VARCHAR(32) NOT NULL DEFAULT 'page',
    source_location_number DOUBLE PRECISION NOT NULL DEFAULT 1,
    evidence TEXT NOT NULL,
    confidence DOUBLE PRECISION NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
    PRIMARY KEY(owner_id, from_topic_id, to_topic_id, relation_type, document_id),
    CHECK(from_topic_id <> to_topic_id),
    FOREIGN KEY(owner_id, from_topic_id) REFERENCES topics(owner_id, id) ON DELETE CASCADE,
    FOREIGN KEY(owner_id, to_topic_id) REFERENCES topics(owner_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS topic_relations_owner_doc_idx ON topic_relations(owner_id, document_id);
`;

async function initPostgresSchema(clientOrPool) {
    await clientOrPool.query(SCHEMA_SQL);
}

module.exports = { SCHEMA_SQL, initPostgresSchema };

