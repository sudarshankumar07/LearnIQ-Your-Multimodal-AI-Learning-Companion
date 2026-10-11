process.env.LEARNIQ_DB_PATH = ":memory:";
const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");

const qdrantPath = require.resolve("../services/qdrantService");
const geminiPath = require.resolve("../services/geminiService");
let generatedQuestion = "Which phrase describes a variable?";
let semanticNovel = true;
let misconceptionResponse = { findings: [] };
let prompts = [];
const learner = { id: randomUUID(), email: randomUUID() + "@example.edu" };
const documentId = randomUUID();
require.cache[qdrantPath] = {
    id: qdrantPath,
    filename: qdrantPath,
    loaded: true,
    exports: {
        semanticSearch: async (_query, _limit, ownerId) => {
            assert.equal(ownerId, learner.id);
            return [{ id: "point-1", score: 0.9, payload: { text: "A variable is a symbol used to represent an unknown value.", source: "algebra.pdf", sourceType: "pdf", documentId, ownerId, pageNumber: 1, topicIds: ["topic-variable"] } }];
        }
    }
};
require.cache[geminiPath] = {
    id: geminiPath,
    filename: geminiPath,
    loaded: true,
    exports: {
        generateContent: async prompt => {
            prompts.push(prompt);
            if (prompt.startsWith("Review only these repeated incorrect responses")) return { text: JSON.stringify(misconceptionResponse) };
            if (prompt.startsWith("Create exactly")) {
                const difficulty = /Requested difficulty: (easy|medium|hard)/.exec(prompt)?.[1] || "easy";
                return { text: JSON.stringify({ questions: [{ question: generatedQuestion, type: "mcq", options: ["A symbol for an unknown value", "A fixed equation", "A page number", "A graph"], correctAnswer: "A symbol for an unknown value", topic: "Variables", difficulty, sourceIndex: 1, explanation: "The source defines a variable as a symbol for an unknown value." }] }) };
            }
            return { text: JSON.stringify({ checks: [{ supported: true, answerCorrect: true, topicAndDifficultyValid: true, semanticallyNovel: semanticNovel }] }) };
        }
    }
};
const store = require("../services/dataStore");
const { generateQuiz, submitQuiz } = require("../services/quizService");
store.createUser({ ...learner, salt: "salt", passwordHash: "hash" });
store.createDocument({ id: documentId, userId: learner.id, title: "algebra.pdf", storagePath: "private.pdf", pages: 1 });

test("diagnostic and mock-exam modes persist, adapt difficulty, and check semantic novelty", async () => {
    const diagnostic = await generateQuiz({ userId: learner.id, mode: "diagnostic", count: 1, difficulty: "adaptive", type: "mcq" });
    assert.equal(diagnostic.mode, "diagnostic");
    assert.match(diagnostic.personalizationReason, /not yet enough observed assessment evidence/i);
    const outcome = await submitQuiz({ userId: learner.id, quizId: diagnostic.quizId, answers: ["A symbol for an unknown value"] });
    assert.equal(outcome.score, 1);
    assert.equal(outcome.mode, "diagnostic");
    assert.equal(store.getProgress(learner.id).assessments[0].mode, "diagnostic");
    await assert.rejects(generateQuiz({ userId: learner.id, mode: "diagnostic", count: 1, type: "mcq" }), error => error.status === 409);

    generatedQuestion = "Why is a variable useful?";
    const secondPractice = await generateQuiz({ userId: learner.id, mode: "practice", topic: "Variables", count: 1, difficulty: "adaptive", type: "mcq" });
    await submitQuiz({ userId: learner.id, quizId: secondPractice.quizId, answers: ["A symbol for an unknown value"] });

    generatedQuestion = "What does a variable represent?";
    const mockExam = await generateQuiz({ userId: learner.id, mode: "mock_exam", topic: "Variables", count: 1, difficulty: "adaptive", type: "mcq" });
    assert.equal(mockExam.mode, "mock_exam");
    assert.match(mockExam.personalizationReason, /100% observed accuracy/);
    assert.match(prompts.at(-1), /Why is a variable useful\?/);

    generatedQuestion = "Which item stands for an unknown quantity?";
    semanticNovel = false;
    await assert.rejects(generateQuiz({ userId: learner.id, mode: "practice", count: 1, difficulty: "mixed", type: "mcq" }), error => error.status === 422);
    assert.equal(store.getProgress(learner.id).assessments.length, 2, "rejected duplicate must not create an assessment");
});

test("numerical and short-answer grading persist results without inferring misconceptions", async () => {
    const numericalId = randomUUID();
    store.saveGeneratedQuiz(numericalId, learner.id, [{ hash: "num-fingerprint", id: randomUUID(), type: "numerical", mode: "practice", topic: "Ratios", correctAnswer: "1.5", numericTolerance: 0.01, explanation: "The ratio is 1.5.", source: "algebra.pdf", documentId, sourceType: "pdf", locationType: "page", locationNumber: 1 }], Date.now() + 60_000);
    const numerical = await submitQuiz({ userId: learner.id, quizId: numericalId, answers: ["1.50"] });
    assert.equal(numerical.results[0].correct, true);

    const shortId = randomUUID();
    store.saveGeneratedQuiz(shortId, learner.id, [{ hash: "short-fingerprint", id: randomUUID(), type: "short", mode: "practice", topic: "Variables", correctAnswer: "An unknown value", acceptedAnswers: ["a value not yet known"], explanation: "A variable represents an unknown value.", source: "algebra.pdf", documentId, sourceType: "pdf", locationType: "page", locationNumber: 1 }], Date.now() + 60_000);
    const short = await submitQuiz({ userId: learner.id, quizId: shortId, answers: ["a value not yet known"] });
    assert.equal(short.results[0].correct, true);
});

test("misconception reporting requires repeated wrong answers and exact source evidence", async () => {
    const singleId = randomUUID();
    const single = { hash: "single-misconception", id: randomUUID(), question: "What does x represent?", type: "mcq", mode: "practice", topic: "Variables", options: ["unknown", "fixed"], correctAnswer: "unknown", explanation: "A variable can represent an unknown value.", sourceEvidence: "A variable represents an unknown value.", source: "algebra.pdf", documentId, sourceType: "pdf", locationType: "page", locationNumber: 1 };
    store.saveGeneratedQuiz(singleId, learner.id, [single], Date.now() + 60_000);
    const before = prompts.length;
    const oneWrong = await submitQuiz({ userId: learner.id, quizId: singleId, answers: ["fixed"] });
    assert.deepEqual(oneWrong.possibleMisconceptions, []);
    assert.equal(prompts.length, before, "a single error must not trigger misconception analysis");

    const pairId = randomUUID();
    const pair = ["Which quantity is represented by x?", "What is a variable used to stand for?"].map((question, index) => ({
        hash: "pair-misconception-" + index,
        id: "question-" + index,
        question,
        type: "mcq",
        mode: "practice",
        topic: "Variables",
        options: ["unknown", "fixed"],
        correctAnswer: "unknown",
        explanation: "A variable can represent an unknown value.",
        sourceEvidence: "A variable represents an unknown value.",
        source: "algebra.pdf",
        documentId,
        sourceType: "pdf",
        locationType: "page",
        locationNumber: 1
    }));
    store.saveGeneratedQuiz(pairId, learner.id, pair, Date.now() + 60_000);
    misconceptionResponse = { findings: [{ topic: "Variables", statement: "The learner may be treating a variable as a fixed value.", confidence: 0.86, questionIds: ["question-0", "question-1"], evidence: "A variable represents an unknown value." }] };
    const repeated = await submitQuiz({ userId: learner.id, quizId: pairId, answers: ["fixed", "fixed"] });
    assert.equal(repeated.possibleMisconceptions.length, 1);
    assert.equal(repeated.possibleMisconceptions[0].questionIds.length, 2);
    assert.equal(store.getProgress(learner.id).assessments[0].possibleMisconceptions.length, 1);
});

test("adaptive practice uses strong observed history when a learner has no weak topics", async () => {
    store.recordAssessment({ id: randomUUID(), userId: learner.id, score: 30, total: 30, accuracy: 100, topics: [{ topic: "Variables", correct: 30, total: 30, accuracy: 100 }], results: Array.from({ length: 30 }, () => ({ topic: "Variables", correct: true })) });
    generatedQuestion = "Which expression describes the mastered topic?";
    semanticNovel = true;
    const quiz = await generateQuiz({ userId: learner.id, count: 1, difficulty: "adaptive", type: "mcq" });
    assert.equal(quiz.questions[0].difficulty, "hard");
    assert.match(quiz.personalizationReason, /graded answer\(s\) and (?:8\d|9\d|100)% observed accuracy/i);
    assert.match(quiz.personalizationReason, /all tracked topics/i);
});
