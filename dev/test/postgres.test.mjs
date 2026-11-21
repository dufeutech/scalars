// Postgres as a language: the hand-written check helpers (engine.sql) and the generated scalars.sql, in PGlite.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { build } from "../build.mjs";
import { readEngine } from "../codegen/common.mjs";
import { CHECKS, validate } from "../lib/reference.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { scalars } = build(root);
const types = Object.values(scalars.types);
let db;

before(async () => {
    db = new PGlite();
    await db.exec(readEngine("engine.sql"));
});
after(async () => { await db.close(); });

const one = async (sql, params = []) => Object.values((await db.query(sql, params)).rows[0])[0];

/** A small seeded generator (mulberry32), so a failure reruns the same inputs. */
function rng(seed) {
    return () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const pick = (r, s) => s[Math.floor(r() * s.length)];
const run = (r, alphabet, lo, hi) => Array.from({ length: lo + Math.floor(r() * (hi - lo + 1)) }, () => pick(r, alphabet)).join("");
const DIGITS = "0123456789";
const ALNUM = DIGITS + "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Random inputs in each check's shape (what the pattern lets through), so most reach the arithmetic. */
const SHAPES = {
    gs1_mod10: (r) => run(r, DIGITS, 8, 18),
    iso7064_mod97_10: (r) => run(r, ALNUM, 18, 20),
    iban: (r) => run(r, "ABCDEFGHIJKLMNOPQRSTUVWXYZ", 2, 2) + run(r, DIGITS, 2, 2) + run(r, ALNUM, 11, 30),
    isbn: (r) => (r() < 0.5 ? run(r, DIGITS, 13, 13) : run(r, DIGITS, 9, 9) + pick(r, DIGITS + "X")),
    iso7064_mod11_2: (r) => [0, 1, 2, 3].map(() => run(r, DIGITS, 4, 4)).join("-").slice(0, -1) + pick(r, DIGITS + "X"),
    int64_range: (r) => (r() < 0.3 ? "-" : "") + run(r, "0", 0, 3) + run(r, DIGITS, 1, 21),
    uint64_range: (r) => run(r, "0", 0, 3) + run(r, DIGITS, 1, 22),
};
const BOUNDARIES = {
    int64_range: ["9223372036854775807", "9223372036854775808", "-9223372036854775808", "-9223372036854775809", "0", "-0", "000", "0009223372036854775807"],
    uint64_range: ["18446744073709551615", "18446744073709551616", "0", "00018446744073709551615", "99999999999999999999"],
};

test("engine.sql has a check_ function for every $meta.checks entry, agreeing with the reference", async () => {
    for (const name of Object.keys(scalars.$meta.checks)) {
        assert.ok(SHAPES[name], `no random shape for check ${name}`);
        const inputs = [...(BOUNDARIES[name] ?? [])];
        for (const t of types.filter((t) => t.check === name)) {
            for (const v of [...t.examples.valid, ...t.examples.check_invalid]) inputs.push(validate(t, v).value ?? String(v));
        }
        const r = rng(name.length * 7919);
        for (let i = 0; i < 2000; i++) inputs.push(SHAPES[name](r));
        const got = (await db.query(`SELECT scalars.check_${name}(x) AS ok FROM unnest($1::text[]) WITH ORDINALITY AS u(x, i) ORDER BY i`, [inputs])).rows.map((row) => row.ok);
        const bad = inputs.filter((v, i) => got[i] !== CHECKS[name](v));
        assert.deepEqual(bad.slice(0, 5), [], `check_${name} disagrees with the reference`);
    }
});

test("check helpers return false, not an error, on non-ASCII text", async () => {
    assert.equal(await one("SELECT scalars.check_gs1_mod10('٣٣٣')"), false);
    assert.equal(await one("SELECT scalars.check_iban('DEéé')"), false);
    assert.equal(await one("SELECT scalars.check_iso7064_mod11_2('é')"), false);
});

test("check helpers are linear: 100,000 digits in well under 200 ms", async () => {
    const big = "1".repeat(100000);
    const t = Date.now();
    assert.equal(await one("SELECT scalars.check_int64_range($1)", [big]), false);
    assert.equal(await one("SELECT scalars.check_gs1_mod10($1)", [big]), CHECKS.gs1_mod10(big));
    assert.ok(Date.now() - t < 200, `took ${Date.now() - t} ms`);
});
