# LearnIQ demo script (3–10 minutes)

Recording and YouTube publication are still outstanding. No browser automation or screen-recording tool was available in the current environment. Run this checklist only after the owner confirms rotation of the exposed provider credential, the replacement is installed locally, live preflight succeeds, and the selected source material/citations have been checked.

## 6-minute sequence

1. **0:00–0:40 — Introduce the app.** Show the existing dashboard and explain that accounts keep documents and progress private.
2. **0:40–1:40 — Upload material.** Create a demo account and upload a PDF with a diagram, a PPTX with an embedded image, and a short supported lecture video. Show processing completion and library entries. PDF/PPTX visual extraction and transcription use Gemini; if a provider path fails, show the error rather than claiming success.
3. **1:40–3:00 — Grounded tutoring.** Ask one direct question and one paraphrase. Open each returned page, slide, or timestamp citation. Ask one off-material question and show the refusal/limitation.
4. **3:00–4:30 — Assessment.** Show the baseline diagnostic option, then generate a small practice quiz and mock exam scoped to material. Show topic, source, and difficulty tags, submit answers, and review cited feedback and the weak-topic report.
5. **4:30–5:20 — Learner state.** Show saved topic estimates and assessment history. Explain that estimates reflect observed quiz correctness and do not prove long-term retention.
6. **5:20–6:00 — Architecture and limits.** Show the API/service split, owner-filtered retrieval, and source metadata. State that OCR/visual extraction, citations, and model quality require live verification, no RAG benchmark metrics have been produced, and the deterministic learner simulation is not a real learner outcome.

## Before recording

- Confirm production build and backend tests pass.
- Use disposable demo credentials and redistributable course material.
- Verify PDF page, PPTX slide, and video timestamp navigation in the browser.
- Capture a supported question, paraphrase, and unsupported question.
- Confirm quiz generation, grading, progress persistence, and account isolation.
- Avoid showing `.env`, API credentials, cookies, private uploads, or real learner data.
- Keep the final video between 3 and 10 minutes and publish only after reviewing the recording for secrets.

## Manual browser verification

Use a fresh disposable account and redistributable course files. Record pass/fail and the observed citation locations before recording the demo.

1. Start backend and frontend. Register, log out, log back in, and confirm the dashboard loads without sample progress.
2. Upload a text PDF with a diagram, a PPTX with an embedded raster image, and a short supported lecture video. Confirm processing succeeds and each appears in the library.
3. Ask a question answered by the PDF and one paraphrased version. Confirm answers cite the expected page and each link opens the source page. Repeat for a PPTX slide and video timestamp.
4. Ask a missing-information question and a causal question unsupported by the sources. Confirm the app declines or clearly identifies the limit without presenting guesses as sourced facts.
5. Generate and complete a baseline diagnostic, then practice and a mock exam. Confirm source/topic/difficulty labels, grading, and citations; check that a second diagnostic is rejected.
6. Open progress and the topic map. Confirm saved assessment history, observed-performance estimates, recommendation rationale, source evidence, and any extracted relationships.
7. Resize to narrow and wide viewports. Confirm upload, chat, assessment, progress, and topic-map controls remain usable.
8. Register a second disposable account. Confirm it cannot see the first account's documents/topics/progress. Delete a benchmark document and verify it disappears from the library and cannot be retrieved.

Do not record until every demonstrated step passes against live services. Record the screen with a local recorder, review playback and duration (3–10 minutes), remove credential/PII frames, and only then publish the YouTube link.
