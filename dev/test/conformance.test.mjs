// Every example runs through every layer: JSON Schema (ajv), the browser's v-flag regex, and real Postgres.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { PGlite } from "@electric-sql/pglite";
import { loadSources, resolve } from "../lib/resolve.mjs";
import { sqlString, toJsonSchema } from "../lib/derive.mjs";
import { pgLiteral } from "./helpers/pg.mjs";

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

for (const t of Object.values(types)) {
    test(`conformance: ${t.name}`, async () => {
        const ex = t.examples ?? {};
        assert.ok(ex.valid?.length >= 1, "has a valid example");
        const validate = ajv.compile(toJsonSchema(t));
        const html = t.html?.attrs?.pattern ? new RegExp(`^(?:${t.html.attrs.pattern})$`, "v") : null;

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
        for (const v of ex.db_invalid ?? []) {
            assert.ok(validate(v), `db_invalid ${JSON.stringify(v)} should pass JSON (only the database rejects it)`);
            assert.ok(await rejects(`INSERT INTO ${table} VALUES (${pgLiteral(t, v)})`), `Postgres accepts db_invalid ${JSON.stringify(v)}`);
        }
    });
}
