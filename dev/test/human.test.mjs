import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSources, resolve } from "../lib/resolve.mjs";
import { lookup } from "../lib/reference.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const types = resolve(loadSources(root));
const all = Object.values(types);

const JARGON = ["RFC", "ISO", "IANA", "regex", "pattern", "E.164", "octet", "UTC", "string", "integer", "boolean", "null", "JSON"];
const jargonRe = new RegExp(`(^|[^A-Za-z0-9])(${JARGON.map((w) => w.replace(".", "\\.")).join("|")})(?![A-Za-z0-9])`);

test("every type has label, hint and error within limits", () => {
    const bad = [];
    for (const t of all) {
        if (typeof t.label !== "string" || t.label.length === 0 || t.label.length > 32) bad.push(`${t.name}.label`);
        if (typeof t.hint !== "string" || t.hint.length === 0 || t.hint.length > 60) bad.push(`${t.name}.hint`);
        if (typeof t.error !== "string" || t.error.length > 100 || !t.error.endsWith(".")) bad.push(`${t.name}.error`);
    }
    assert.deepEqual(bad, []);
});

test("core text has no jargon", () => {
    const bad = [];
    for (const t of all.filter((x) => x.level === "core")) {
        for (const k of ["label", "hint", "error"]) {
            const m = jargonRe.exec(t[k] ?? "");
            if (m) bad.push(`${t.name}.${k}: ${m[2]}`);
        }
    }
    assert.deepEqual(bad, []);
});

test("errors for rule types show a valid example", () => {
    const bad = all.filter((t) => t.pattern && !t.error?.includes(String(t.examples.valid[0]))).map((t) => t.name);
    assert.deepEqual(bad, []);
});

test("aliases are well formed and unique", () => {
    const seen = new Map();
    const bad = [];
    for (const t of all) {
        for (const a of t.aliases ?? []) {
            if (!/^[a-z][a-z0-9_]*$/.test(a)) bad.push(`${t.name}: bad alias ${a}`);
            if (a in types) bad.push(`${t.name}: alias ${a} is a type name`);
            if (seen.has(a)) bad.push(`${t.name}: alias ${a} also on ${seen.get(a)}`);
            seen.set(a, t.name);
        }
    }
    assert.deepEqual(bad, []);
    for (const [a, name] of [["url", "uri"], ["password", "secret"], ["money", "decimal"], ["colour", "color"], ["tel", "phone"]]) {
        assert.equal(seen.get(a), name, a);
    }
});

test("lookup finds names and aliases", () => {
    assert.equal(lookup(types, "URL").name, "uri");
    assert.equal(lookup(types, "Phone Number").name, "phone");
    assert.equal(lookup(types, "phone-number").name, "phone");
    assert.equal(lookup(types, "time").name, "time");
    assert.equal(lookup(types, "colour").name, "color");
    assert.equal(lookup(types, "  Email ").name, "email");
    assert.equal(lookup(types, "nope"), null);
    assert.equal(lookup(types, "_token"), null, "abstract bases are not types");
});

test("generated html carries title and placeholder", () => {
    const bad = [];
    for (const t of all) {
        const a = t.html?.attrs ?? {};
        if (!a.pattern) continue;
        if (a.title !== t.error) bad.push(`${t.name}.title`);
        if (a.placeholder !== String(t.examples.valid[0])) bad.push(`${t.name}.placeholder`);
    }
    assert.deepEqual(bad, []);
    assert.equal(types.slug.html.attrs.placeholder, "getting-started");
});
