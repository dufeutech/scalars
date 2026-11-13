// The reference rules pass the same shared cases every language runner checks (dev/langs/cases.json).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "../build.mjs";
import { lookup, normalize, validate } from "../lib/reference.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { types, $meta } = build(root).scalars;
const cases = JSON.parse(fs.readFileSync(path.join(root, "dev/langs/cases.json"), "utf8"));

test("normalize cases", () => {
    for (const c of cases.normalize) assert.equal(normalize({ normalize: c.steps }, c.in), c.out, JSON.stringify(c));
});

test("lookup cases", () => {
    for (const c of cases.lookup) assert.equal(lookup(types, c.in)?.name ?? null, c.out, JSON.stringify(c));
});

test("the written lookup rule names what the reference does", () => {
    assert.match($meta.lookup, /trim step/);
    assert.match($meta.lookup, /each run of spaces and '-'/);
});

test("validate cases", () => {
    for (const c of cases.validate) {
        const v = "special" in c ? Number(c.special) : c.in;
        const r = validate(types[c.type], v);
        assert.equal(r.ok, c.ok, JSON.stringify(c));
        if (c.ok) assert.deepEqual(r.value, c.out, JSON.stringify(c));
    }
});

test("hostile cases", () => {
    for (const c of cases.hostile) {
        const input = c.prefix + c.repeat.repeat(c.count) + c.suffix;
        const start = performance.now();
        const r = validate(types[c.type], input);
        const ms = performance.now() - start;
        assert.equal(r.ok, c.ok, c.type);
        assert.ok(ms < 2000, `${c.type} took ${Math.round(ms)} ms`);
    }
});
