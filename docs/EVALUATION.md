# Evaluation status and reproducibility

## Local verification

These are engineering checks, not live-service or model-quality results.

| Check | Result | What it establishes |
|---|---:|---|
| `npm test` | 61/61 passed | Auth/ownership, Qdrant SDK request and payload-index serialization, idempotent index setup/filter handling, upload rejection, per-chunk topic evidence and unclassified persistence, assessment lifecycle, synthetic PDF parsing/metrics, mocked Gemini processing, and transcript chunking. |
| `npx tsc --noEmit -p Front-End/tsconfig.json` | Passed | Frontend TypeScript compilation. |
| `node --check` on server JavaScript files | Passed | Node syntax validation for all server JS files returned by `rg --files server -g '*.js'`. |
| `git diff --check` | Passed | No whitespace errors; Git reported only configured LF-to-CRLF conversion notices. |
| `npm run build` | Passed outside restricted sandbox | The first sandboxed run could not traverse to the existing Vite config; rerun outside the sandbox built the production bundle successfully. |
| PDF parser/index-flow smoke | Passed with doubles | Three PDF page chunks flowed through parsing/indexing with stubbed Gemini, embeddings, and vector storage. This is not a live upload and does not prove the original failing upload succeeded. |
| Security/artifact tests | Passed | Local `.env` files are ignored and not tracked; tests reject malformed and over-20-MB PDFs and verify owner-scoped document deletion filters. This is not a penetration test. |

The package audit previously could not reach the npm registry. No dependency vulnerability conclusion is available.

## Synthetic RAG smoke benchmark

`evaluation/datasets/v1.json` is version 1.0.0: five labeled questions over two deterministic one-page PDFs. It covers direct retrieval, paraphrase, multi-document comparison, missing information, and unsupported causal inference. The fixture sources are synthetic and test pipeline behavior; they are not the required team-selected course benchmark.

`evaluation/runRagBenchmark.js` creates a new disposable local account, uploads both fixture PDFs through the authenticated upload API, then calls the real owner-filtered retrieval and answer assembly path. It saves retrieval ranks/scores, expected evidence, answer citations, per-case metrics, and aggregate metrics under `evaluation/results/`. It does not remove the account or documents; use a fresh disposable email for each run. It only allows a loopback API URL.

The runner calculates exact-evidence Recall@3, context precision/recall, citation-location checks, and a refusal heuristic. Faithfulness, answer relevance, causal restraint, and answer correctness are left for human annotation and are emitted as null. The runner has **not** been run against live services, so no RAG metrics are reported. RAGAS would require adding a separate Python runtime/dependency stack to this Node project; network access is unavailable, so no framework was installed or run.

After the owner confirms rotation, install the replacement credentials, successfully run the live preflight, and start the backend in a separate terminal. Then use a new disposable account for each run:

```powershell
$env:LEARNIQ_CREDENTIAL_ROTATION_CONFIRMED = '1'
$env:LEARNIQ_BENCHMARK_EMAIL = Read-Host 'Fresh disposable benchmark email'
$benchmarkPasswordSecure = Read-Host 'Disposable password (12+ characters)' -AsSecureString
$env:LEARNIQ_BENCHMARK_PASSWORD = [System.Net.NetworkCredential]::new('', $benchmarkPasswordSecure).Password
node evaluation/runRagBenchmark.js
Remove-Item Env:LEARNIQ_CREDENTIAL_ROTATION_CONFIRMED
Remove-Item Env:LEARNIQ_BENCHMARK_EMAIL
Remove-Item Env:LEARNIQ_BENCHMARK_PASSWORD
```

The script leaves the disposable account and its two uploaded PDFs in the local app; it does not delete data automatically.

## Simulated learners

`evaluation/runLearnerSimulation.js` ran three deterministic profiles for three sessions each using the real `generateQuiz`, `submitQuiz`, and SQLite learner-model code. Gemini and Qdrant responses were deterministic test doubles; SQLite was in memory. These are code-path simulations, not real learner results or live-provider experiments.

| Simulated profile | Initial estimate | Session scores | Adaptive difficulty | Final estimate | Exact repeat rate |
|---|---:|---|---|---:|---:|
| Novice | 17% | 1/5, 2/5, 3/5 | Easy, easy, easy | 33% | 0% |
| Developing | 50% | 3/5, 4/5, 4/5 | Medium, medium, medium | 67% | 0% |
| Advanced | 83% | 5/5, 5/5, 5/5 | Hard, hard, hard | 95% | 0% |

Across 9 practice sessions, mean estimate moved from 50% to 65%. Duplicate submissions were rejected, state remained isolated across profiles, and the run found zero invalid topic/difficulty recommendations. Semantic paraphrase repetition remains null because the novelty verifier was mocked. Mastery movement is observed correctness only, not evidence of retention or learning gains.

Latest machine-readable run: `evaluation/results/learner-simulation-2026-10-10T21-33-25-194Z.json`.

The simulation exposed and fixed a real adaptive-selection defect: when no topic was under the weak-topic cutoff, the service used an empty mastery set and fell back to easy difficulty. It now uses all observed topic history in that case. A regression test covers this path.

## Service preflight

`node server/scripts/preflight.js` reports whether required Gemini/Qdrant settings are present without printing values and makes no provider requests. It checks `GEMINI_API_KEY`, `QDRANT_URL`, and `QDRANT_API_KEY`.

After the owner confirms the exposed provider credential has been rotated and the replacement is installed locally, the optional live probe performs one embedding request and a read-only Qdrant `getCollection("pdf_chunks")`. It verifies that the collection has an unnamed 3072-dimensional cosine vector. It does not create, modify, or delete a collection. It suppresses raw provider errors and never prints credentials.

PowerShell, only after rotation has been confirmed:

```powershell
$env:LEARNIQ_CREDENTIAL_ROTATION_CONFIRMED = '1'
$env:LEARNIQ_ALLOW_LIVE_PROBES = '1'
node server/scripts/preflight.js --probe-live
Remove-Item Env:LEARNIQ_CREDENTIAL_ROTATION_CONFIRMED
Remove-Item Env:LEARNIQ_ALLOW_LIVE_PROBES
```

Rotation has not been verified by the owner in this work, so the live probe and benchmark were not run.

## Remaining live evaluation and manual checks

No live PDF/PPTX/video ingestion, Qdrant indexing/retrieval, citation navigation, unsupported-query behavior, or cross-user vector test was performed. The supplied Qdrant HTTP 400 identifies a missing `ownerId` payload index; startup now ensures keyword indexes for `ownerId` and `documentId`, but the backend was not restarted against the configured collection and live retrieval is unverified. The reported assessment HTTP 400 has not been tied to a specific request/response or reproduced against a configured service. No browser automation tool is available in this environment. After the owner confirms credential rotation and a successful preflight, run the live benchmark above and repeat ingestion, retrieval, and assessment checks with disposable data and a redistributable course source. Then use two disposable browser accounts to check upload, cited chat, unsupported queries, assessments, progress, topic map, responsiveness, deletion, and isolation. Never use personal course or learner data for the demo.

## Reproduction commands

Local checks from the repository root:

```powershell
npm test
npx tsc --noEmit -p Front-End/tsconfig.json
node --check server/index.js
git diff --check
npm run build
node evaluation/runLearnerSimulation.js
```

Generate the synthetic benchmark PDFs once before a future live benchmark run:

```powershell
node evaluation/fixtures/makeKnownPdfFixtures.js
```

The generator refuses to overwrite existing fixtures unless `--force` is supplied. Run the live benchmark only with owner-confirmed rotated provider credentials, the backend running, and fresh disposable benchmark account environment variables `LEARNIQ_BENCHMARK_EMAIL` and `LEARNIQ_BENCHMARK_PASSWORD` set in the invoking shell.
