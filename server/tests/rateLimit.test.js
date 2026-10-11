const test = require("node:test");
const assert = require("node:assert/strict");
const rateLimit = require("../utils/rateLimit");

function response() {
    return {
        headers: {}, statusCode: 200, body: null,
        set(name, value) { this.headers[name] = value; return this; },
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; }
    };
}

test("rate limit permits up to the configured request count", () => {
    const middleware = rateLimit({ windowMs: 60_000, max: 2 });
    const req = { ip: "test-client-allowed", baseUrl: "/test" };
    let calls = 0;
    middleware(req, response(), () => calls++);
    middleware(req, response(), () => calls++);
    assert.equal(calls, 2);
});

test("rate limit rejects the next request with 429", () => {
    const middleware = rateLimit({ windowMs: 60_000, max: 1 });
    const req = { ip: "test-client-blocked", baseUrl: "/test" };
    middleware(req, response(), () => {});
    const res = response();
    let continued = false;
    middleware(req, res, () => { continued = true; });
    assert.equal(continued, false);
    assert.equal(res.statusCode, 429);
});
