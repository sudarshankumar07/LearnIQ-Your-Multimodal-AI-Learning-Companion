# Architecture and data flow

## Current stack

- React, TypeScript, and Vite frontend.
- CommonJS Express API.
- Gemini embeddings and generation.
- Qdrant vectors with an `ownerId` payload filter.
- Node `node:sqlite` for users, hashed-session records, private document metadata, PPTX slide text, quiz sessions, question fingerprints, assessment history, and mastery.
- Original PDF, PPTX, and supported video files stored under private `server/uploads/` using random UUID filenames.

## Ingestion

The upload route applies rate, size, extension, and MIME constraints. The controller checks the file signature and assigns the document ID and authenticated owner ID. PDFs are text-extracted per page; PPTX ZIP/XML text is extracted per slide. MP4/MOV/WebM files are uploaded to Gemini Files, transcribed into timestamped JSON segments, chunked, and indexed. The temporary Gemini copy is deleted when possible, while the original remains private for timestamp playback. Chunks receive embeddings and are upserted with owner, document, source type, title, page/slide, or start/end timestamp metadata. A failed indexing operation attempts to delete any partially indexed vectors and removes the temporary/original upload.

PPTX text previews are generated from escaped extracted text and link to the stored original presentation. Video citations open the original video at the selected timestamp. Video timestamp quality depends on Gemini transcription and has not been live-verified. Video ingestion is speech-only: silent caption cards are not indexed, and the upload response directs learners to use a narrated video or upload the card text as PDF/PPTX. Video frames are not extracted.

## Retrieval, authorization, and citations

Login and registration use scrypt password hashes and random opaque session cookies marked HTTP-only and SameSite Strict (Secure in production). The server stores only a SHA-256 hash of each session token. Mutating browser requests are checked against configured `APP_ORIGINS`. Protected API routes resolve identity server-side.

RAG and assessment retrieval call Qdrant with an owner filter. Document selection adds a document filter. Source open, download, list, and delete operations verify SQLite ownership. PDF citations open the stored PDF with a page fragment. PPTX citations open an escaped text preview for the exact slide and offer the original presentation for download. Video citations redirect to the authenticated original media with a `#t=` time fragment.

## Assessment and personalization

Generated answer keys are withheld until submission. Quiz state and exact normalized question fingerprints are stored per user. MCQs are graded deterministically, numerical answers use a numeric tolerance, and short answers use accepted strings or Gemini comparison. Assessment results update the Beta-Bernoulli topic estimates described in [LEARNER_MODEL.md](LEARNER_MODEL.md). Progress reads persisted assessments and mastery.

## Data and migration notes

SQLite defaults to `server/data/learniq.sqlite`; `LEARNIQ_DATA_DIR` can select a persistent private directory. Qdrant remains separately hosted. Vector points created before owner IDs were introduced are excluded by owner filters and are not assigned to an account automatically. Re-upload their source files under the intended account. Keep SQLite and uploaded sources backed up together.
