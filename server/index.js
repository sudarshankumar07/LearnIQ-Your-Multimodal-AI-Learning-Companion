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

app.use(methodOverride("_method"));
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json({ limit: "32kb" }));
app.use(express.urlencoded({ extended: true }));
app.use(verifyBrowserOrigin);
app.use("/auth", rateLimit({ windowMs: 60_000, max: 10 }), authRoutes);
app.post("/upload", rateLimit({ windowMs: 60_000, max: 5 }), authenticate, uploadRoutes);
app.use("/upload", authenticate, uploadRoutes);
app.use("/ask", rateLimit({ windowMs: 60_000, max: 20 }), authenticate, ragRoutes);
app.use("/quiz", rateLimit({ windowMs: 60_000, max: 10 }), authenticate, quizRoutes);
app.use("/progress", authenticate, progressRoutes);

app.get("/", (req, res) => res.send("nothing......"));

app.use((err, _req, res, _next) => {
    if (err instanceof require("multer").MulterError) return res.status(err.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ message: "Upload one supported PDF, PPTX, MP4, MOV, or WebM file. Video files are limited to 100 MB; PDF and PPTX files are limited to 20 MB." });
    console.error("Unhandled request error:", err.message);
    return res.status(500).json({ message: "Request failed." });
});
(async () => {
    await setupQdrant();
    app.listen(Number(process.env.PORT) || port, () => {
        console.log(`server is online on port ${Number(process.env.PORT) || port}`);
    });
})();
