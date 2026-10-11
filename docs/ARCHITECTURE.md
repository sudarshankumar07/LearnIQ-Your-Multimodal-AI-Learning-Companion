# LearnIQ architecture

## Runtime

The browser app is React 18 with TypeScript and Vite in `Front-End/`. The Express 5 server in `server/` exposes authentication, upload/library, tutoring, quiz, and progress routes. Vite proxies those routes to the local API during development.

SQLite (`server/services/dataStore.js`) stores scrypt-backed accounts, hashed session tokens, document metadata, PPTX slide text, quiz sessions, assessment history, exact-question fingerprints, per-topic Beta-Bernoulli counts, taxonomy topics, source evidence, chunk associations, and validated topic relations. Original uploads are stored under the private `server/uploads/` directory. Neither directory belongs in a distributable archive.

## Authentication and ownership

Registration and login issue opaque HTTP-only, SameSite cookies; the database stores only a hash of each session token. Browser write requests are checked against configured origins. Routes require authentication. Document metadata and assessment rows use user IDs in their database queries, and Qdrant filters require the authenticated `ownerId`. Deletion removes owner-scoped vector points, SQLite metadata, and the stored file.

## Ingestion

- **PDF:** `pdf-parse` extracts text by page; Gemini Files page analysis adds OCR and visual descriptions, including for pages without selectable text. Chunks retain page provenance. This provider path has mocked tests but no live validation.
- **PPTX:** the ZIP/XML reader extracts slide text and embedded raster images in slide order. Gemini describes/OCRs images, with resulting text combined with slide text and slide provenance. The app stores escaped text for a slide preview. Speaker notes and SVG image analysis are unsupported; live extraction has not been checked.
- **Video:** uploads are sent to Gemini Files. The configured Gemini model is prompted to return timestamped transcript segments, which are validated, grouped, embedded, and indexed. This provider workflow has not been tested live in the current environment; timestamps and transcript quality therefore remain unverified.

Topic extraction runs in bounded batches. A chunk is associated only when model-supplied exact evidence occurs in that chunk; chunks without valid evidence remain indexed without topic IDs. Explicit prerequisites/subtopic edges require source evidence and confidence and are checked for cycles. SQLite persists the owner-scoped graph; vector payloads include stable topic IDs. Embeddings use `gemini-embedding-2`; Qdrant uses the `pdf_chunks` collection configured for 3072-dimensional cosine vectors. Startup validates an existing collection and ensures keyword payload indexes for the `ownerId` and `documentId` filters. Existing indexes are reused, concurrent creation conflicts are rechecked, and collection points/vectors are not deleted or recreated. Setup errors are logged safely and thrown so the backend does not report ready with an unusable collection.

## Tutoring / retrieval

`POST /ask` validates the question and language, then calls `semanticSearch` with the authenticated owner. Query embedding and Qdrant search return up to three points. The service includes all returned non-empty payloads in a Gemini prompt that treats excerpts as untrusted reference material. Response citations are restricted to source IDs supplied in that prompt. The UI links each citation to a PDF page, PPTX slide text preview, or video time.

No score threshold is configured. This was left unchanged because a safe threshold requires measured retrieval data. Development logs now report retrieved/usable counts, point and document IDs, scores, and previews capped at 120 characters; production omits retrieval previews. Failure logs contain a stage and category rather than the provider error body. These diagnostics identify pipeline stages but do not substitute for a live retrieval evaluation.

## Assessments and learner state

Quiz generation retrieves owner-scoped chunks, asks Gemini to produce source-tagged MCQ, short-answer, or numerical questions, then makes a separate verification request. Server checks schema, type, scope, source location, exact fingerprints, and semantic similarity against recent questions before saving a session. Practice, one-time baseline diagnostic, and mock-exam modes share this flow. Server grading updates persistent per-topic Beta-Bernoulli counts and difficulty adaptation. Repeated errors can prompt tentative misconception analysis only when a model claim is supported by exact quoted source evidence. These estimates reflect observed correctness, not proof of retention. Tutoring turns do not update the learner model.

## Known limits

Live Gemini and Qdrant paths, browser end-to-end behavior, citation accuracy, OCR/visual extraction quality, taxonomy quality, longitudinal personalization, and framework-based benchmark metrics remain unverified or incomplete. See `TRACK_D_TRACEABILITY.md` and `TRACK_D_STATUS.md` for requirement-level state.
