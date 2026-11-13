import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { loadSources, resolve } from "../lib/resolve.mjs";

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
    assert.deepEqual(r.slug.postgres.attr, { collation: "collation" });
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

test("standards expand", () => {
    const r = mini();
    assert.equal(r.slug.standard, "RFC 3986");
    assert.equal(r.slug.docs_link, "https://datatracker.ietf.org/doc/html/rfc3986#section-3.3");
    assert.equal(r.uuid.docs_link, "https://datatracker.ietf.org/doc/html/rfc9562");
    assert.equal(r.uuid_v7.standard, undefined, "standard is not inherited");
    assert.throws(
        () => resolve(patched({ slug: { base: "string", level: "core", category: "technical", standard: "nope" } })),
        (e) => e.message.includes("slug") && e.message.includes("nope"),
    );
});

test("unknown base throws", () => {
    assert.throws(
        () => resolve(patched({ slug: { base: "nope", level: "core", category: "technical" } })),
        (e) => e.message.includes("slug") && e.message.includes("nope"),
    );
});

test("cycle throws", () => {
    assert.throws(
        () => resolve(patched({
            a: { base: "b", level: "core", category: "technical" },
            b: { base: "a", level: "core", category: "technical" },
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
        ["scalar.schema.json", path.join(miniDir, "scalar.json")],
        ["html.schema.json", path.join(miniDir, "targets/html.json")],
        ["postgres.schema.json", path.join(miniDir, "targets/postgres.json")],
    ];
    for (const [schemaFile, dataFile] of checks) {
        const validate = ajv.compile(load(schemaFile));
        const ok = validate(JSON.parse(fs.readFileSync(dataFile, "utf8")));
        assert.ok(ok, `${dataFile}: ${JSON.stringify(validate.errors)}`);
    }
    const validate = ajv.getSchema(load("scalar.schema.json").$id);
    assert.equal(validate({ x: { level: "core", category: "technical", typo: 1 } }), false, "unknown keys are rejected");
});

test("repo root is pure JSON", () => {
    const skip = new Set(["dev", "docs", "coding", "node_modules"]);
    const allowed = new Set(["README.md", "LICENSE", "CHANGELOG.md"]);
    const bad = [];
    const walk = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            if (e.name.startsWith(".") || skip.has(e.name)) continue;
            const p = path.join(dir, e.name);
            if (e.isDirectory()) walk(p);
            else if (!e.name.endsWith(".json") && !allowed.has(e.name)) bad.push(path.relative(root, p));
        }
    };
    walk(root);
    assert.deepEqual(bad, []);
});
