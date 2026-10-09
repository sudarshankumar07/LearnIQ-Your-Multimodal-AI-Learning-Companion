const express = require("express");
const { askQuestion } = require("../controllers/ragController");

const router = express.Router();
router.post("/", askQuestion);

module.exports = router;
