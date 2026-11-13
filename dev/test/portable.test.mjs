// Patterns must match the same in Go, Python, Rust, JS and Postgres; see patternProblems.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { patternProblems } from "../lib/portable.mjs";
import { toJsonSchema } from "../lib/derive.mjs";
import { loadSources, resolve } from "../lib/resolve.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const types = resolve(loadSources(path.join(root, "src")));

test("portable patterns pass", () => {
    for (const p of ["^[0-9]+$", "^(?:a|b)\\.c$", "^[\\x20-\\x7E]*$", "^[^~/]$", "^[A-Za-z0-9:/!#$%&'*+\\-.^_`|~]*$", "^\\+[1-9]{1,3}$", "^[\\]a]$"]) {
        assert.deepEqual(patternProblems(p), [], p);
    }
});

test("non-portable patterns are reported", () => {
    for (const p of ["^\\d$", "^[\\dX]$", "^(?=a)a$", "^(?!$)a$", "^(?<=a)b$", "^\\s$", "^\\w$", "^\\bx$", "^(a)\\1$", "^(?<n>a)$", "^\\p{L}$", "^(?i)a$", "a$", "^a", "^a.b$", "^[\\x41B]$", "^[]a]$"]) {
        assert.notDeepEqual(patternProblems(p), [], p);
    }
});

test("every type pattern is portable", () => {
    const bad = Object.values(types).filter((t) => t.pattern && patternProblems(t.pattern).length)
        .map((t) => `${t.name}: ${patternProblems(t.pattern).join("; ")}`);
    assert.deepEqual(bad, []);
});

test("phone rejects non-ASCII digits", () => {
    assert.equal(new RegExp(types.phone.pattern, "u").test("+1٣٣٣"), false);
});

test("char is one code point by length, not by pattern", () => {
    const validate = new Ajv2020({ strict: false }).compile(toJsonSchema(types.char));
    assert.equal(types.char.pattern, undefined);
    for (const v of ["a", "\n", " ", "😀"]) assert.ok(validate(v), JSON.stringify(v));
    for (const v of ["", "ab"]) assert.equal(validate(v), false, JSON.stringify(v));
});

test("hostname length is a maxLength, not a lookahead", () => {
    const h = types.hostname;
    assert.equal(h.maxLength, 253);
    const long = Array(4).fill("a".repeat(63)).join("."); // 255 chars, every label valid
    const validate = new Ajv2020({ strict: false }).compile(toJsonSchema(h));
    assert.equal(validate(long), false);
    assert.ok(h.examples.invalid.includes(long), "the long name is an invalid example");
    assert.equal(h.html.attrs.maxlength, "253");
    assert.match(h.postgres.check, /char_length\(\{column\}\) <= 253/);
});
