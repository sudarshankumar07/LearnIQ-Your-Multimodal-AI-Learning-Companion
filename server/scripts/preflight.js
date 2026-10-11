const path = require("path");

const liveProbeRequested = process.argv.includes("--probe-live");
// These approvals must come from the invoking shell, not server/.env.
const rotationConfirmedByInvoker = process.env.LEARNIQ_CREDENTIAL_ROTATION_CONFIRMED === "1";
const liveProbeAllowedByInvoker = process.env.LEARNIQ_ALLOW_LIVE_PROBES === "1";

const REQUIRED = ["GEMINI_API_KEY", "QDRANT_URL", "QDRANT_API_KEY"];
const PLACEHOLDERS = new Set(["replace-with-your-key", "https://your-qdrant-cluster"]);

function checkRequiredConfiguration(env = process.env) {
    return REQUIRED.map(name => {
        const value = typeof env[name] === "string" ? env[name].trim() : "";
        let configured = Boolean(value) && !PLACEHOLDERS.has(value);
        let status = !value ? "missing" : PLACEHOLDERS.has(value) ? "placeholder" : "configured";
        if (name === "QDRANT_URL" && configured) {
            try {
                const url = new URL(value);
                configured = ["http:", "https:"].includes(url.protocol) && Boolean(url.hostname) && !url.username && !url.password;
            } catch { configured = false; }
            if (!configured) status = "invalid URL";
        }
        return { name, configured, status };
    });
}

function safeProviderFailure(service, error) {
    const status = Number.isInteger(error?.status) ? error.status : null;
    if (status === 404 && service.startsWith("Qdrant")) return "Collection was not found; verify the pdf_chunks collection exists. No collection was created.";
    if (status === 401 || status === 403) return `Provider rejected authentication/authorization (HTTP ${status}); verify the rotated key and its permissions.`;
    if (status === 429) return "Provider rate limit or quota was reached; retry after checking service limits.";
    if (status) return `Connection or configuration check failed (HTTP ${status}); provider details were suppressed.`;
    return "Connection or configuration check failed; confirm network access and provider configuration. Provider details were suppressed.";
}

function checkVectorConfiguration(collection) {
    const vectors = collection?.config?.params?.vectors;
    if (!vectors || typeof vectors !== "object" || !Number.isInteger(vectors.size)) {
        return { compatible: false, reason: "Expected one unnamed dense vector configuration." };
    }
    const sizeMatches = vectors.size === 3072;
    const distanceMatches = String(vectors.distance || "").toLowerCase() === "cosine";
    if (!sizeMatches || !distanceMatches) {
        return { compatible: false, reason: "Collection vector configuration differs from required 3072-dimensional cosine vectors." };
    }
    return { compatible: true, reason: "Collection uses 3072-dimensional cosine vectors." };
}

async function probeProviders(env = process.env) {
    const { GoogleGenAI } = require("@google/genai");
    const { QdrantClient } = require("@qdrant/js-client-rest");
    const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
    const qdrant = new QdrantClient({ url: env.QDRANT_URL, apiKey: env.QDRANT_API_KEY, checkCompatibility: false, timeout: 8000 });
    const checks = [];

    try {
        const embedding = await ai.models.embedContent({ model: "gemini-embedding-2", contents: "LearnIQ read-only connectivity check." });
        const dimensions = embedding?.embeddings?.[0]?.values?.length;
        const geminiOk = dimensions === 3072;
        checks.push({ service: "Gemini embedding API", ok: geminiOk, detail: geminiOk ? "Connectivity and 3072-dimensional embedding verified." : "Connectivity responded, but embedding dimensions do not match 3072." });
    } catch (error) {
        checks.push({ service: "Gemini embedding API", ok: false, detail: safeProviderFailure("Gemini embedding API", error) });
    }
    try {
        const collection = await qdrant.getCollection("pdf_chunks");
        const vectorCheck = checkVectorConfiguration(collection);
        checks.push({ service: "Qdrant pdf_chunks collection", ok: vectorCheck.compatible, detail: vectorCheck.reason });
    } catch (error) {
        checks.push({ service: "Qdrant pdf_chunks collection", ok: false, detail: safeProviderFailure("Qdrant pdf_chunks collection", error) });
    }
    return checks;
}

async function main() {
    require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
    const configuration = checkRequiredConfiguration();
    for (const item of configuration) console.log(`${item.name}: ${item.status}`);
    if (configuration.some(item => !item.configured)) process.exitCode = 1;

    if (!liveProbeRequested) {
        console.log("Local configuration check only; no provider requests were made.");
        return;
    }
    if (!rotationConfirmedByInvoker || !liveProbeAllowedByInvoker) {
        console.error("Live probes require shell-level LEARNIQ_CREDENTIAL_ROTATION_CONFIRMED=1 and LEARNIQ_ALLOW_LIVE_PROBES=1. No provider requests were made.");
        process.exitCode = 2;
        return;
    }
    if (configuration.some(item => !item.configured)) return;

    const liveResults = await probeProviders();
    for (const check of liveResults) console.log(`${check.service}: ${check.ok ? "PASS" : "FAIL"} — ${check.detail}`);
    if (liveResults.some(check => !check.ok)) process.exitCode = 1;
}

if (require.main === module) {
    main().catch(() => {
        console.error("Preflight failed before completing checks; diagnostic details were suppressed.");
        process.exitCode = 1;
    });
}

module.exports = { checkRequiredConfiguration, checkVectorConfiguration, safeProviderFailure, probeProviders };
