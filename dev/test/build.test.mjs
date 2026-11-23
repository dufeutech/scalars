import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { build, serialize } from "../build.mjs";
import { readSource } from "../lib/source.mjs";

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
    assert.equal(Object.keys(out.scalars.types).length, 75);
    assert.equal(out.scalars.version, "0.9.0");
    const validate = ajv().compile(JSON.parse(fs.readFileSync(path.join(root, "schema/dist.schema.json"), "utf8")));
    assert.ok(validate(out.scalars), JSON.stringify(validate.errors?.slice(0, 3)));
});

test("dist is self-contained", () => {
    for (const k of ["base", "abstract", "anchor", "docs"]) {
        assert.ok(!keys(out.scalars.types).has(k), `found source-only key ${k}`);
    }
    assert.ok(!Object.keys(out.scalars.types).some((n) => n.startsWith("_")), "no abstract types");
    assert.match(out.scalars.types.date.postgres.docs_link, /^https:\/\/www\.postgresql\.org\//);
});

test("meta carries the rules as data", () => {
    const m = out.scalars.$meta;
    assert.deepEqual(Object.keys(m.normalize_steps), ["trim", "lowercase", "uppercase", "remove_spaces", "remove_hyphens"]);
    assert.match(m.lookup, /alias/);
});

test("meta carries the error templates", () => {
    const e = out.scalars.$meta.errors;
    assert.equal(e.too_long, "At most {max} characters.");
    assert.deepEqual(Object.keys(e).sort(), [
        "alias", "bad_name", "bad_setting", "conflicting_setting", "cycle", "duplicate", "misplaced", "missing_setting",
        "not_allowed", "not_entity", "not_list", "not_object", "not_value", "required", "reserved", "too_deep", "too_long",
        "too_many_digits", "type_name", "unknown_field", "unknown_setting", "unresolved",
    ]);
    assert.deepEqual([e.reserved, e.not_value, e.not_entity, e.conflicting_setting, e.misplaced, e.duplicate], [
        "This name is reserved.", "Only a value model can be embedded; link to an entity instead.", "A link must point at an entity.",
        'Can\'t be used with "{setting}".', "Not allowed here.", "Listed twice.",
    ]);
});

test("openapi components compile", () => {
    assert.equal(out.openapi.openapi, "3.1.0");
    assert.equal(out.openapi.info.version, "0.9.0");
    const schemas = out.openapi.components.schemas;
    assert.equal(Object.keys(schemas).length, 75);
    const a = ajv();
    for (const [name, s] of Object.entries(schemas)) assert.doesNotThrow(() => a.compile(s), name);
});

test("committed dist matches a fresh build", () => {
    for (const [file, data] of [["scalars.json", out.scalars], ["openapi.json", out.openapi]]) {
        const committed = fs.readFileSync(path.join(root, "dist", file), "utf8");
        assert.equal(committed, serialize(data), `dist/${file} is stale: run npm run build`);
    }
    for (const [file, text] of Object.entries(out.code)) {
        const committed = fs.readFileSync(path.join(root, "dist", file), "utf8");
        assert.equal(committed, text, `dist/${file} is stale: run npm run build`);
    }
});

test("README download links use the current version tag", () => {
    const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
    const version = readSource(path.join(root, "src/scalar.yaml")).version;
    const refs = [...readme.matchAll(/raw\.githubusercontent\.com\/dufeutech\/scalars\/([^/\s]+)\//g)].map((m) => m[1]);
    assert.ok(refs.length > 0, "README has no download links");
    for (const ref of refs) assert.equal(ref, `v${version}`, "README link points at the wrong tag: move it with the release");
});

test("dist holds only built files", () => {
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true })
        .flatMap((e) => e.isDirectory() ? walk(path.join(dir, e.name)).map((f) => `${e.name}/${f}`) : [e.name]);
    const want = ["scalars.json", "openapi.json", ...Object.keys(out.code)].sort();
    assert.deepEqual(walk(path.join(root, "dist")).sort(), want);
});

test("a type with non-ASCII valid examples claims no ASCII-only format or input", () => {
    // JSON Schema's email/hostname/uri formats and the browser's type="email"/"url" inputs refuse non-ASCII text.
    const asciiFormats = new Set(["email", "hostname", "uri", "uri-reference"]);
    const asciiInputs = new Set(["email", "url"]);
    const bad = [];
    for (const t of Object.values(out.scalars.types)) {
        if (!(t.examples?.valid ?? []).some((v) => typeof v === "string" && /[^\x00-\x7F]/.test(v))) continue;
        if (asciiFormats.has(t.schema.format)) bad.push(`${t.name}: format ${t.schema.format}`);
        if (asciiInputs.has(t.html?.attrs?.type)) bad.push(`${t.name}: input type ${t.html.attrs.type}`);
    }
    assert.deepEqual(bad, []);
});
