// Every example runs through every layer: JSON Schema (ajv), the browser's v-flag regex, and real Postgres.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { PGlite } from "@electric-sql/pglite";
import { loadSources, resolve } from "../lib/resolve.mjs";
import { groupSchema, sqlString, toJsonSchema } from "../lib/derive.mjs";
import { pgLiteral } from "./helpers/pg.mjs";
import { CHECKS, validate as refValidate } from "../lib/reference.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const types = resolve(loadSources(path.join(root, "src")));
const ajv = new Ajv2020({ strict: false, validateFormats: false });
let db;

before(async () => { db = new PGlite(); });
after(async () => { await db.close(); });

const rejects = async (sql) => { try { await db.exec(sql); return false; } catch { return true; } };

test("types with a rule have at least 2 invalid examples", () => {
    const missing = Object.values(types)
        .filter((t) => t.pattern || t.minimum !== undefined || t.maximum !== undefined)
        .filter((t) => (t.examples?.invalid?.length ?? 0) < 2)
        .map((t) => t.name);
    assert.deepEqual(missing, []);
});

test("types with a check have at least 2 check_invalid examples, other types none", () => {
    const wrong = Object.values(types)
        .filter((t) => (t.check ? (t.examples?.check_invalid?.length ?? 0) < 2 : t.examples?.check_invalid !== undefined))
        .map((t) => t.name);
    assert.deepEqual(wrong, []);
});

test("types with an enum have at least 2 list_invalid examples, other types none", () => {
    const wrong = Object.values(types)
        .filter((t) => (t.enum ? (t.examples?.list_invalid?.length ?? 0) < 2 : t.examples?.list_invalid !== undefined))
        .map((t) => t.name);
    assert.deepEqual(wrong, []);
    assert.deepEqual(Object.values(types).filter((t) => t.enum).map((t) => t.name).sort(), ["country", "country_alpha3", "currency"]);
});

for (const t of Object.values(types).filter((t) => t.enum)) {
    test(`list: ${t.name}`, () => {
        const validate = ajv.compile(toJsonSchema(t));
        const distT = groupSchema(structuredClone(t));
        const htmlRe = new RegExp(`^(?:${t.html?.attrs?.pattern ?? t.pattern.slice(1, -1)})$`, "v");
        for (const v of t.examples.list_invalid) {
            // Passes the pattern and normalize; only the list (JSON Schema enum, the reference, the languages) refuses it.
            assert.ok(htmlRe.test(v), `HTML pattern rejects list_invalid ${JSON.stringify(v)}`);
            assert.equal(validate(v), false, `JSON accepts list_invalid ${JSON.stringify(v)}`);
            assert.deepEqual(refValidate(distT, v), { ok: false, reason: "not_in_list" }, `list_invalid ${JSON.stringify(v)}`);
        }
        for (const v of t.enum) {
            const r = refValidate(distT, v);
            assert.ok(r.ok && r.value === v, `enum value ${JSON.stringify(v)} is not valid and unchanged`);
            assert.ok(validate(v), `JSON rejects enum value ${JSON.stringify(v)}`);
        }
    });
}

for (const t of Object.values(types)) {
    test(`conformance: ${t.name}`, async () => {
        const ex = t.examples ?? {};
        assert.ok(ex.valid?.length >= 1, "has a valid example");
        const validate = ajv.compile(toJsonSchema(t));
        // The reference reads the dist shape, where the rule sits under schema.
        const distT = groupSchema(structuredClone(t));
        const htmlRe = t.html?.attrs?.pattern ? new RegExp(`^(?:${t.html.attrs.pattern})$`, "v") : null;
        const a = t.html?.attrs ?? {};
        const [minlength, maxlength] = [Number(a.minlength ?? 0), Number(a.maxlength ?? Infinity)];
        // The browser checks pattern, minlength and maxlength (UTF-16 units) together.
        const html = htmlRe || a.minlength || a.maxlength
            ? { test: (s) => (!htmlRe || htmlRe.test(s)) && s.length >= minlength && s.length <= maxlength }
            : null;

        // Postgres table for this type, with the generated CHECK.
        const table = `t_${t.name}`;
        let column = t.postgres.type;
        if (column === "enum") {
            await db.exec(`CREATE TYPE ${table}_enum AS ENUM (${ex.valid.map(sqlString).join(", ")})`);
            column = `${table}_enum`;
        }
        const check = t.postgres.check ? t.postgres.check.replaceAll("{column}", '"v"') : "";
        await db.exec(`CREATE TABLE ${table} ("v" ${column} ${check})`);

        for (const v of ex.valid) {
            assert.ok(validate(v), `JSON rejects valid ${JSON.stringify(v)}: ${ajv.errorsText(validate.errors)}`);
            if (html) assert.ok(html.test(String(v)), `HTML pattern rejects valid ${JSON.stringify(v)}`);
            assert.equal(await rejects(`INSERT INTO ${table} VALUES (${pgLiteral(t, v)})`), false, `Postgres rejects valid ${JSON.stringify(v)}`);
        }
        for (const v of ex.invalid ?? []) {
            assert.equal(validate(v), false, `JSON accepts invalid ${JSON.stringify(v)}`);
            if (html && typeof v === "string") assert.equal(html.test(v), false, `HTML pattern accepts invalid ${JSON.stringify(v)}`);
        }
        for (const v of ex.check_invalid ?? []) {
            // Passes every pattern-only layer; only the check (in the reference and the languages) rejects it.
            assert.ok(validate(v), `JSON rejects check_invalid ${JSON.stringify(v)}: ${ajv.errorsText(validate.errors)}`);
            if (html) assert.ok(html.test(v), `HTML pattern rejects check_invalid ${JSON.stringify(v)}`);
            assert.equal(refValidate(distT, v).ok, false, `reference accepts check_invalid ${JSON.stringify(v)}`);
        }
        if (t.check) {
            for (const v of ex.valid) assert.ok(CHECKS[t.check](refValidate(distT, v).value), `check ${t.check} rejects valid ${JSON.stringify(v)}`);
        }
        for (const v of ex.db_invalid ?? []) {
            assert.ok(validate(v), `db_invalid ${JSON.stringify(v)} should pass JSON (only the database rejects it)`);
            assert.ok(await rejects(`INSERT INTO ${table} VALUES (${pgLiteral(t, v)})`), `Postgres accepts db_invalid ${JSON.stringify(v)}`);
        }
    });
}
