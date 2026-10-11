# LearnIQ demonstration guide

This is a recording checklist, not a claim that a video has been recorded. Capture a 3–10 minute YouTube video only after the live Gemini/Qdrant workflow below succeeds.

## Before recording

- Configure `server/.env`, start the server and Vite frontend, and confirm both are reachable.
- Use a fresh student account and non-sensitive sample documents you are authorized to use.
- Prepare one text-based PDF and one PPTX with readable text on at least two known pages/slides.
- Confirm each source appears in that account's Library and opens at its selected page or slide preview.
- Confirm an unsupported query is declined; do not stage or claim an answer that the uploaded files do not support.
- Generate, submit, and review an assessment; reload the app and confirm its assessment and mastery records remain.
- If any step fails, stop and fix it before recording. Do not present video, OCR, diagram, or benchmark capabilities as implemented.

## Suggested 5–7 minute sequence

1. **Context (30 sec):** State what LearnIQ currently supports and identify unsupported source types honestly.
2. **Accounts and privacy (30 sec):** Sign in, show the library is account-scoped, and briefly explain server-side owner filtering.
3. **Ingestion (60–90 sec):** Upload the PDF and PPTX; show page/slide counts and open a precise source location.
4. **Tutor (60–90 sec):** Ask a question answered by one source, then one supported by multiple documents. Open citations and show exact page/slide previews. Ask one question not covered and show the refusal.
5. **Assessment (90 sec):** Choose a document/topic, generate a short quiz, submit a mix of correct/incorrect responses, and inspect answer explanations and citations.
6. **Personalization (60 sec):** Show persisted topic estimates, explain the Beta(1,1) prior and per-answer updates, then create another assessment with blank topic scope to show weak-topic retrieval bias.
7. **Technical close (30–60 sec):** Show React/Vite → Express → Gemini/Qdrant plus SQLite, note owner filters and storage, and name the live-verification limits, unsupported video-frame understanding, and absence of framework-based RAG metrics.

## Evidence to retain

Record the exact sample source files, account setup steps, commands, and timestamps. If evaluation has not been run, say so. No benchmark metrics should be added to the video until the reproducible evaluation workflow exists and has produced real results.
