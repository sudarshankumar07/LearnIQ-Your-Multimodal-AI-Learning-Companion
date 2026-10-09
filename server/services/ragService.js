const { semanticSearch } = require("./qdrantService");
const { generateContent } = require("./geminiService");

async function answerQuestion(query) {
    const relevantChunks = await semanticSearch(query, 3);
    const context = relevantChunks
        .map(chunk => `[Page ${chunk.payload.pageNumber}]\n${chunk.payload.text}`)
        .join("\n\n");
    const response = await generateContent(`Use only the provided PDF context.
                        When giving information from the context, mention the relevant page.
                        If the answer is not present in the context, say that the document does
                        not contain enough information to answer it.: ${query}, ${context}`);
    return response.text;
}

module.exports = { answerQuestion };
