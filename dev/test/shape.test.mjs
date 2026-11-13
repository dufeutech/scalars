// The 0.3.0 shape of dist/scalars.json: validation under `schema`, a closed `primitive`, no leftovers.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "../build.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { scalars, openapi } = build(root);
const distSchema = JSON.parse(fs.readFileSync(path.join(root, "schema/dist.schema.json"), "utf8"));
const VALIDATION = ["type", "format", "pattern", "minLength", "maxLength", "minimum", "maximum", "contentEncoding"];

function keysDeep(v, out = new Set()) {
    if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { if (!Array.isArray(v)) out.add(k); keysDeep(x, out); }
    return out;
}

test("removed fields are gone everywhere", () => {
    const keys = keysDeep(scalars);
    for (const k of ["category", "check_extra", "templates", "labels"]) assert.ok(!keys.has(k), `dist still has ${k}`);
});

test("validation keys live only under schema", () => {
    for (const t of Object.values(scalars.types)) {
        assert.equal(typeof t.schema, "object", `${t.name} has schema`);
        for (const k of VALIDATION) assert.ok(!(k in t), `${t.name}.${k} is outside schema`);
        for (const k of Object.keys(t.schema)) assert.ok(VALIDATION.includes(k), `${t.name}.schema.${k} is not a validation key`);
    }
    assert.equal(scalars.types.phone.schema.pattern, "^\\+[1-9][0-9]{1,14}$");
    assert.equal(scalars.types.hostname.schema.maxLength, 253);
});

test("openapi is each schema plus its text", () => {
    for (const [n, t] of Object.entries(scalars.types)) {
        const want = { ...t.schema, title: t.label, description: t.hint, examples: t.examples.valid };
        assert.deepEqual(openapi.components.schemas[n], want, n);
    }
});

test("primitive is a closed set of 16", () => {
    const names = distSchema.$defs.type.properties.primitive.enum;
    assert.equal(names.length, 16);
    for (const t of Object.values(scalars.types)) assert.ok(names.includes(t.primitive), `${t.name}: ${t.primitive}`);
});

test("a hand-written postgres check wins", () => {
    assert.match(scalars.types.uint64.postgres.check, /18446744073709551615/);
    assert.match(distSchema.$defs.type.properties.postgres.properties.check.description, /\{column\}/);
});
