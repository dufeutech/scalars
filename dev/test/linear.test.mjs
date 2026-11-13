// Every pattern must run in linear time in backtracking engines (Python re, JS RegExp); see linearProblems.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { linearProblems, matchLengths, parsePattern } from "../lib/linear.mjs";
import { loadSources, resolve } from "../lib/resolve.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const types = resolve(loadSources(path.join(root, "src")));
const patterned = Object.values(types).filter((t) => t.pattern);

/** The email pattern before the rewrite: quadratic, since the domain can split at any dot. */
const OLD_EMAIL = "^[^@\\x09-\\x0D\\x20]+@[^@\\x09-\\x0D\\x20]+\\.[^@\\x09-\\x0D\\x20]+$";

test("ambiguous patterns are rejected", () => {
    for (const p of ["^(a+)+$", "^(a|a)*$", "^(a|aa)+$", "^a*a*$", OLD_EMAIL]) assert.notDeepEqual(linearProblems(p), [], p);
});

test("the kind of ambiguity is named", () => {
    assert.match(linearProblems("^(a+)+$").join(), /exponential ambiguity at positions/);
    assert.match(linearProblems("^a*a*$").join(), /polynomial ambiguity between positions 1 and 3/);
});

test("unambiguous and bounded patterns pass", () => {
    for (const p of ["^a*b*$", "^(ab)*$", "^a?a?$", "^[0-9]{1,61}$", "^(a|b)*c$", "^(?:)$"]) assert.deepEqual(linearProblems(p), [], p);
});

test("every source pattern is linear", () => {
    const bad = patterned.filter((t) => linearProblems(t.pattern).length)
        .map((t) => `${t.name}: ${linearProblems(t.pattern).join("; ")}`);
    assert.deepEqual(bad, []);
});

test("bounded-ambiguity patterns pass", () => {
    for (const n of ["base64", "hostname", "duration", "semver", "media_range"]) assert.deepEqual(linearProblems(types[n].pattern), [], n);
});

test("patterns outside the portable subset do not parse", () => {
    for (const p of ["^\\d$", "^a.b$", "a$", "^a", "^(?=a)a$", "^[]a]$", "^[\\x41B]$", "^a{2$", "^*a$", "^a*?$", "^a^b$", "^a$b$", "^[a$", "^(a$", "^a)$", "^[z-a]$", "^a{3,2}$"]) {
        assert.throws(() => parsePattern(p), Error, p);
    }
});

test("classes are sorted code-point intervals", () => {
    assert.deepEqual(parsePattern("^[c-da-b\\x30]$"), { kind: "class", ranges: [[0x30, 0x30], [0x61, 0x64]], at: 1 });
    assert.deepEqual(parsePattern("^[^\\x00-\\x40\\x42-\u{10FFFF}]$").ranges, [[0x41, 0x41]]);
});

test("match lengths", () => {
    assert.deepEqual(matchLengths(types.uuid.pattern), { min: 36, max: 36 });
    assert.deepEqual(matchLengths(types.phone.pattern), { min: 3, max: 16 });
    assert.deepEqual(matchLengths(types.country.pattern), { min: 2, max: 2 });
    assert.deepEqual(matchLengths(types.email.pattern), { min: 5, max: Infinity });
    assert.deepEqual(matchLengths("^(ab|c){2,3}x?$"), { min: 2, max: 7 });
    assert.deepEqual(matchLengths("^(?:)*a$"), { min: 1, max: 1 });
});

test("every valid example fits its derived lengths", () => {
    for (const t of patterned) {
        const { min, max } = matchLengths(t.pattern);
        for (const v of t.examples?.valid ?? []) {
            if (typeof v !== "string") continue;
            const n = [...v].length;
            assert.ok(min <= n && n <= max, `${t.name}: ${JSON.stringify(v)} has ${n} code points, outside ${min}..${max}`);
        }
    }
});

test("the email rewrite accepts exactly what the old pattern did", () => {
    const [before, after] = [new RegExp(OLD_EMAIL, "u"), new RegExp(types.email.pattern, "u")];
    let words = [""];
    for (let len = 0; len <= 8; len++) {
        for (const s of words) assert.equal(after.test(s), before.test(s), JSON.stringify(s));
        words = words.flatMap((s) => ["a", ".", "@", " "].map((c) => s + c));
    }
});
