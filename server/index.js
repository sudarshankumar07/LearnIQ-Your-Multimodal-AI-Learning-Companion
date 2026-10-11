const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const express = require("express");
const methodOverride = require("method-override");
const { setupQdrant } = require("./services/qdrantService");
const uploadRoutes = require("./routes/uploadRoutes");
const ragRoutes = require("./routes/ragRoutes");
const quizRoutes = require("./routes/quizRoutes");
const authRoutes = require("./routes/authRoutes");
const progressRoutes = require("./routes/progressRoutes");
const rateLimit = require("./utils/rateLimit");
const { authenticate, verifyBrowserOrigin } = require("./middleware/auth");

const app = express();
const port = 3000;

app.use(verifyBrowserOrigin);
app.use(methodOverride("_method"));
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json({ limit: "32kb" }));
app.use(express.urlencoded({ extended: true }));

app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.get("/", (_req, res) => res.json({ name: "LearnIQ API", status: "ok", message: "LearnIQ API server is online." }));

app.use("/auth", rateLimit({ windowMs: 60_000, max: 10 }), authRoutes);
app.post("/upload", rateLimit({ windowMs: 60_000, max: 5 }), authenticate, uploadRoutes);
app.use("/upload", authenticate, uploadRoutes);
app.use("/ask", rateLimit({ windowMs: 60_000, max: 20 }), authenticate, ragRoutes);
app.use("/quiz", rateLimit({ windowMs: 60_000, max: 10 }), authenticate, quizRoutes);
app.use("/progress", authenticate, progressRoutes);

app.use((_req, res) => {
    res.status(404).json({ message: "Route not found." });
});

app.use((err, _req, res, _next) => {
    if (err instanceof require("multer").MulterError) return res.status(err.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ message: "Upload one supported PDF, PPTX, MP4, MOV, or WebM file. Video files are limited to 100 MB; PDF and PPTX files are limited to 20 MB." });
    const status = Number.isInteger(err?.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
    console.error("Unhandled request error:", err?.message || err);
    return res.status(status).json({ message: status === 400 ? "Invalid request format." : "Request failed." });
});

(async () => {
    try {
        await setupQdrant();
    } catch (error) {
        console.error("Qdrant setup warning on startup:", error?.message || error);
    }
    const serverPort = Number(process.env.PORT) || port;
    app.listen(serverPort, () => {
        console.log(`server is online on port ${serverPort}`);
    });
})();

module.exports = app;
