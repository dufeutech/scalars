import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { build, serialize } from "../build.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const out = build(root);
const ajv = () => new Ajv2020({ allErrors: true, strict: false, validateFormats: false });

/** Every object key anywhere in a value. */
function keys(v, acc = new Set()) {
    if (Array.isArray(v)) v.forEach((x) => keys(x, acc));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { acc.add(k); keys(x, acc); }
    return acc;
}

test("scalars has every type and validates against the dist schema", () => {
    assert.equal(Object.keys(out.scalars.types).length, 88);
    assert.equal(out.scalars.version, "0.2.0");
    const validate = ajv().compile(JSON.parse(fs.readFileSync(path.join(root, "schema/dist.schema.json"), "utf8")));
    assert.ok(validate(out.scalars), JSON.stringify(validate.errors?.slice(0, 3)));
});

test("dist is self-contained", () => {
    for (const k of ["base", "abstract", "anchor", "docs", "check_extra"]) {
        assert.ok(!keys(out.scalars.types).has(k), `found source-only key ${k}`);
    }
    assert.ok(!Object.keys(out.scalars.types).some((n) => n.startsWith("_")), "no abstract types");
    for (const t of Object.values(out.scalars.types)) {
        for (const [a, v] of Object.entries(t.postgres.attr ?? {})) {
            assert.equal(typeof v, "object", `${t.name}.postgres.attr.${a} is inlined, not a reference`);
        }
    }
    assert.equal(out.scalars.types.slug.postgres.attr.collation.sql, 'COLLATE "und-x-icu"');
    assert.match(out.scalars.types.date.postgres.docs_link, /^https:\/\/www\.postgresql\.org\//);
});

test("meta carries the rules as data", () => {
    const m = out.scalars.$meta;
    assert.deepEqual(Object.keys(m.normalize_steps), ["trim", "lowercase", "uppercase", "remove_spaces", "remove_hyphens"]);
    assert.match(m.lookup, /alias/);
    assert.ok(m.templates.column);
});

test("openapi components compile", () => {
    assert.equal(out.openapi.openapi, "3.1.0");
    assert.equal(out.openapi.info.version, "0.2.0");
    const schemas = out.openapi.components.schemas;
    assert.equal(Object.keys(schemas).length, 88);
    const a = ajv();
    for (const [name, s] of Object.entries(schemas)) assert.doesNotThrow(() => a.compile(s), name);
});

test("committed dist matches a fresh build", () => {
    for (const [file, data] of [["scalars.json", out.scalars], ["openapi.json", out.openapi]]) {
        const committed = fs.readFileSync(path.join(root, "dist", file), "utf8");
        assert.equal(committed, serialize(data), `dist/${file} is stale: run npm run build`);
    }
});
