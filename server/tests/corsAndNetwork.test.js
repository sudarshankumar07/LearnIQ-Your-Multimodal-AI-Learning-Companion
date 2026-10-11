process.env.LEARNIQ_DB_PATH = ":memory:";
const test = require("node:test");
const assert = require("node:assert/strict");
const { verifyBrowserOrigin } = require("../middleware/auth");
const authController = require("../controllers/authController");

function mockResponse() {
    return {
        statusCode: 200,
        body: null,
        headers: {},
        status(code) { this.statusCode = code; return this; },
        json(val) { this.body = val; return this; },
        setHeader(name, val) { this.headers[name] = val; },
        sendStatus(code) { this.statusCode = code; return this; },
        end() { return this; }
    };
}

test("CORS: allowed origin receives proper CORS headers and credentials flag", () => {
    process.env.APP_ORIGINS = "https://learniq-frontend.onrender.com,http://localhost:5173";
    const req = {
        method: "GET",
        get(header) { return header.toLowerCase() === "origin" ? "https://learniq-frontend.onrender.com" : null; }
    };
    const res = mockResponse();
    let calledNext = false;
    verifyBrowserOrigin(req, res, () => { calledNext = true; });

    assert.equal(calledNext, true);
    assert.equal(res.headers["Access-Control-Allow-Origin"], "https://learniq-frontend.onrender.com");
    assert.equal(res.headers["Access-Control-Allow-Credentials"], "true");
    assert.match(res.headers["Access-Control-Allow-Methods"], /GET/);
    assert.match(res.headers["Access-Control-Allow-Headers"], /Content-Type/);
});

test("CORS: preflight OPTIONS request returns 204 with CORS headers without calling next", () => {
    process.env.APP_ORIGINS = "https://learniq-frontend.onrender.com";
    const req = {
        method: "OPTIONS",
        get(header) { return header.toLowerCase() === "origin" ? "https://learniq-frontend.onrender.com" : null; }
    };
    const res = mockResponse();
    let calledNext = false;
    verifyBrowserOrigin(req, res, () => { calledNext = true; });

    assert.equal(calledNext, false, "OPTIONS should not proceed to subsequent handlers");
    assert.equal(res.statusCode, 204);
    assert.equal(res.headers["Access-Control-Allow-Origin"], "https://learniq-frontend.onrender.com");
    assert.equal(res.headers["Access-Control-Allow-Credentials"], "true");
});

test("CORS: unallowed origin is rejected with 403 Forbidden", () => {
    process.env.APP_ORIGINS = "https://learniq-frontend.onrender.com";
    const req = {
        method: "POST",
        get(header) { return header.toLowerCase() === "origin" ? "https://malicious-site.example.com" : null; }
    };
    const res = mockResponse();
    let calledNext = false;
    verifyBrowserOrigin(req, res, () => { calledNext = true; });

    assert.equal(calledNext, false);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.message, "Request origin is not allowed.");
    assert.equal(res.headers["Access-Control-Allow-Origin"], undefined);
});

test("CORS: normalizes trailing slashes in APP_ORIGINS configuration", () => {
    process.env.APP_ORIGINS = "https://learniq-frontend.onrender.com/";
    const req = {
        method: "GET",
        get(header) { return header.toLowerCase() === "origin" ? "https://learniq-frontend.onrender.com" : null; }
    };
    const res = mockResponse();
    let calledNext = false;
    verifyBrowserOrigin(req, res, () => { calledNext = true; });

    assert.equal(calledNext, true);
    assert.equal(res.headers["Access-Control-Allow-Origin"], "https://learniq-frontend.onrender.com");
});

test("Cookies: production environment sets SameSite=None and Secure for cross-origin hosting", async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    try {
        process.env.NODE_ENV = "production";
        const res = mockResponse();
        await authController.register({ body: { email: `prod_cookie_${Date.now()}@example.com`, password: "a long unique passphrase" } }, res);
        assert.equal(res.statusCode, 201);
        const cookie = res.headers["Set-Cookie"];
        assert.match(cookie, /HttpOnly/);
        assert.match(cookie, /SameSite=None/);
        assert.match(cookie, /Secure/);
    } finally {
        process.env.NODE_ENV = prevNodeEnv;
    }
});

