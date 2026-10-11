const { createHash } = require("crypto");
const store = require("../services/dataStore");

const COOKIE = "learniq_session";
function readCookie(header = "", name = COOKIE) {
    for (const part of header.split(";")) {
        const separator = part.indexOf("=");
        if (separator < 0) continue;
        if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
    }
    return null;
}
function sessionHash(token) { return createHash("sha256").update(token).digest("hex"); }
function authenticate(req, res, next) {
    const token = readCookie(req.headers.cookie);
    if (!token || !/^[a-f0-9]{64}$/i.test(token)) return res.status(401).json({ message: "Sign in to continue." });
    const user = store.findSession(sessionHash(token));
    if (!user) return res.status(401).json({ message: "Your session expired. Sign in again." });
    req.user = user;
    req.sessionTokenHash = sessionHash(token);
    next();
}
function verifyBrowserOrigin(req, res, next) {
    const origin = req.get("origin");
    if (!origin) return next();
    const configured = (process.env.APP_ORIGINS || "http://localhost:5173,http://127.0.0.1:5173").split(",").map(value => value.trim()).filter(Boolean);
    if (!configured.includes(origin)) return res.status(403).json({ message: "Request origin is not allowed." });
    next();
}
module.exports = { authenticate, verifyBrowserOrigin, readCookie, sessionHash, COOKIE };
