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
function readToken(req) {
    const cookieToken = readCookie(req.headers?.cookie);
    if (cookieToken && /^[a-f0-9]{64}$/i.test(cookieToken)) return cookieToken;
    const authHeader = req.headers?.authorization || (typeof req.get === "function" ? req.get("authorization") : null);
    if (authHeader && /^Bearer\s+[a-f0-9]{64}$/i.test(authHeader.trim())) {
        return authHeader.trim().slice(7).trim();
    }
    return null;
}
function sessionHash(token) { return createHash("sha256").update(token).digest("hex"); }
async function authenticate(req, res, next) {
    const token = readToken(req);
    if (!token) return res.status(401).json({ message: "Sign in to continue." });
    try {
        const user = await store.findSession(sessionHash(token));
        if (!user) return res.status(401).json({ message: "Your session expired. Sign in again." });
        req.user = user;
        req.sessionTokenHash = sessionHash(token);
        next();
    } catch (err) {
        console.error("Session lookup error:", err.message);
        return res.status(500).json({ message: "Authentication service unavailable." });
    }
}
function getAllowedOrigins() {
    return (process.env.APP_ORIGINS || "http://localhost:5173,http://127.0.0.1:5173")
        .split(",")
        .map(value => value.trim().replace(/\/+$/, ""))
        .filter(Boolean);
}

function verifyBrowserOrigin(req, res, next) {
    const origin = typeof req.get === "function" ? req.get("origin") : (req.headers && req.headers.origin);
    if (!origin) return next();
    const normalizedOrigin = String(origin).trim().replace(/\/+$/, "");
    const configured = getAllowedOrigins();
    if (!configured.includes(normalizedOrigin)) {
        return res.status(403).json({ message: "Request origin is not allowed." });
    }

    if (typeof res.setHeader === "function") {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Access-Control-Allow-Credentials", "true");
        res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With, Accept");
        res.setHeader("Access-Control-Max-Age", "86400");
        res.setHeader("Vary", "Origin");
    }

    if (req.method === "OPTIONS") {
        if (typeof res.sendStatus === "function") return res.sendStatus(204);
        if (typeof res.status === "function") {
            res.status(204);
            if (typeof res.end === "function") return res.end();
            return;
        }
    }
    next();
}
module.exports = { authenticate, verifyBrowserOrigin, readCookie, readToken, sessionHash, COOKIE, getAllowedOrigins };
