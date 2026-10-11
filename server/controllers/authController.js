const { randomBytes, randomUUID, scrypt, timingSafeEqual, createHash } = require("crypto");
const { promisify } = require("util");
const store = require("../services/dataStore");
const { readCookie, sessionHash, COOKIE } = require("../middleware/auth");
const scryptAsync = promisify(scrypt);
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;

async function derivePassword(password, salt) {
    return scryptAsync(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}
function setSessionCookie(res, token) {
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    res.setHeader("Set-Cookie", `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MS / 1000}${secure}`);
}
function clearSessionCookie(res) {
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`);
}
async function createSession(res, user) {
    const token = randomBytes(32).toString("hex");
    store.saveSession(sessionHash(token), user.id, Date.now() + SESSION_MS);
    setSessionCookie(res, token);
    return { id: user.id, email: user.email };
}
function validCredentials(email, password) {
    return typeof email === "string" && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && typeof password === "string" && password.length >= 12 && password.length <= 128;
}
async function register(req, res) {
    const { email, password } = req.body || {};
    if (!validCredentials(email, password)) return res.status(400).json({ message: "Enter a valid email and a password between 12 and 128 characters." });
    const normalizedEmail = email.trim().toLowerCase();
    const salt = randomBytes(16).toString("hex");
    try {
        const passwordHash = (await derivePassword(password, salt)).toString("hex");
        const user = { id: randomUUID(), email: normalizedEmail };
        store.createUser({ ...user, salt, passwordHash });
        return res.status(201).json({ user: await createSession(res, user) });
    } catch (error) {
        if (String(error.code).startsWith("SQLITE_CONSTRAINT")) return res.status(409).json({ message: "An account with that email already exists." });
        console.error("Account creation failed:", error.message);
        return res.status(500).json({ message: "Could not create the account." });
    }
}
async function login(req, res) {
    const { email, password } = req.body || {};
    if (typeof email !== "string" || email.length > 254 || typeof password !== "string" || password.length > 128) return res.status(400).json({ message: "Enter your email and password." });
    try {
        const user = store.findUserByEmail(email.trim().toLowerCase());
        const salt = user?.salt || "00000000000000000000000000000000";
        const actualHash = await derivePassword(password, salt);
        const expectedHash = user ? Buffer.from(user.passwordHash, "hex") : Buffer.alloc(64);
        if (!user || expectedHash.length !== actualHash.length || !timingSafeEqual(expectedHash, actualHash)) return res.status(401).json({ message: "Email or password is incorrect." });
        return res.json({ user: await createSession(res, user) });
    } catch (error) {
        console.error("Sign-in failed:", error.message);
        return res.status(500).json({ message: "Could not sign in." });
    }
}
function me(req, res) { res.json({ user: req.user }); }
function logout(req, res) {
    const token = readCookie(req.headers.cookie);
    if (token) store.deleteSession(createHash("sha256").update(token).digest("hex"));
    clearSessionCookie(res);
    return res.json({ success: true });
}
module.exports = { register, login, me, logout };
