require("dotenv").config();

const express = require("express");
const path = require("path");
const methodOverride = require("method-override");
const { setupQdrant } = require("./services/qdrantService");
const uploadRoutes = require("./routes/uploadRoutes");
const ragRoutes = require("./routes/ragRoutes");
const quizRoutes = require("./routes/quizRoutes");

const app = express();
const port = 3000;

app.use(methodOverride("_method"));
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/", (req, res) => res.send("nothing......"));
app.use("/upload", uploadRoutes);
app.use("/ask", ragRoutes);
app.use("/quiz", quizRoutes);

setupQdrant();
app.listen(port, () => {
    console.log(`server is online on port ${port}`);
});
