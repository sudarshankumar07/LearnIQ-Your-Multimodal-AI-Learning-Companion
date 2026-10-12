const express = require("express");
const { getProgress } = require("../services/dataStore");
const store = require("../services/dataStore");
const router = express.Router();
router.get("/topics", (req, res) => {
    const documentId = req.query.documentId;
    if (documentId !== undefined && (typeof documentId !== "string" || !/^[0-9a-f-]{36}$/i.test(documentId))) return res.status(400).json({ message: "Choose a valid document." });
    if (documentId && !store.getDocument(req.user.id, documentId)) return res.status(404).json({ message: "Document not found." });
    return res.json(store.getTopicMap(req.user.id, documentId));
});
router.get("/", (req, res) => res.json(getProgress(req.user.id)));
module.exports = router;
