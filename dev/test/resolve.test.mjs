import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { loadSources, resolve } from "../lib/resolve.mjs";
import { readSource } from "../lib/source.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const miniDir = path.join(here, "fixtures/mini");
const mini = () => resolve(loadSources(miniDir));

/** Mini sources with one core entry patched, for error cases. */
const patched = (patch) => {
    const s = loadSources(miniDir);
    Object.assign(s.core, patch);
    return s;
};

test("inherits type and format", () => {
    const t = mini().uuid_v7;
    assert.equal(t.format, "uuid");
    assert.equal(t.type, "string");
    assert.equal(t.primitive, "string");
});

test("child pattern wins", () => {
    const r = mini();
    assert.notEqual(r.uuid_v7.pattern, r.uuid.pattern);
    assert.match(r.uuid_v7.pattern, /-7\[/);
});

test("null deletes", () => {
    assert.ok(!("format" in mini().jwt_like));
});

test("no base in output", () => {
    for (const t of Object.values(mini())) {
        assert.ok(!("base" in t), t.name);
        assert.ok(!("abstract" in t), t.name);
        assert.ok(!("anchor" in t), t.name);
        assert.ok(!("docs" in t), t.name);
    }
});

test("identity fields not inherited", () => {
    const r = mini();
    assert.equal(r.string.label, "Text");
    assert.equal(r.slug.label, undefined);
});

test("targets and notes inherit", () => {
    const r = mini();
    assert.equal(r.slug.postgres.type, "text");
    assert.equal(r.slug.postgres.note, "N");
    assert.deepEqual(r.slug.postgres.attr, ["collation"]);
    assert.equal(r.quiet.postgres.note, undefined);
    assert.equal(r.quiet.postgres.type, "text");
    assert.equal(r.uuid.postgres.type, "uuid");
    assert.equal(r.uuid.postgres.attr, undefined);
});

test("attrs merge through abstract base", () => {
    const a = mini().slug.html.attrs;
    assert.equal(a.type, "text");
    assert.equal(a.spellcheck, "false");
    assert.equal(a.autocapitalize, "none");
    assert.equal(mini().string.html.attrs.spellcheck, undefined);
});

test("abstract hidden", () => {
    assert.equal("_token" in mini(), false);
});

test("alternative default", () => {
    const r = mini();
    assert.equal(r.uuid_v7.alternative, "uuid");
    assert.equal(r.jwt_like.alternative, "string");
    assert.equal(r.quiet.alternative, "string");
    assert.ok(!("alternative" in r.slug));
});

test("docs links expand", () => {
    const r = mini();
    assert.equal(r.slug.standard, "RFC 3986 (path segment)", "standard is free text, kept as written");
    assert.equal(r.slug.docs_link, "https://datatracker.ietf.org/doc/html/rfc3986#section-3.3");
    assert.equal(r.uuid.docs_link, "https://datatracker.ietf.org/doc/html/rfc9562");
    assert.ok(!("docs" in r.slug), "docs id is source-only");
    assert.equal(r.uuid_v7.standard, undefined, "standard is not inherited");
    assert.equal(r.uuid_v7.docs_link, undefined, "docs is not inherited");
    assert.throws(
        () => resolve(patched({ slug: { base: "string", level: "core", docs: "nope" } })),
        (e) => e.message.includes("slug") && e.message.includes("nope"),
    );
});

test("generated values never leak from parent to child", () => {
    // slug comes first in the file, so it is fully generated before its child is resolved.
    const r = resolve(patched({ loose: { base: "slug", level: "advanced", pattern: null } }));
    assert.ok(r.slug.html.attrs.pattern, "parent keeps its own generated pattern");
    assert.equal(r.loose.pattern, undefined);
    for (const a of ["pattern", "title", "placeholder"]) assert.equal(r.loose.html.attrs[a], undefined, `html.${a} leaked`);
    assert.equal(r.loose.postgres.check, undefined, "postgres.check leaked");
});

test("unknown base throws", () => {
    assert.throws(
        () => resolve(patched({ slug: { base: "nope", level: "core" } })),
        (e) => e.message.includes("slug") && e.message.includes("nope"),
    );
});

test("cycle throws", () => {
    assert.throws(
        () => resolve(patched({
            a: { base: "b", level: "core" },
            b: { base: "a", level: "core" },
        })),
        (e) => e.message.includes("cycle"),
    );
});

test("unknown target throws", () => {
    const s = loadSources(miniDir);
    s.targets.html.ghost = { element: "input" };
    assert.throws(() => resolve(s), (e) => e.message.includes("ghost") && e.message.includes("html"));
});

test("file schemas validate", () => {
    const ajv = new Ajv2020({ allErrors: true, validateFormats: false });
    const load = (f) => JSON.parse(fs.readFileSync(path.join(root, "schema", f), "utf8"));
    const checks = [
        ["scalar.schema.json", path.join(miniDir, "scalar.yaml")],
        ["html.schema.json", path.join(miniDir, "targets/html.yaml")],
        ["postgres.schema.json", path.join(miniDir, "targets/postgres.yaml")],
    ];
    for (const [schemaFile, dataFile] of checks) {
        const validate = ajv.compile(load(schemaFile));
        const ok = validate(readSource(dataFile));
        assert.ok(ok, `${dataFile}: ${JSON.stringify(validate.errors)}`);
    }
    const validate = ajv.getSchema(load("scalar.schema.json").$id);
    assert.equal(validate({ x: { level: "core", typo: 1 } }), false, "unknown keys are rejected");
});

test("repo root holds only data: YAML source in src/, JSON elsewhere", () => {
    // dist/ also holds the generated per-language files (dist/python, ...), so it is not walked.
    const skip = new Set(["dev", "docs", "coding", "node_modules", "dist"]);
    const allowed = new Set(["README.md", "LICENSE", "CHANGELOG.md"]);
    const bad = [];
    const inSrc = (p) => path.relative(root, p).split(path.sep)[0] === "src";
    const walk = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            if (e.name.startsWith(".") || skip.has(e.name)) continue;
            const p = path.join(dir, e.name);
            if (e.isDirectory()) walk(p);
            else if (!e.name.endsWith(inSrc(p) ? ".yaml" : ".json") && !allowed.has(e.name)) bad.push(path.relative(root, p));
        }
    };
    walk(root);
    assert.deepEqual(bad, []);
});

test("check is inherited, and null deletes it", () => {
    const r = resolve(patched({
        digits: { base: "string", level: "core", pattern: "^[0-9]+$", check: "gs1_mod10" },
        more: { base: "digits", level: "advanced" },
        loose: { base: "digits", level: "advanced", check: null },
    }));
    assert.equal(r.more.check, "gs1_mod10");
    assert.equal(r.loose.check, undefined);
});

test("a text type taking precision needs a digits pattern", () => {
    const withAmount = (amount) => {
        const s = patched({ amount: { base: "string", level: "core", ...amount } });
        s.core.$defs = { ...s.core.$defs, params: { precision: { type: "integer" }, scale: { type: "integer" } } };
        return s;
    };
    assert.throws(() => resolve(withAmount({ pattern: "^[0-9a-f]+$", params: ["precision"] })), /takes precision, so its pattern must be digits/);
    assert.throws(() => resolve(withAmount({ params: ["precision"] })), /takes precision/);
    const r = resolve(withAmount({ pattern: "^-?[0-9]+(\\.[0-9]+)?$", params: ["precision", "scale"] }));
    assert.deepEqual(r.amount.params, ["precision", "scale"]);
});

test("enum is inherited, and the build checks every list", () => {
    const code = { base: "string", level: "core", pattern: "^[A-Z]{2}$", normalize: ["trim", "uppercase"] };
    const r = resolve(patched({ code: { ...code, enum: ["DE", "US"] }, code_too: { base: "code", level: "advanced" } }));
    assert.deepEqual(r.code_too.enum, ["DE", "US"]);
    const fails = (patch, re) => assert.throws(() => resolve(patched(patch)), re);
    fails({ code: { ...code, enum: ["DE", "usa"] } }, /enum value "usa" does not match its pattern/);
    fails({ code: { ...code, enum: ["US", "DE"] } }, /enum must be sorted/);
    fails({ code: { ...code, enum: ["DE", "DE"] } }, /enum must be sorted, with no repeats/);
    fails({ code: { ...code, normalize: ["trim", "lowercase"], pattern: "^[A-Za-z]{2}$", enum: ["DE"] } }, /enum value "DE" is changed by its normalize/);
    fails({ integer: { level: "core", type: "integer", enum: ["1"] } }, /only text types may have an enum/);
    // A child with its own pattern that keeps the parent's list fails through the pattern rule.
    fails({ code: { ...code, enum: ["DE", "US"] }, code3: { base: "code", level: "advanced", pattern: "^[A-Z]{3}$" } }, /Type "code3": enum value "DE" does not match its pattern/);
});

test("unknown check fails the build", () => {
    assert.throws(
        () => resolve(patched({ slug: { base: "string", level: "core", check: "nope" } })),
        /unknown check "nope"/,
    );
});
