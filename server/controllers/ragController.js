const { answerQuestion } = require("../services/ragService");

async function askQuestion(req, res) {
    const query = req.body.query;
    if (typeof query !== "string" || !query.trim()) {
        return res.status(400).json({
            success: false,
            message: "Please provide a question in the query field."
        });
    }
    try {
        const answer = await answerQuestion(query);
        console.log(query);
        console.log(answer);
        return res.send(answer);
    } catch (err) {
        console.error("RAG request failed:", err.message);
        return res.status(500).json({ message: "Could not answer from the uploaded material." });
    }
}

module.exports = { askQuestion };
