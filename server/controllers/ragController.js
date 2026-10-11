const { answerQuestion } = require("../services/ragService");

async function askQuestion(req, res) {
    const query = req.body.query;
    if (typeof query !== "string" || !query.trim() || query.length > 2000) {
        return res.status(400).json({
            success: false,
            message: "Please provide a question in the query field."
        });
    }
    try {
        const language = req.body.language || "en";
        if (!["en", "hi", "hn"].includes(language)) return res.status(400).json({ success: false, message: "Choose English, Hindi, or Hinglish." });
        const answer = await answerQuestion(query, language, req.user.id);
        return res.json(answer);
    } catch (err) {
        console.error(JSON.stringify({
            event: "rag_request_failed",
            stage: err.ragStage || "request",
            category: err.code || "PROVIDER_OR_RETRIEVAL_FAILURE"
        }));
        if (err.code === "SERVICE_NOT_CONFIGURED") return res.status(503).json({ message: err.message });
        return res.status(500).json({ message: "Could not answer from the uploaded material." });
    }
}

module.exports = { askQuestion };
