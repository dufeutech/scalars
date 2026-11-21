import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { canonical, loadSources, resolve } from "../lib/resolve.mjs";
import { readSource } from "../lib/source.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const SOURCES = [["scalar", "src/scalar.yaml"], ["html", "src/targets/html.yaml"], ["postgres", "src/targets/postgres.yaml"]];
const resolved = resolve(loadSources(path.join(root, "src")));

/** Resolve after deleting one key from the source; used to prove that key is not redundant. */
function resolveWithout(mutate) {
    const s = loadSources(path.join(root, "src"));
    mutate(s);
    try { return resolve(s); } catch { return null; }
}

test("dry", async (t) => {
    const s = loadSources(path.join(root, "src"));
    const reserved = new Set(["$schema", "version", "$defs"]);
    const coreRedundant = [];
    for (const [name, def] of Object.entries(s.core)) {
        if (reserved.has(name)) continue;
        assert.ok(!("docs_link" in def), `${name} has docs_link in source`);
        for (const k of ["type", "format", "pattern", "minLength", "maxLength", "minimum", "maximum", "contentEncoding", "normalize", "alternative", "params"]) {
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
    for (const [schema, file] of SOURCES) {
        const validate = ajv.compile(JSON.parse(fs.readFileSync(path.join(root, "schema", `${schema}.schema.json`), "utf8")));
        assert.ok(validate(readSource(path.join(root, file))), `${file}: ${JSON.stringify(validate.errors?.slice(0, 3))}`);
    }
});

test("source YAML reads the same under YAML 1.1 and 1.2", () => {
    // A YAML 1.1 reader turns plain NO, on, y or 0o7 into booleans and numbers; the files quote them.
    for (const [, file] of SOURCES) {
        const text = fs.readFileSync(path.join(root, file), "utf8");
        assert.deepEqual(YAML.parse(text, { version: "1.1" }), YAML.parse(text), `${file} reads differently under YAML 1.1`);
    }
});
