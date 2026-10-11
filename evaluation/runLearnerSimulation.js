process.env.LEARNIQ_DB_PATH = ":memory:";

const fs = require("fs/promises");
const path = require("path");
const { randomUUID } = require("crypto");

const qdrantPath = require.resolve("../server/services/qdrantService");
const geminiPath = require.resolve("../server/services/geminiService");
let questionNumber = 0;
const documentByUser = new Map();
const sourceText = "For the equation x + 2 = 5, subtract 2 from both sides to find x = 3.";

require.cache[qdrantPath] = {
    id: qdrantPath,
    filename: qdrantPath,
    loaded: true,
    exports: {
        semanticSearch: async (_query, _limit, ownerId) => [{
            id: `simulation-point-${ownerId}`,
            score: 1,
            payload: { documentId: documentByUser.get(ownerId), ownerId, source: "Simulation source.pdf", sourceType: "pdf", pageNumber: 1, text: sourceText, topicIds: ["simulation-algebra"] }
        }]
    }
};
require.cache[geminiPath] = {
    id: geminiPath,
    filename: geminiPath,
    loaded: true,
    exports: {
        generateContent: async prompt => {
            if (prompt.startsWith("Create exactly")) {
                const count = Number(/Create exactly (\d+)/.exec(prompt)?.[1] || 1);
                const requestedDifficulty = /Requested difficulty: (easy|medium|hard)/.exec(prompt)?.[1] || "medium";
                const questions = Array.from({ length: count }, () => {
                    questionNumber += 1;
                    return {
                        question: `Simulation item ${questionNumber}: which value solves x + 2 = 5?`,
                        type: "mcq",
                        options: ["3", "5", "7", "2"],
                        correctAnswer: "3",
                        topic: "Algebra",
                        difficulty: requestedDifficulty,
                        sourceIndex: 1,
                        explanation: "Subtracting 2 from both sides gives x = 3."
                    };
                });
                return { text: JSON.stringify({ questions }) };
            }
            if (prompt.startsWith("Independently verify each candidate")) {
                const count = [...prompt.matchAll(/\nCandidate \d+:/g)].length;
                return { text: JSON.stringify({ checks: Array.from({ length: count }, () => ({ supported: true, answerCorrect: true, topicAndDifficultyValid: true, semanticallyNovel: true })) }) };
            }
            if (prompt.startsWith("Review only these repeated incorrect responses")) return { text: JSON.stringify({ findings: [] }) };
            return { text: JSON.stringify({ correct: false }) };
        }
    }
};

const store = require("../server/services/dataStore");
const { generateQuiz, submitQuiz } = require("../server/services/quizService");

const profiles = [
    { label: "simulated-novice", baselineCorrect: 0, sessionCorrect: [1, 2, 3] },
    { label: "simulated-developing", baselineCorrect: 2, sessionCorrect: [3, 4, 4] },
    { label: "simulated-advanced", baselineCorrect: 4, sessionCorrect: [5, 5, 5] }
];

async function run() {
    const startedAt = new Date().toISOString();
    const outcomes = [];
    const learnerIds = [];
    for (const profile of profiles) {
        const userId = randomUUID();
        learnerIds.push(userId);
        const documentId = randomUUID();
        documentByUser.set(userId, documentId);
        store.createUser({ id: userId, email: `${userId}@simulation.invalid`, salt: "simulation-salt", passwordHash: "simulation-hash" });
        store.createDocument({ id: documentId, userId, title: "Simulation source.pdf", storagePath: "not-persisted", pages: 1 });
        const baselineResults = Array.from({ length: 4 }, (_, index) => ({ topic: "Algebra", correct: index < profile.baselineCorrect }));
        store.recordAssessment({ id: randomUUID(), userId, score: profile.baselineCorrect, total: 4, accuracy: profile.baselineCorrect * 25, topics: [{ topic: "Algebra", correct: profile.baselineCorrect, total: 4, accuracy: profile.baselineCorrect * 25 }], results: baselineResults, mode: "simulation_baseline" });
        const initialMastery = store.getMastery(userId).find(topic => topic.topic === "Algebra");
        const sessions = [];
        const allQuestionTexts = [];

        for (let sessionIndex = 0; sessionIndex < profile.sessionCorrect.length; sessionIndex++) {
            const masteryBefore = store.getMastery(userId);
            const recommendedPracticeTopics = masteryBefore.filter(topic => topic.mastery < 60).map(topic => topic.topic);
            const scopeMastery = recommendedPracticeTopics.length ? masteryBefore.filter(topic => recommendedPracticeTopics.includes(topic.topic)) : masteryBefore;
            const observedAttempts = scopeMastery.reduce((sum, topic) => sum + topic.attempts, 0);
            const observedAccuracy = observedAttempts ? Math.round(scopeMastery.reduce((sum, topic) => sum + topic.alpha - 1, 0) / observedAttempts * 100) : null;
            const expectedDifficulty = observedAttempts < 2 ? "easy" : observedAccuracy < 45 ? "easy" : observedAccuracy >= 80 ? "hard" : "medium";
            const quiz = await generateQuiz({ userId, count: 5, difficulty: "adaptive", type: "mcq", mode: "practice" });
            const questions = quiz.questions;
            allQuestionTexts.push(...questions.map(question => question.question));
            const correctCount = profile.sessionCorrect[sessionIndex];
            const answers = questions.map((_, index) => index < correctCount ? "3" : "5");
            const report = await submitQuiz({ userId, quizId: quiz.quizId, answers });
            const masteryAfter = store.getMastery(userId).find(topic => topic.topic === "Algebra");
            let duplicateRejected = false;
            try { await submitQuiz({ userId, quizId: quiz.quizId, answers }); }
            catch (error) { duplicateRejected = error.status === 400; }
            sessions.push({
                session: sessionIndex + 1,
                assessmentScore: report.score,
                assessmentTotal: report.total,
                observedAccuracy: report.accuracy,
                difficultySelected: questions[0]?.difficulty,
                difficultyMatchesObservedEvidence: questions.every(question => question.difficulty === expectedDifficulty),
                recommendationReason: quiz.personalizationReason,
                recommendedPracticeTopics,
                recommendationValid: recommendedPracticeTopics.every(name => masteryBefore.some(topic => topic.topic === name && topic.mastery < 60)),
                weakTopics: report.weakTopics,
                masteryEstimateAfter: masteryAfter?.mastery,
                duplicateSubmissionRejected: duplicateRejected
            });
        }
        const exactDuplicateCount = allQuestionTexts.length - new Set(allQuestionTexts.map(text => text.toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim())).size;
        outcomes.push({
            profile: profile.label,
            startingEvidence: `${profile.baselineCorrect}/4 deterministic baseline answers`,
            initialTopicEstimate: { topic: initialMastery.topic, masteryPercent: initialMastery.mastery, attempts: initialMastery.attempts },
            sessions,
            finalTopicEstimate: store.getMastery(userId).find(topic => topic.topic === "Algebra"),
            questionCount: allQuestionTexts.length,
            exactQuestionRepeatRate: allQuestionTexts.length ? exactDuplicateCount / allQuestionTexts.length : 0,
            semanticQuestionRepeatRate: null,
            duplicateEventProtection: sessions.every(session => session.duplicateSubmissionRejected)
        });
    }

    const learnerProgress = learnerIds.map(userId => store.getProgress(userId));
    const crossLearnerIsolation = learnerProgress.every(progress => progress.assessments.length === 4 && progress.mastery.length === 1)
        && learnerProgress.every((progress, index) => learnerProgress.every((other, otherIndex) => index === otherIndex || progress.assessments.every(assessment => other.assessments.every(otherAssessment => assessment.id !== otherAssessment.id))));
    const report = {
        simulationId: "learniq-assessment-model-simulation",
        simulationVersion: "1.0.0",
        startedAt,
        completedAt: new Date().toISOString(),
        learnerCount: outcomes.length,
        sessionsPerLearner: 3,
        execution: "Actual LearnIQ generateQuiz, submitQuiz, and SQLite learner-model code; deterministic Gemini and Qdrant boundary responses; in-memory SQLite.",
        profiles: outcomes,
        crossLearnerIsolation,
        aggregate: {
            totalPracticeSessions: outcomes.reduce((sum, outcome) => sum + outcome.sessions.length, 0),
            meanStartingEstimate: outcomes.reduce((sum, outcome) => sum + outcome.initialTopicEstimate.masteryPercent, 0) / outcomes.length,
            meanFinalEstimate: outcomes.reduce((sum, outcome) => sum + outcome.finalTopicEstimate.mastery, 0) / outcomes.length,
            duplicateEventProtectionPass: outcomes.every(outcome => outcome.duplicateEventProtection),
            invalidRecommendationCount: outcomes.reduce((sum, outcome) => sum + outcome.sessions.filter(session => !session.recommendationValid || !session.difficultyMatchesObservedEvidence).length, 0),
            exactQuestionRepeatRate: outcomes.reduce((sum, outcome) => sum + outcome.exactQuestionRepeatRate, 0) / outcomes.length,
            semanticQuestionRepeatRate: null
        },
        limitations: [
            "This deterministic simulation is not a live-provider experiment or a real learner outcome.",
            "Question generation, verification, semantic novelty judgments, and retrieval are mocked at provider boundaries.",
            "Semantic paraphrase repeat rate is null because no live evaluator or manually labeled paraphrase set was used.",
            "Mastery values are observed correctness estimates, not learning gains or retention measures."
        ]
    };
    const outputDirectory = path.join(__dirname, "results");
    await fs.mkdir(outputDirectory, { recursive: true });
    const outputPath = path.join(outputDirectory, `learner-simulation-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
    console.log(`Completed ${report.aggregate.totalPracticeSessions} deterministic LearnIQ simulation sessions across ${outcomes.length} profiles.`);
    console.log(`Machine-readable report: ${path.relative(process.cwd(), outputPath)}`);
    return report;
}

if (require.main === module) run().catch(error => {
    console.error(`Simulation failed: ${error.message}`);
    process.exitCode = 1;
});

module.exports = { run };
