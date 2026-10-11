# LearnIQ

LearnIQ is a React and Express study companion for Track D. Its ingestion code extracts PDF page text and Gemini-assisted page OCR/visual descriptions, PPTX slide text and embedded-image descriptions, and MP4/MOV/WebM lecture transcripts. Content is chunked, tagged with validated extracted topics where source evidence supports them, and indexed in Qdrant with source provenance. A chunk without validated topic evidence stays indexed as unclassified; it is not dropped or assigned an invented topic. The app also includes cited tutoring, practice/diagnostic/mock-exam assessment modes, server grading, saved assessment history, and evidence-linked topic estimates. These provider-backed workflows have local mocked regression coverage, but have not been verified against live Gemini/Qdrant services in this environment.

## Requirements

- Node.js 22.13 or newer (`node:sqlite` is used by the backend)
- A Gemini API key with access to the Gemini Files API and configured model
- A Qdrant cluster URL and API key

## Configure

Copy `server/.env.example` to `server/.env` and add your Gemini and Qdrant credentials. Configure `APP_ORIGINS` with the exact frontend origin(s) for browser API requests. `LEARNIQ_DATA_DIR` may point to a persistent private directory; by default the SQLite database is stored in `server/data/learniq.sqlite`, and original PDFs, PPTX files, and videos are stored privately in `server/uploads/`.

Keep `.env`, the SQLite database, and uploaded documents out of source control and public web roots. Back up the database and source directory together. The Qdrant collection is filtered by authenticated owner ID for all retrieval and deletion operations. Existing vector points without owner metadata are intentionally not exposed to new accounts; re-upload those source files to index them under an account.

## Run locally

Install the monorepo dependencies once from the project root:

```powershell
npm install
Copy-Item server/.env.example server/.env
# Edit .env with your API credentials
```

Start the backend and frontend in separate terminals, both from the project root:

```powershell
npm start
```

```powershell
npm run dev
```

`npm run build` creates the frontend production bundle and `npm test` runs the backend test suite. `node server/scripts/preflight.js` checks provider configuration presence without displaying values or contacting providers. All workspace dependencies are installed in the root `node_modules` folder.

Create an account in the app. Passwords are hashed with Node's scrypt; sessions use HTTP-only, SameSite cookies. PDF/PPTX uploads are limited to 20 MB, 500 pages/slides, and 1,000 extracted chunks. MP4/MOV/WebM uploads are limited to 100 MB; Gemini transcribes them into timestamped segments, indexes transcript chunks, and attempts to delete the temporary Gemini Files copy after processing. Long videos may take time because processing is synchronous; `GEMINI_FILE_PROCESSING_TIMEOUT_MS` controls the wait for Gemini file readiness (default 300,000 ms). PDF and PPTX visual extraction uses Gemini and may increase processing time/cost. PPTX citations open a text preview for that slide and link to the original file; PDF citations open the stored PDF at the cited page; video citations seek in the original video. Speaker notes and SVG slide-image analysis are not supported.

## Verification

- Frontend type check: `npx tsc --noEmit -p Front-End/tsconfig.json`
- Frontend production build: `npm run build`
- Backend tests: `npm test`
- Backend syntax: `node --check server/index.js` and checks on changed server files
- Dependency review: `npm audit`
- Provider preflight: `node server/scripts/preflight.js` (presence-only); live probes require owner-confirmed credential rotation, see [docs/EVALUATION.md](docs/EVALUATION.md)

See [TRACK_D_TRACEABILITY.md](TRACK_D_TRACEABILITY.md) for the PDF matrix, [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the current architecture, [LEARNER_MODEL.md](LEARNER_MODEL.md) for the estimate and limits, [SECURITY_AUDIT.md](SECURITY_AUDIT.md) for findings, [docs/EVALUATION.md](docs/EVALUATION.md) for measured checks and evaluation blockers, and [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md) for the timed recording sequence. `TRACK_D_STATUS.md` lists remaining priorities.
