import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSources, resolve } from "../lib/resolve.mjs";
import { normalize } from "../lib/reference.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const types = resolve(loadSources(path.join(root, "src")));
const schema = JSON.parse(fs.readFileSync(path.join(root, "schema/scalar.schema.json"), "utf8"));
const STEPS = schema.$defs.normalize_step.oneOf.map((s) => s.const);

test("cleans messy input", () => {
    assert.equal(normalize(types.iban, " gb82 west 1234 5698 7654 32 "), "GB82WEST12345698765432");
    assert.equal(normalize(types.phone, "+1 415-555-0123"), "+14155550123");
    assert.equal(normalize(types.slug, " Getting-Started "), "getting-started");
    assert.equal(normalize(types.country, " us "), "US");
    assert.equal(normalize(types.isbn, "978-0-306-40615-7"), "9780306406157");
    assert.equal(normalize(types.color, "#1A2B3C"), "#1a2b3c");
    assert.equal(normalize(types.email, "  user@example.com\n"), "user@example.com");
});

test("trim is exactly Unicode White_Space", () => {
    assert.equal(normalize(types.email, "\u0085　a@b.co  "), "a@b.co");
    assert.equal(normalize(types.email, "﻿a@b.co"), "﻿a@b.co", "U+FEFF is not White_Space");
});

test("steps are inherited", () => {
    assert.equal(normalize(types.uuid_v7, " 018F4B2C-9C1E-7A3B-8F2D-1A2B3C4D5E6F "), "018f4b2c-9c1e-7a3b-8f2d-1a2b3c4d5e6f");
});

test("no steps means no change", () => {
    assert.equal(normalize(types.string, " x "), " x ");
    assert.equal(normalize(types.secret, " pa ss "), " pa ss ", "secrets are never altered");
});

test("unknown step throws", () => {
    assert.throws(() => normalize({ name: "x", normalize: ["shout"] }, "a"), /shout/);
});

test("every step in the data is a defined step", () => {
    assert.deepEqual(STEPS, ["trim", "lowercase", "uppercase", "remove_spaces", "remove_hyphens"]);
    const bad = Object.values(types).flatMap((t) => (t.normalize ?? []).filter((s) => !STEPS.includes(s)).map((s) => `${t.name}:${s}`));
    assert.deepEqual(bad, []);
});

test("normalized messy input becomes valid", () => {
    for (const [name, messy] of [["iban", " gb82 west 1234 5698 7654 32 "], ["phone", "+1 415-555-0123"], ["slug", " Getting-Started "], ["country", " us "], ["color", "#1A2B3C"]]) {
        const t = types[name];
        assert.match(normalize(t, messy), new RegExp(t.pattern, "u"), name);
    }
});
