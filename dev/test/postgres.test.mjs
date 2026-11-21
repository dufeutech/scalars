// Postgres as a language: the hand-written check helpers (engine.sql) and the generated scalars.sql, in PGlite.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { build } from "../build.mjs";
import { readEngine } from "../codegen/common.mjs";
import { CHECKS, validate } from "../lib/reference.mjs";
import { modelOf } from "../codegen/model.mjs";
import { pgInput, pgReason } from "../langs/pg.mjs";

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

const sql = build(root).code["postgres/scalars.sql"];

test("scalars.sql loads twice (an upgrade) and has no enum functions", async () => {
    const pg = new PGlite();
    await pg.exec(sql);
    await pg.exec(sql);
    const fns = (await pg.query("SELECT proname FROM pg_proc WHERE pronamespace = 'scalars'::regnamespace")).rows.map((r) => r.proname);
    assert.ok(!fns.includes("enum_reason") && !fns.includes("is_enum"), "enum has no functions");
    for (const t of types.filter((t) => t.name !== "enum")) {
        assert.ok(fns.includes(`${t.name}_reason`) && fns.includes(`is_${t.name}`), `${t.name} lacks its functions`);
    }
    await pg.close();
});

test("every example gets the reference's reason from scalars.<type>_reason", async () => {
    const pg = new PGlite();
    await pg.exec(sql);
    const bad = [];
    for (const t of types.filter((t) => t.name !== "enum")) {
        const ex = t.examples;
        for (const v of [...ex.valid, ...(ex.invalid ?? []), ...(ex.check_invalid ?? []), ...(ex.list_invalid ?? [])]) {
            const input = pgInput(t, v);
            if (!input) continue;
            const ref = validate(t, modelOf(t).kind === "text" ? input.arg : v);
            const want = ref.ok ? null : ref.reason;
            const got = await pgReason(pg, t, input);
            const is = (await pg.query(`SELECT scalars.is_${t.name}($1::${input.sqlType}) AS ok`, [input.arg])).rows[0].ok;
            if (got !== want || is !== ref.ok) bad.push(`${t.name} ${JSON.stringify(input.arg)}: got ${got}/${is}, want ${want}`);
        }
    }
    assert.deepEqual(bad, []);
    await pg.close();
});

test("a domain per type except enum, kept by a second load, NULL allowed", async () => {
    const pg = new PGlite();
    await pg.exec(sql);
    await pg.exec(sql);
    const domains = (await pg.query("SELECT typname FROM pg_type WHERE typtype = 'd' AND typnamespace = 'scalars'::regnamespace ORDER BY 1")).rows.map((r) => r.typname);
    assert.deepEqual(domains, types.filter((t) => t.name !== "enum").map((t) => t.name).sort());
    await pg.exec("CREATE TABLE pay (account scalars.iban)");
    await pg.exec("INSERT INTO pay VALUES (NULL), ('DE89370400440532013000')");
    const refused = async (q) => pg.exec(q).then(() => false, () => true);
    assert.ok(await refused("INSERT INTO pay VALUES ('DE89370400440532013001')"), "check digit");
    for (const q of ["'1.2.3.4/24'::scalars.ipv4", "'::1'::scalars.ipv4", "'::1/32'::scalars.ipv4", "'1.2.3.4'::scalars.ipv6", "'NaN'::scalars.float64",
        "'Infinity'::scalars.float32", "'::/0'::scalars.ipv4_cidr", "decode(repeat('ab', 31), 'hex')::scalars.sha256",
        "70000::scalars.port", "'-1'::scalars.uint64", "'1.5'::scalars.uint64", "'XX'::scalars.country"]) {
        assert.ok(await refused(`SELECT ${q}`), `accepted ${q}`);
    }
    for (const q of ["'1.2.3.4'::scalars.ipv4", "'::1'::scalars.ipv6", "'10.0.0.0/8'::scalars.ipv4_cidr", "'18446744073709551615'::scalars.uint64", "'US'::scalars.country"]) {
        assert.equal(await refused(`SELECT ${q}`), false, `refused ${q}`);
    }
    await pg.close();
});

test("dist: postgres.domain on every type but enum, no postgres.check", () => {
    for (const t of types) {
        assert.equal(t.postgres.check, undefined, `${t.name} still has postgres.check`);
        assert.equal(t.postgres.domain, t.name === "enum" ? undefined : `scalars.${t.name}`, t.name);
    }
});
