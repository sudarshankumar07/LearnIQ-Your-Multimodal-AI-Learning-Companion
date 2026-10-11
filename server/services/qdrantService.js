const { qdrant } = require("../config/clients");
const { createEmbedding, validateEmbedding, EMBEDDING_DIMENSION } = require("./geminiService");
const ownerFilter = require("../utils/ownerFilter");

const COLLECTION = "pdf_chunks";
const FILTER_PAYLOAD_INDEXES = [
    { fieldName: "ownerId", fieldSchema: "keyword" },
    { fieldName: "documentId", fieldSchema: "keyword" }
];
// New indexes use keyword for opaque JSON string identifiers. Current owner/document
// identifiers are randomUUID values, so an existing UUID index also supports these filters.
const COMPATIBLE_IDENTIFIER_INDEX_TYPES = new Set(["keyword", "uuid"]);

function endpointHost(url) {
    try {
        return new URL(url).hostname || null;
    } catch {
        return null;
    }
}

function sanitizeFilter(filter) {
    if (Array.isArray(filter)) return filter.map(sanitizeFilter);
    if (!filter || typeof filter !== "object") return "[REDACTED]";
    return Object.fromEntries(Object.entries(filter).map(([key, value]) => [
        key,
        key === "key" && typeof value === "string" ? value : sanitizeFilter(value)
    ]));
}

function vectorConfiguration(collection) {
    const vectors = collection?.config?.params?.vectors;
    if (!vectors || typeof vectors !== "object") {
        return { usesNamedVectors: false, configuredVectorDimension: null, namedVectorDimensions: {} };
    }
    if (Number.isInteger(vectors.size)) {
        return { usesNamedVectors: false, configuredVectorDimension: vectors.size, namedVectorDimensions: {} };
    }
    const namedVectorDimensions = Object.fromEntries(Object.entries(vectors)
        .filter(([, config]) => config && Number.isInteger(config.size))
        .map(([name, config]) => [name, config.size]));
    return {
        usesNamedVectors: Object.keys(namedVectorDimensions).length > 0,
        configuredVectorDimension: null,
        namedVectorDimensions
    };
}

function httpStatus(error) {
    const candidates = [error, error?.response, error?.cause, error?.cause?.response];
    for (const candidate of candidates) {
        const status = candidate?.status ?? candidate?.statusCode;
        if (Number.isInteger(status)) return status;
    }
    for (const candidate of [error, error?.cause]) {
        const responseStatus = String(candidate?.message || "").match(/Unexpected Response:\s*(\d{3})\b/i);
        if (responseStatus) return Number(responseStatus[1]);
    }
    return null;
}

function errorShape(error) {
    const known = ["name", "message", "status", "statusCode", "data", "response", "body", "cause", "stack", "headers", "code"];
    const ownKeys = value => value && typeof value === "object"
        ? known.filter(key => Object.prototype.hasOwnProperty.call(value, key))
        : [];
    return {
        errorProperties: ownKeys(error),
        responseProperties: ownKeys(error?.response),
        dataProperties: ownKeys(error?.data),
        responseDataProperties: ownKeys(error?.response?.data),
        causeProperties: ownKeys(error?.cause)
    };
}

function sanitizeDiagnosticString(value, filter) {
    let result = String(value || "").split(/raw response content:/i)[0];
    const filterValues = [];
    const collectFilterValues = item => {
        if (Array.isArray(item)) return item.forEach(collectFilterValues);
        if (!item || typeof item !== "object") return;
        for (const [key, child] of Object.entries(item)) {
            if (key === "value" && typeof child === "string") filterValues.push(child);
            else collectFilterValues(child);
        }
    };
    collectFilterValues(filter);
    for (const secret of filterValues.filter(Boolean)) result = result.split(secret).join("[REDACTED]");
    result = result.replace(/https?:\/\/[^\s"'<>]+/gi, rawUrl => {
        try {
            const parsed = new URL(rawUrl.replace(/[),.;]+$/, ""));
            return `${parsed.protocol}//${parsed.hostname}`;
        } catch {
            return "[URL REDACTED]";
        }
    });
    result = result.replace(/\bBearer\s+[^\s,;"']+/gi, "Bearer [REDACTED]");
    result = result.replace(/\b(authorization|api[_ -]?key|access[_ -]?token|token|secret|password)(["']?\s*[:=]\s*["']?)[^\s,;"'}]+/gi, "$1$2[REDACTED]");
    result = result.replace(/\beyJ[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/g, "[REDACTED]");
    result = result.replace(/\b[A-Za-z0-9+/_=-]{40,}\b/g, "[REDACTED]");
    result = result.replace(/\b(payload|document|source|content|text)\s*[:=]\s*[^,\r\n]*/gi, "$1=[REDACTED]");
    result = result.replace(/\[[^\]\r\n]{100,}\]/g, "[REDACTED ARRAY]");
    result = result.replace(/"[^"\r\n]*"/g, "[REDACTED]");
    result = result.replace(/(?<![A-Za-z0-9])'[^'\r\n]*'(?![A-Za-z0-9])/g, "[REDACTED]");
    return result.trim().slice(0, 1000);
}

function safeErrorSummary(error) {
    const message = typeof error?.message === "string" ? error.message : "";
    const dimensions = message.match(/expected\s+(?:dim(?:ension)?\s*)?[:=]?\s*(\d+).*?(?:got|received)\s*[:=]?\s*(\d+)/i);
    if (dimensions) return `Vector dimension mismatch (expected ${dimensions[1]}, received ${dimensions[2]}).`;
    if (/incompatible vector configuration/i.test(message)) return "The existing collection has an incompatible vector configuration.";
    if (/incompatible payload index/i.test(message)) return "The existing collection has an incompatible payload index configuration.";
    if (/collection.{0,40}(not found|does not exist)/i.test(message)) return "Collection was not found.";
    if (/vector name|named vector/i.test(message)) return "The collection reports a vector-name configuration error.";
    if (/unauthori[sz]ed|invalid api.?key/i.test(message)) return "Qdrant rejected authentication.";
    if (/forbidden|permission denied/i.test(message)) return "Qdrant rejected the request permissions.";
    if (/timed? ?out|timeout/i.test(message)) return "The Qdrant request timed out.";
    if (/connection refused|network|fetch failed|socket/i.test(message)) return "Qdrant could not be reached over the network.";
    return "Qdrant request failed; raw provider details were suppressed.";
}

function parseProviderBody(body) {
    if (body && typeof body === "object") return body;
    if (typeof body !== "string" || !body.trim()) return null;
    try { return JSON.parse(body); } catch { return null; }
}

function responseBodyCandidates(error) {
    const candidates = [
        error?.data,
        error?.response?.data,
        error?.body,
        error?.response?.body,
        error?.cause?.data,
        error?.cause?.response?.data,
        error?.cause?.body,
        error?.cause?.response?.body
    ];
    for (const candidate of [error, error?.cause]) {
        const embeddedBody = String(candidate?.message || "").match(/raw response content:\s*([\s\S]*)$/i)?.[1]?.trim();
        if (embeddedBody) candidates.push(embeddedBody);
    }
    return candidates;
}

function providerErrorMessage(body) {
    const response = parseProviderBody(body);
    if (response && typeof response === "object") {
        const message = response?.status?.error ?? response?.error ?? response?.message ?? response?.data?.status?.error;
        if (typeof message === "string") return message;
    }

    // The SDK embeds a serialized body in its message; its SDK currently emits valid JSON,
    // but this fallback also handles a body truncated or wrapped by a different transport.
    const raw = typeof body === "string" ? body : "";
    const errorField = raw.match(/"error"\s*:\s*"((?:\\.|[^"\\])*)"/i)?.[1];
    if (errorField) {
        try { return JSON.parse(`"${errorField}"`); } catch { /* suppress malformed provider text */ }
    }
    if (raw.trim() && !raw.trim().startsWith("{")) return raw;
    return null;
}

function providerErrorMessageFromError(error) {
    for (const body of responseBodyCandidates(error)) {
        const message = providerErrorMessage(body);
        if (typeof message === "string") return message;
    }
    return null;
}

function providerResponseBody(error, filter) {
    const providerMessage = providerErrorMessageFromError(error);
    if (typeof providerMessage !== "string") return null;
    return {
        status: { error: sanitizeDiagnosticString(providerMessage, filter) },
        summary: safeErrorSummary({ message: providerMessage })
    };
}

function shouldLogQdrantDiagnostics() {
    return process.env.NODE_ENV === "development";
}

async function collectionDiagnostics() {
    let timeout;
    try {
        const collection = await Promise.race([
            qdrant.getCollection(COLLECTION),
            new Promise(resolve => { timeout = setTimeout(() => resolve(null), 1500); })
        ]);
        if (!collection) return { collectionExists: "unknown", vectorSchema: vectorConfiguration(null) };
        return { collectionExists: true, vectorSchema: vectorConfiguration(collection) };
    } catch (error) {
        return {
            collectionExists: httpStatus(error) === 404 ? false : "unknown",
            vectorSchema: vectorConfiguration(null)
        };
    } finally {
        if (timeout) clearTimeout(timeout);
    }
}

async function logQdrantQueryFailure(error, { queryEmbedding, filter }) {
    if (!shouldLogQdrantDiagnostics()) return;
    const collectionInfo = await collectionDiagnostics();
    const stackFrames = typeof error?.stack === "string"
        ? error.stack.split("\n").slice(1).filter(line => /^\s*at\s/.test(line)).slice(0, 12).join("\n")
        : "";
    console.error(JSON.stringify({
        event: "qdrant_query_diagnostic",
        endpointHost: endpointHost(process.env.QDRANT_URL),
        collection: COLLECTION,
        queryVectorDimension: Array.isArray(queryEmbedding) ? queryEmbedding.length : null,
        queryVectorFinite: Array.isArray(queryEmbedding) && queryEmbedding.length === EMBEDDING_DIMENSION && queryEmbedding.every(Number.isFinite),
        ...collectionInfo,
        searchMethod: "query",
        filter: sanitizeFilter(filter),
        httpStatus: httpStatus(error),
        providerResponseStatus: httpStatus(error),
        providerResponseBody: providerResponseBody(error, filter),
        errorMessage: sanitizeDiagnosticString(error?.message, filter),
        errorSummary: safeErrorSummary({ message: providerErrorMessageFromError(error) || error?.message }),
        exceptionName: sanitizeDiagnosticString(error?.constructor?.name || error?.name || "Error"),
        exceptionClass: error?.constructor?.name || "Error",
        ...errorShape(error),
        stackTrace: sanitizeDiagnosticString(stackFrames, filter)
    }));
}

async function setupQdrant() {
    try {
        let created = false;
        let collection;
        if (await qdrant.collectionExists(COLLECTION)) {
            collection = await validateExistingCollection();
        } else {
            try {
                await qdrant.createCollection(COLLECTION, {
                    vectors: { size: EMBEDDING_DIMENSION, distance: "Cosine" }
                });
                created = true;
            } catch (error) {
                if (httpStatus(error) !== 409) throw error;
                // Another server may have initialized the collection after our existence check.
            }
            collection = await validateExistingCollection();
        }
        await ensureFilterPayloadIndexes(collection);
        return { collection: COLLECTION, created };
    } catch (error) {
        const incompatible = ["QDRANT_COLLECTION_INCOMPATIBLE", "QDRANT_PAYLOAD_INDEX_INCOMPATIBLE"].includes(error?.code);
        console.error(JSON.stringify({
            event: "qdrant_setup_failed",
            collection: COLLECTION,
            httpStatus: httpStatus(error),
            errorMessage: safeErrorSummary(error),
            exceptionClass: error?.constructor?.name || "Error"
        }));
        if (incompatible) throw error;
        const safeError = new Error("Qdrant collection initialization failed. Check the server-side setup log.");
        safeError.code = "QDRANT_SETUP_FAILED";
        throw safeError;
    }
}

async function validateExistingCollection() {
    const collection = await qdrant.getCollection(COLLECTION);
    const vectors = collection?.config?.params?.vectors;
    const compatible = vectors && Number.isInteger(vectors.size) &&
        vectors.size === EMBEDDING_DIMENSION && String(vectors.distance || "").toLowerCase() === "cosine";
    if (!compatible) {
        const error = new Error(`Qdrant collection ${COLLECTION} has an incompatible vector configuration; expected one unnamed ${EMBEDDING_DIMENSION}-dimensional Cosine vector.`);
        error.code = "QDRANT_COLLECTION_INCOMPATIBLE";
        throw error;
    }
    return collection;
}

function payloadIndexDataType(index) {
    if (typeof index === "string") return index;
    return typeof index?.data_type === "string" ? index.data_type : null;
}

function assertCompatibleIdentifierIndex(fieldName, index) {
    const dataType = payloadIndexDataType(index);
    if (!COMPATIBLE_IDENTIFIER_INDEX_TYPES.has(dataType)) {
        const error = new Error(`Qdrant collection ${COLLECTION} has an incompatible payload index for ${fieldName}; expected keyword or UUID index for string identifiers.`);
        error.code = "QDRANT_PAYLOAD_INDEX_INCOMPATIBLE";
        throw error;
    }
}

async function ensureFilterPayloadIndexes(collection) {
    const payloadSchema = { ...(collection?.payload_schema || {}) };
    for (const { fieldName, fieldSchema } of FILTER_PAYLOAD_INDEXES) {
        const existing = payloadSchema[fieldName];
        if (Object.hasOwn(payloadSchema, fieldName)) {
            assertCompatibleIdentifierIndex(fieldName, existing);
            continue;
        }

        try {
            await qdrant.createPayloadIndex(COLLECTION, {
                field_name: fieldName,
                field_schema: fieldSchema,
                wait: true
            });
            payloadSchema[fieldName] = { data_type: fieldSchema };
        } catch (error) {
            if (httpStatus(error) !== 409) throw error;
            // Concurrent startup may have created this field index after our schema read.
            const refreshed = await qdrant.getCollection(COLLECTION);
            const racedIndex = refreshed?.payload_schema?.[fieldName];
            if (!racedIndex) throw error;
            assertCompatibleIdentifierIndex(fieldName, racedIndex);
            payloadSchema[fieldName] = racedIndex;
        }
    }
}

async function storePoints(points) {
    return qdrant.upsert(COLLECTION, { wait: true, points });
}

async function semanticSearch(query, topK = 3, ownerId, documentId) {
    if (!process.env.QDRANT_URL || process.env.QDRANT_URL === "https://your-qdrant-cluster") {
        const error = new Error("Qdrant is not configured. Add QDRANT_URL to server/.env and restart the server.");
        error.code = "SERVICE_NOT_CONFIGURED";
        throw error;
    }
    const additional = documentId ? [{ key: "documentId", match: { value: documentId } }] : [];
    const filter = ownerFilter(ownerId, additional);
    let queryEmbedding;
    try {
        queryEmbedding = validateEmbedding(await createEmbedding(query));
    } catch (error) {
        error.ragStage = "query_embedding";
        error.code = error.code || "EMBEDDING_FAILED";
        throw error;
    }
    let result;
    try {
        result = await qdrant.query(COLLECTION, {
            query: queryEmbedding,
            limit: topK,
            filter,
            with_payload: true
        });
    } catch (error) {
        try {
            await logQdrantQueryFailure(error, { queryEmbedding, filter });
        } catch (diagnosticError) {
            if (shouldLogQdrantDiagnostics()) {
                try {
                    console.error(JSON.stringify({ event: "qdrant_query_diagnostic_failed", exceptionClass: diagnosticError?.constructor?.name || "Error" }));
                } catch { /* preserve the original Qdrant exception */ }
            }
        }
        error.ragStage = "vector_search";
        error.code = "QDRANT_QUERY_FAILED";
        throw error;
    }
    return result.points;
}

async function deleteDocument(documentId, ownerId) {
    const filter = ownerFilter(ownerId, [{ key: "documentId", match: { value: documentId } }]);
    return qdrant.delete(COLLECTION, { wait: true, filter });
}

module.exports = { setupQdrant, storePoints, semanticSearch, deleteDocument };
