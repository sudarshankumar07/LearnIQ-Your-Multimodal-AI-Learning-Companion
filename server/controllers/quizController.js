const quizService = require("../services/quizService");

async function generateQuiz(req, res) {
    const { topic = "", count = 5, difficulty = "mixed", type = "mixed" } = req.body || {};
    const questionCount = Number(count);
    if (typeof topic !== "string" || topic.length > 120 || !Number.isInteger(questionCount) || questionCount < 1 || questionCount > 10 || !["easy", "medium", "hard", "mixed"].includes(difficulty) || !["mcq", "short", "numerical", "mixed"].includes(type)) {
        return res.status(400).json({ message: "Choose a topic (or all topics), 1–10 questions, a valid difficulty, and a valid question type." });
    }
    try {
        return res.json(await quizService.generateQuiz({ topic, count: questionCount, difficulty, type }));
    } catch (err) {
        if (!err.status) console.error("Quiz generation failed:", err.message);
        return res.status(err.status || 500).json({ message: err.status ? err.message : "Could not generate a quiz from the uploaded material." });
    }
}

async function submitQuiz(req, res) {
    try {
        return res.json(await quizService.submitQuiz(req.body || {}));
    } catch (err) {
        if (!err.status) console.error("Quiz submission failed:", err.message);
        return res.status(err.status || 500).json({ message: err.status ? err.message : "Could not grade this quiz." });
    }
}

module.exports = { generateQuiz, submitQuiz };
