const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "../..");

test("local environment files are ignored and not tracked as distributable source", () => {
    for (const file of ["server/.env", ".env"]) {
        assert.throws(() => execFileSync("git", ["ls-files", "--error-unmatch", "--", file], { cwd: root, stdio: "ignore" }));
        assert.doesNotThrow(() => execFileSync("git", ["check-ignore", "-q", file], { cwd: root, stdio: "ignore" }));
    }
    const trackedSources = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).split(/\r?\n/);
    assert.ok(!trackedSources.some(file => /(^|\/)\.env($|\.)/.test(file) && !file.endsWith(".env.example")));
    assert.ok(fs.existsSync(path.join(root, "server/.env.example")));
});
