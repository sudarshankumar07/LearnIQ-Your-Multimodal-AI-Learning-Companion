
function videoError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function buildVideoChunks(segments) {
    if (!Array.isArray(segments)) throw videoError("INVALID_TRANSCRIPT", "The transcript response was not a segment list.");
    if (segments.length > 20_000) throw videoError("TRANSCRIPT_TOO_MANY_SEGMENTS", "The transcript contains too many segments.");
    const clean = segments.map(segment => {
        const startSeconds = Number(segment?.startSeconds);
        const endSeconds = Number(segment?.endSeconds);
        const text = typeof segment?.text === "string" ? segment.text.replace(/\s+/g, " ").trim() : "";
        if (!text || text.length > 4000 || !Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || startSeconds < 0 || endSeconds <= startSeconds || endSeconds > 86_400) return null;
        return { startSeconds, endSeconds, text };
    }).filter(Boolean).sort((a, b) => a.startSeconds - b.startSeconds);
    const chunks = [];
    let group = [];
    let words = 0;
    for (const segment of clean) {
        const segmentWords = segment.text.split(/\s+/).length;
        if (group.length && words + segmentWords > 220) {
            chunks.push({ text: group.map(item => item.text).join(" "), startSeconds: group[0].startSeconds, endSeconds: group.at(-1).endSeconds, chunkIndex: chunks.length });
            group = [];
            words = 0;
        }
        group.push(segment);
        words += segmentWords;
    }
    if (group.length) chunks.push({ text: group.map(item => item.text).join(" "), startSeconds: group[0].startSeconds, endSeconds: group.at(-1).endSeconds, chunkIndex: chunks.length });
    if (!chunks.length) {
        const hasTranscriptText = segments.some(segment => typeof segment?.text === "string" && segment.text.trim());
        if (!hasTranscriptText) throw videoError("NO_SPEECH_TRANSCRIPT", "No usable spoken narration was found in this video.");
        throw videoError("INVALID_TRANSCRIPT_SEGMENTS", "The transcript contained text without usable timestamps.");
    }
    if (chunks.length > 1200) throw videoError("VIDEO_TOO_LONG", "This lecture is too long to index in one upload.");
    return chunks;
}

function sanitizeDiagnostic(value) {
    return String(value || "")
        .replace(/raw response content:[\s\S]*/i, "raw response content: [REDACTED]")
        .replace(/\bBearer\s+[^\s,;"']+/gi, "Bearer [REDACTED]")
        .replace(/\beyJ[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/g, "[REDACTED]")
        .replace(/\b(api[_ -]?key|authorization|cookie|session|access[_ -]?token|token|secret|password)(["']?\s*[:=]\s*["']?)[^\s,;"'}]+/gi, "$1$2[REDACTED]")
        .replace(/(prompt|contents?|source(?:Text)?|document(?:Text)?|transcript|fileData)\s*[:=]\s*(?:"(?:\\.|[^"\\])*"|'[^']*'|[^\r\n]*)/gi, "$1=[REDACTED]")
        .replace(/https?:\/\/[^\s"'<>]+/gi, rawUrl => {
            try { const parsed = new URL(rawUrl.replace(/[),.;]+$/, "")); return `${parsed.protocol}//${parsed.hostname}`; }
            catch { return "[URL REDACTED]"; }
        })
        .replace(/\b[A-Za-z0-9+/_=-]{40,}\b/g, "[REDACTED]")
        .replace(/"[^"\r\n]{120,}"/g, "\"[REDACTED]\"")
        .slice(0, 1000);
}

function logVideoFailure(stage, error) {
    if (process.env.NODE_ENV !== "development") return;
    try {
        const status = [error?.status, error?.statusCode, error?.response?.status, error?.response?.statusCode]
            .find(value => Number.isInteger(value)) ?? null;
        const code = typeof error?.code === "string" && /^[a-z0-9_.-]{1,80}$/i.test(error.code) ? error.code : null;
        const stackFrames = typeof error?.stack === "string" ? error.stack.split("\n").slice(1, 8).join("\n") : "";
        console.error(JSON.stringify({
            event: "video_processing_failed",
            stage,
            exceptionClass: sanitizeDiagnostic(error?.constructor?.name || error?.name || "Error"),
            exceptionName: sanitizeDiagnostic(error?.name || "Error"),
            errorMessage: sanitizeDiagnostic(error?.message),
            providerStatus: status,
            providerCode: code,
            stackFrames: sanitizeDiagnostic(stackFrames)
        }));
    } catch { /* diagnostics must not interrupt video failure cleanup */ }
}

async function processVideo(filePath, sourceName, mimeType, { documentId, ownerId }) {
    let stage = "transcription";
    try {
        const { indexChunks } = require("./indexChunksService");
        const { transcribeVideo } = require("./geminiService");
        const segments = await transcribeVideo(filePath, mimeType);
        stage = "transcript_validation";
        const chunks = buildVideoChunks(segments);
        stage = "indexing";
        const indexed = await indexChunks({ chunks, sourceName, sourceType: "video", documentId, ownerId });
        const durationSeconds = Math.ceil(Math.max(...chunks.map(chunk => chunk.endSeconds)));
        return { ...indexed, pages: durationSeconds, durationSeconds };
    } catch (error) {
        logVideoFailure(stage, error);
        if (error.code === "NO_SPEECH_TRANSCRIPT") {
            return {
                success: false,
                type: error.code,
                message: "No usable spoken narration was found. Video uploads currently index speech transcripts; on-screen text cards are not extracted. Upload a narrated video or add the text cards as a PDF or PPTX."
            };
        }
        if (error.code === "VIDEO_TOO_LONG") {
            return { success: false, type: error.code, message: "This lecture is too long to index in one upload. Split it into shorter videos and retry." };
        }
        if (error.code === "TRANSCRIPT_TOO_MANY_SEGMENTS") {
            return { success: false, type: error.code, message: "The transcript exceeded the supported segment limit. Shorten the video and retry." };
        }
        const type = stage === "transcription" ? "VIDEO_TRANSCRIPTION_FAILED" : stage === "transcript_validation" ? "INVALID_VIDEO_TRANSCRIPT" : "VIDEO_INDEXING_FAILED";
        return {
            success: false,
            type,
            message: stage === "transcription"
                ? "Video transcription failed before indexing. Retry with a supported MP4, MOV, or WebM video; if it persists, check the server diagnostic."
                : stage === "transcript_validation"
                    ? "The video transcription could not be validated. Retry the upload; if it persists, check the server diagnostic."
                    : "The video transcript could not be indexed. Check the embedding and vector-search services, then retry."
        };
    }
}

module.exports = { processVideo, buildVideoChunks };
