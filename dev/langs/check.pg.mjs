// Loads the generated dist/postgres/scalars.sql into PGlite and checks every example plus cases.json against it.
// Postgres takes canonical values: text is normalized first, by the reference, as an app would.
// Run: node check.pg.mjs <dist/scalars.json> <cases.json>
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { validate } from "../lib/reference.mjs";
import { modelOf } from "../codegen/model.mjs";
import { pgInput, pgReason } from "./pg.mjs";

const [distPath, casesPath] = process.argv.slice(2);
const sqlPath = path.join(path.dirname(path.resolve(distPath)), "postgres", "scalars.sql");
const types = JSON.parse(fs.readFileSync(distPath, "utf8")).types;
const cases = JSON.parse(fs.readFileSync(casesPath, "utf8"));
const db = new PGlite();
const fails = [];
const skipped = {};
const skip = (why) => { skipped[why] = (skipped[why] ?? 0) + 1; };
const show = (v) => JSON.stringify(v).slice(0, 60);
let ran = 0;
let slowest = { type: "", ms: 0 };

try {
    await db.exec(fs.readFileSync(sqlPath, "utf8"));
} catch (e) {
    console.log(`postgres: cannot load ${sqlPath}: ${e.message}`);
    process.exit(1);
}

/** Runs one value; `want` is null when valid, else the reason, or undefined to compare validity only (match cases). */
async function check(label, t, v, want, special) {
    if (t.name === "enum") return skip("enum has no functions");
    const input = special ? { arg: special, sqlType: "text" } : pgInput(t, v);
    if (!input) return skip("a non-string into a text type (SQL is typed)");
    // The case's answer is for the raw value; Postgres sees the normalized one, which must get the same answer.
    const ref = validate(t, modelOf(t).kind === "text" ? input.arg : v);
    const refWant = ref.ok ? null : ref.reason;
    if (want !== undefined && refWant !== want) return fails.push(`${label}: the reference gives ${refWant} on the normalized value, the case says ${want} (a spec bug)`);
    const start = performance.now();
    const got = await pgReason(db, t, input);
    const ms = performance.now() - start;
    if (ms > slowest.ms) slowest = { type: t.name, ms };
    if (ms > 2000) fails.push(`${label}: took ${ms.toFixed(0)} ms`);
    ran++;
    if (want === undefined ? (got === null) !== (refWant === null) : got !== want) fails.push(`${label}: got ${got}, want ${want === undefined ? refWant : want}`);
}

for (const t of Object.values(types)) {
    const ex = t.examples;
    for (const v of [...ex.valid, ...(ex.invalid ?? []), ...(ex.check_invalid ?? []), ...(ex.list_invalid ?? [])]) {
        await check(`${t.name} example ${show(v)}`, t, v, undefined);
    }
}
for (const c of cases.match) {
    // match cases give validity only; compare with the case's ok through the reference's answer.
    const t = types[c.type];
    const r = validate(t, c.in);
    if (r.ok !== c.ok) fails.push(`match ${c.type} ${show(c.in)}: the reference gives ${r.ok}, the case says ${c.ok}`);
    await check(`match ${c.type} ${show(c.in)}`, t, c.in, undefined);
}
for (const c of [...cases.validate, ...cases.hostile]) {
    if (c.malformed) { skip("malformed text (Postgres text can't hold it)"); continue; }
    const v = "prefix" in c ? c.prefix + c.repeat.repeat(c.count) + c.suffix : "special" in c ? { NaN, Infinity }[c.special] : c.in;
    await check(`${c.type} ${show(v)}`, types[c.type], v, c.ok ? null : c.reason, c.special);
}
await db.close();

const skips = Object.entries(skipped).map(([why, n]) => `${n} ${why}`).join("; ");
console.log(fails.length ? fails.join("\n") : `postgres: ok, ${ran} values, slowest ${slowest.type} ${slowest.ms.toFixed(1)} ms (skipped: ${skips})`);
process.exit(fails.length ? 1 : 0);
