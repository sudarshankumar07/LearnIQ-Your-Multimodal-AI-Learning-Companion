const quizService = require("../services/quizService");
const store = require("../services/dataStore");

async function generateQuiz(req, res) {
    const { topic = "", count = 5, difficulty = "mixed", type = "mixed", mode = "practice", documentId = "" } = req.body || {};
    const questionCount = Number(count);
    if (typeof topic !== "string" || topic.length > 120 || (documentId && (typeof documentId !== "string" || !/^[0-9a-f-]{36}$/i.test(documentId))) || !Number.isInteger(questionCount) || questionCount < 1 || questionCount > 10 || !["easy", "medium", "hard", "mixed", "adaptive"].includes(difficulty) || !["mcq", "short", "numerical", "mixed"].includes(type) || !["practice", "mock_exam", "diagnostic"].includes(mode)) {
        return res.status(400).json({ message: "Choose a topic (or all topics), 1–10 questions, a valid difficulty, and a valid question type." });
    }
    try {
        if (documentId && !(await store.getDocument(req.user.id, documentId))) return res.status(404).json({ message: "The selected document was not found." });
        return res.json(await quizService.generateQuiz({ userId: req.user.id, topic, count: questionCount, difficulty, type, mode, documentId }));
    } catch (err) {
        if (!err.status) console.error("Quiz generation failed:", err.message);
        return res.status(err.status || 500).json({ message: err.status ? err.message : "Could not generate a quiz from the uploaded material." });
    }
}

async function submitQuiz(req, res) {
    const { quizId, answers } = req.body || {};
    if (typeof quizId !== "string" || !/^[0-9a-f-]{36}$/i.test(quizId) || !Array.isArray(answers) || answers.length < 1 || answers.length > 10 || answers.some(answer => typeof answer !== "string" || answer.length > 2000)) {
        return res.status(400).json({ message: "Submit a valid quiz ID and up to ten answers of 2,000 characters each." });
    }
    try {
        return res.json(await quizService.submitQuiz({ userId: req.user.id, quizId, answers }));
    } catch (err) {
        if (!err.status) console.error("Quiz submission failed:", err.message);
        return res.status(err.status || 500).json({ message: err.status ? err.message : "Could not grade this quiz." });
    }
}

module.exports = { generateQuiz, submitQuiz };
