import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonical, loadSources, resolve } from "../lib/resolve.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const legacy = JSON.parse(fs.readFileSync(path.join(here, "fixtures/legacy-scalar.json"), "utf8"));
const legacyTypes = Object.entries(legacy).filter(([k]) => k !== "$defs");
const resolved = resolve(loadSources(root));

const CORE_KEYS = ["type", "format", "pattern", "minimum", "maximum", "contentEncoding", "level", "alternative"];
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o?.[k] !== undefined).map((k) => [k, o[k]]));
const withoutGeneratedHtml = (attrs = {}) => {
    const { title, placeholder, ...rest } = attrs;
    return rest;
};

test("v2 resolves to v1", async (t) => {
    assert.equal(Object.keys(resolved).length, legacyTypes.length, "same type count");
    for (const [name, old] of legacyTypes) {
        await t.test(name, () => {
            const r = resolved[name];
            assert.ok(r, `missing ${name}`);
            assert.deepEqual(pick(r, CORE_KEYS), pick(old, CORE_KEYS), "core fields");
            assert.equal(r.details, old.description, "details");
            assert.equal(r.docs_link, old.docs_link, "docs_link");
            if (old.standard !== undefined) assert.equal(r.standard, old.standard, "standard");
            if (old.example !== undefined) assert.deepEqual(r.examples.valid[0], old.example, "example");

            const oldAttrs = { ...old.html.attrs };
            // v1 skipped the HTML pattern for char by name; v2 applies the generic rule ([\s\S] == one character).
            if (name === "char") delete oldAttrs.pattern;
            const newAttrs = withoutGeneratedHtml(r.html.attrs);
            if (name === "char") delete newAttrs.pattern;
            assert.deepEqual(
                { ...pick(r.html, ["element", "options", "note"]), attrs: newAttrs },
                { ...pick(old.html, ["element", "options", "note"]), attrs: oldAttrs },
                "html",
            );
            assert.deepEqual(pick(r.postgres, ["type", "attr", "note", "check"]), pick(old.postgres, ["type", "attr", "note", "check"]), "postgres");
        });
    }
});

/** Resolve after deleting one key from the source; used to prove that key is not redundant. */
function resolveWithout(mutate) {
    const s = loadSources(root);
    mutate(s);
    try { return resolve(s); } catch { return null; }
}

test("dry", async (t) => {
    const s = loadSources(root);
    const reserved = new Set(["$schema", "version", "$defs"]);
    const coreRedundant = [];
    for (const [name, def] of Object.entries(s.core)) {
        if (reserved.has(name)) continue;
        assert.ok(!("docs_link" in def), `${name} has docs_link in source`);
        for (const k of ["type", "format", "pattern", "minimum", "maximum", "contentEncoding", "normalize", "alternative"]) {
            if (!(k in def)) continue;
            const r = resolveWithout((x) => { delete x.core[name][k]; });
            if (r && canonical(r) === canonical(resolved)) coreRedundant.push(`${name}.${k}`);
        }
    }
    await t.test("no redundant core keys", () => assert.deepEqual(coreRedundant, []));

    const targetRedundant = [];
    for (const [tn, file] of Object.entries(s.targets)) {
        for (const [name, block] of Object.entries(file)) {
            if (reserved.has(name)) continue;
            const keys = [...Object.keys(block).filter((k) => k !== "attrs"), ...Object.keys(block.attrs ?? {}).map((a) => `attrs.${a}`)];
            if (keys.length === 0) targetRedundant.push(`${tn}.${name} (empty)`);
            for (const k of keys) {
                const r = resolveWithout((x) => {
                    const b = x.targets[tn][name];
                    if (k.startsWith("attrs.")) delete b.attrs[k.slice(6)];
                    else delete b[k];
                });
                if (r && canonical(r) === canonical(resolved)) targetRedundant.push(`${tn}.${name}.${k}`);
            }
        }
    }
    await t.test("no redundant target keys", () => assert.deepEqual(targetRedundant, []));
});

test("source files validate against their schemas", async () => {
    const { default: Ajv2020 } = await import("ajv/dist/2020.js");
    const ajv = new Ajv2020({ allErrors: true, validateFormats: false });
    for (const [schema, file] of [["scalar", "scalar.json"], ["html", "targets/html.json"], ["postgres", "targets/postgres.json"]]) {
        const validate = ajv.compile(JSON.parse(fs.readFileSync(path.join(root, "schema", `${schema}.schema.json`), "utf8")));
        assert.ok(validate(JSON.parse(fs.readFileSync(path.join(root, file), "utf8"))), `${file}: ${JSON.stringify(validate.errors?.slice(0, 3))}`);
    }
});
