const fs = require("fs/promises");
const path = require("path");
const { summarizeCase, aggregate } = require("./lib/metrics");

const rotationConfirmedByInvoker = process.env.LEARNIQ_CREDENTIAL_ROTATION_CONFIRMED === "1";
const datasetPath = path.join(__dirname, "datasets", "v1.json");

function localApiBase() {
    const base = new URL(process.env.LEARNIQ_API_BASE_URL || "http://127.0.0.1:3000");
    if (!new Set(["localhost", "127.0.0.1", "::1", "[::1]"]).has(base.hostname) || base.protocol !== "http:") {
        throw new Error("For safety, the benchmark runner only accepts an HTTP loopback LearnIQ API.");
    }
    return base;
}

async function requestJson(base, route, options = {}, cookie) {
    let response;
    try {
        response = await fetch(new URL(route, base), { ...options, headers: { ...(options.headers || {}), ...(cookie ? { Cookie: cookie } : {}) } });
    } catch {
        throw new Error("Could not reach the local LearnIQ API.");
    }
    if (!response.ok) throw new Error(`Local LearnIQ API returned HTTP ${response.status} for ${route}.`);
    const data = await response.json().catch(() => null);
    if (!data) throw new Error(`Local LearnIQ API returned an unreadable response for ${route}.`);
    return { data, setCookie: response.headers.get("set-cookie") };
}

async function registerBenchmarkUser(base) {
    const email = process.env.LEARNIQ_BENCHMARK_EMAIL;
    const password = process.env.LEARNIQ_BENCHMARK_PASSWORD;
    if (!email || !password || password.length < 12) throw new Error("Set LEARNIQ_BENCHMARK_EMAIL and a disposable LEARNIQ_BENCHMARK_PASSWORD of at least 12 characters.");
    const response = await requestJson(base, "/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
    });
    if (!response.setCookie) throw new Error("Account creation succeeded without a session cookie; no benchmark uploads were attempted.");
    return { userId: response.data.user.id, cookie: response.setCookie.split(";")[0] };
}

async function uploadFixture(base, cookie, document) {
    const bytes = await fs.readFile(path.resolve(__dirname, document.file));
    const form = new FormData();
    form.append("material", new Blob([bytes], { type: "application/pdf" }), document.title);
    await requestJson(base, "/upload", { method: "POST", body: form }, cookie);
}

async function run() {
    if (!rotationConfirmedByInvoker) throw new Error("Before any live benchmark request, confirm the exposed provider credential has been rotated by setting LEARNIQ_CREDENTIAL_ROTATION_CONFIRMED=1 in the invoking shell.");
    require("dotenv").config({ path: path.join(__dirname, "..", "server", ".env") });
    const base = localApiBase();
    const dataset = JSON.parse(await fs.readFile(datasetPath, "utf8"));
    for (const document of dataset.documents) {
        const filePath = path.resolve(__dirname, document.file);
        await fs.access(filePath).catch(() => { throw new Error(`Benchmark fixture is missing: ${path.basename(filePath)}. Run the fixture generator first.`); });
    }

    const { userId, cookie } = await registerBenchmarkUser(base);
    for (const document of dataset.documents) await uploadFixture(base, cookie, document);
    const listing = await requestJson(base, "/upload", {}, cookie);
    const documentIdByKey = new Map();
    for (const expected of dataset.documents) {
        const matched = (listing.data.documents || []).find(document => document.name === expected.title && document.sourceType === "pdf");
        if (!matched) throw new Error(`Expected benchmark document was not listed after ingestion: ${expected.title}.`);
        documentIdByKey.set(expected.key, matched.id);
    }
    const documentKeyById = new Map([...documentIdByKey].map(([key, id]) => [id, key]));

    const { answerQuestionFromChunks } = require("../server/services/ragService");
    const { semanticSearch } = require("../server/services/qdrantService");
    const cases = [];
    for (const question of dataset.questions) {
        const retrieval = await semanticSearch(question.question, 3, userId);
        const answer = await answerQuestionFromChunks(question.question, "en", retrieval);
        cases.push(summarizeCase(question, retrieval, answer, documentKeyById));
    }

    const outputDirectory = path.join(__dirname, "results");
    await fs.mkdir(outputDirectory, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const outputPath = path.join(outputDirectory, `rag-benchmark-${timestamp}.json`);
    const report = {
        datasetId: dataset.datasetId,
        datasetVersion: dataset.version,
        runAt: new Date().toISOString(),
        evaluation: { retrievalTopK: 3, retrievalMetricVersion: "exact-source-evidence-v1", embeddingModel: "gemini-embedding-2", answerModel: "gemini-3.5-flash-lite", providerMode: "live" },
        learnerAccount: "new disposable benchmark account; identifier omitted",
        cases,
        summary: aggregate(cases),
        limitations: ["Faithfulness, answer relevance, causal restraint, and answer correctness require human annotation and are left null.", "This small synthetic fixture is a pipeline smoke benchmark, not a representative team-selected course benchmark.", "A run records actual retrieval and generated answers only when this script completes against live services."]
    };
    await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
    console.log(`Completed ${cases.length} live benchmark cases.`);
    console.log(`Machine-readable report: ${path.relative(process.cwd(), outputPath)}`);
}

if (require.main === module) {
    run().catch(error => {
        console.error(`Benchmark not completed: ${error.message}`);
        console.error("Any account or documents created before the failure remain in the disposable local account; inspect and clean them manually.");
        process.exitCode = 1;
    });
}

module.exports = { localApiBase, run };
