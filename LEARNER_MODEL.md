# Learner model

## Current estimate

LearnIQ stores one independent Beta-Bernoulli estimate per authenticated user and generated topic in SQLite. Each topic starts with a uniform Beta(1,1) prior, so the posterior mean begins at 50% with no evidence. For each server-graded question, a correct answer increments `alpha` by one; an incorrect answer increments `beta` by one. The displayed estimate is:

`mastery = round(100 × alpha / (alpha + beta))`

The model is intentionally simple and explainable. It records the number of graded answers and the last update time. Only assessment evidence changes mastery; asking a question or viewing an answer does not.

When no topic is selected for a new quiz, topics below 60% posterior mean are included in the retrieval query. The progress page recommends revisiting topics below the same threshold. Per-user assessment history and question fingerprints are persisted in SQLite.

## Limits

This is an evidence-weighted estimate, not a validated measure of learning. It does not currently model question difficulty, guessing/slipping, recency, forgetting, prerequisites, confidence intervals, or conversation evidence. Generated topic labels can be inconsistent, and normalized exact question hashes do not detect every semantic duplicate. Do not describe the estimate as measured learning gain. Diagnostic intake and adaptive difficulty selection remain future work.
