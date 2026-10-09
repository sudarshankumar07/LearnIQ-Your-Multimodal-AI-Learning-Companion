const { randomUUID, createHash } = require("crypto");
const { semanticSearch } = require("./qdrantService");
const { generateContent } = require("./geminiService");

const quizSessions = new Map();
const recentQuestionHashes = new Set();

function parseJsonResponse(response) {
    const text = response.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    return JSON.parse(text);
}

async function generateQuiz({ topic = "", count = 5, difficulty = "mixed", type = "mixed" }) {
    const query = `${topic || "course material"} ${type === "mixed" ? "concepts definitions examples and calculations" : type}`;
    const chunks = await semanticSearch(query, Math.min(15, count * 3));
    const sourceChunks = chunks.filter(c => c.payload?.text && c.payload.pageNumber);
    if (!sourceChunks.length) {
        const error = new Error("No uploaded course material was found for this scope. Upload a relevant PDF first.");
        error.status = 404;
        throw error;
    }
    const context = sourceChunks.map((c, i) => `[S${i + 1}] Source: ${c.payload.source || "Uploaded PDF"}, page ${c.payload.pageNumber}\n${c.payload.text}`).join("\n\n");
    const prompt = `Create exactly ${count} source-grounded assessment questions for topic scope "${topic || "all retrieved topics"}". Requested difficulty: ${difficulty}; type: ${type}. Use only the provided sources. Return JSON only: {"questions":[{"question":"...","type":"mcq|short|numerical","options":[...],"correctAnswer":"...","topic":"...","difficulty":"easy|medium|hard","sourceIndex":1,"explanation":"...","acceptedAnswers":[...],"numericTolerance":0.01}]}. MCQ must have exactly four distinct options and correctAnswer must exactly equal one option. Short answers should have a concise model answer and reasonable accepted variations. Numerical questions need a numeric answer, and only create them where the supplied text provides enough data and a verifiable calculation. Each question must be directly supported by its cited source chunk; sourceIndex must refer to [S#]. Do not invent page references.\n\nSources:\n${context}`;
    let parsed;
    try {
        parsed = parseJsonResponse(await generateContent(prompt));
    } catch {
        const error = new Error("The question generator returned an unreadable response. Please try again.");
        error.status = 502;
        throw error;
    }

    const candidates = Array.isArray(parsed.questions) ? parsed.questions : [];
    const verificationPrompt = `Independently verify each candidate against only its cited source text. Check that the question is answerable from the source, its supplied answer is correct, and the tagged topic/difficulty are reasonable. Do not repair candidates. Return JSON only: {"checks":[{"supported":true,"answerCorrect":true,"topicAndDifficultyValid":true}]}, with one check per candidate in order.\n\n${candidates.map((q, i) => `Candidate ${i + 1}: ${JSON.stringify(q)}\nCited source text: ${sourceChunks[Number(q.sourceIndex) - 1]?.payload?.text || "INVALID SOURCE"}`).join("\n\n")}`;
    let checks;
    try {
        checks = parseJsonResponse(await generateContent(verificationPrompt)).checks;
    } catch {
        const error = new Error("Question verification failed. Please try again.");
        error.status = 502;
        throw error;
    }
    if (!Array.isArray(checks) || checks.length !== candidates.length) {
        const error = new Error("Question verification returned incomplete results. Please try again.");
        error.status = 502;
        throw error;
    }

    const accepted = [];
    for (const [candidateIndex, q] of candidates.entries()) {
        const source = sourceChunks[Number(q.sourceIndex) - 1];
        const question = typeof q.question === "string" ? q.question.trim() : "";
        const answer = typeof q.correctAnswer === "string" ? q.correctAnswer.trim() : "";
        const normalized = question.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
        const hash = createHash("sha256").update(normalized).digest("hex");
        const validType = ["mcq", "short", "numerical"].includes(q.type);
        const validDifficulty = ["easy", "medium", "hard"].includes(q.difficulty);
        const validOptions = q.type !== "mcq" || (Array.isArray(q.options) && q.options.length === 4 && new Set(q.options.map(x => String(x).trim().toLowerCase())).size === 4 && q.options.some(x => String(x).trim() === answer));
        const validAnswer = q.type !== "numerical" || Number.isFinite(Number(answer));
        const matchesSelection = (type === "mixed" || q.type === type) && (difficulty === "mixed" || q.difficulty === difficulty);
        const verified = checks[candidateIndex]?.supported === true && checks[candidateIndex]?.answerCorrect === true && checks[candidateIndex]?.topicAndDifficultyValid === true;
        if (!source || !question || !answer || !validType || !validDifficulty || !validOptions || !validAnswer || !matchesSelection || !verified || !q.topic || !q.explanation || recentQuestionHashes.has(hash) || accepted.some(x => x.hash === hash)) continue;
        accepted.push({ hash, id: randomUUID(), question, type: q.type, options: q.type === "mcq" ? q.options : [], correctAnswer: answer, acceptedAnswers: Array.isArray(q.acceptedAnswers) ? q.acceptedAnswers.map(String) : [], numericTolerance: Number.isFinite(Number(q.numericTolerance)) ? Math.max(0, Math.min(Number(q.numericTolerance), 1)) : 0.01, topic: String(q.topic).slice(0, 100), difficulty: q.difficulty, source: source.payload.source || "Uploaded PDF", page: source.payload.pageNumber, explanation: String(q.explanation).slice(0, 1000) });
    }
    if (accepted.length !== count) {
        const error = new Error(`Only ${accepted.length} of ${count} questions passed validation. Try a broader topic or a different type.`);
        error.status = 422;
        throw error;
    }
    accepted.forEach(q => recentQuestionHashes.add(q.hash));
    if (recentQuestionHashes.size > 1000) recentQuestionHashes.clear();
    const quizId = randomUUID();
    quizSessions.set(quizId, accepted);
    return { quizId, questions: accepted.map(({ correctAnswer, acceptedAnswers, numericTolerance, explanation, ...q }) => q) };
}

async function submitQuiz({ quizId, answers }) {
    const questions = quizSessions.get(quizId);
    if (!questions || !Array.isArray(answers) || answers.length !== questions.length || answers.some(a => typeof a !== "string")) {
        const error = new Error("This quiz submission is invalid or expired.");
        error.status = 400;
        throw error;
    }
    const results = await Promise.all(questions.map(async (q, i) => {
        const answer = answers[i].trim();
        let correct = false;
        if (q.type === "mcq") correct = answer === q.correctAnswer;
        else if (q.type === "numerical") {
            const entered = Number(answer.replace(/,/g, ""));
            correct = Number.isFinite(entered) && Math.abs(entered - Number(q.correctAnswer)) <= q.numericTolerance;
        } else {
            const candidates = [q.correctAnswer, ...q.acceptedAnswers].map(v => v.toLowerCase().trim().replace(/\s+/g, " "));
            const normalized = answer.toLowerCase().trim().replace(/\s+/g, " ");
            if (candidates.includes(normalized)) correct = true;
            else {
                const evaluation = await generateContent(`Decide whether the student's response expresses the same key idea as the reference answer, based only on this source. Return JSON {"correct":true|false}. Source: ${q.explanation}\nReference answer: ${q.correctAnswer}\nStudent response: ${answer}`);
                try { correct = parseJsonResponse(evaluation).correct === true; } catch { correct = false; }
            }
        }
        return { id: q.id, correct, topic: q.topic, correctAnswer: q.correctAnswer, explanation: q.explanation, source: q.source, page: q.page };
    }));
    quizSessions.delete(quizId);
    const topics = Object.values(results.reduce((groups, r) => {
        const g = groups[r.topic] || (groups[r.topic] = { topic: r.topic, correct: 0, total: 0 });
        g.total++;
        if (r.correct) g.correct++;
        return groups;
    }, {})).map(g => ({ ...g, accuracy: Math.round(g.correct / g.total * 100) }));
    const score = results.filter(r => r.correct).length;
    return { score, total: results.length, accuracy: Math.round(score / results.length * 100), topics, weakTopics: topics.filter(t => t.accuracy < 60).map(t => t.topic), results };
}

module.exports = { generateQuiz, submitQuiz };
