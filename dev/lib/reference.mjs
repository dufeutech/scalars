// Dev-only reference implementations of the rules dist/ describes as data.
// They exist to prove the written rules mean what they say; tools implement them in their own language.
import { readSource } from "./source.mjs";
import { modelOf } from "../codegen/model.mjs";

/** Lookup rule: the trim step, lowercase, each run of spaces and "-" becomes one "_"; exact name first, then alias. */
export function lookup(types, word) {
    const key = STEPS.lowercase(STEPS.trim(String(word))).replace(/[ -]+/g, "_");
    if (Object.hasOwn(types, key)) return types[key];
    for (const t of Object.values(types)) if (t.aliases?.includes(key)) return t;
    return null;
}

/** The five cleanup steps, exactly as schema/scalar.schema.json $defs.normalize_step describes them. */
// Unicode White_Space, listed so every language trims the same set (JS trim() differs at U+0085/U+FEFF).
// All of it is in the BMP, so one UTF-16 unit is one character here.
const isWhiteSpace = (c) => (c >= 0x09 && c <= 0x0d) || c === 0x20 || c === 0x85 || c === 0xa0 || c === 0x1680
    || (c >= 0x2000 && c <= 0x200a) || c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f || c === 0x3000;

/** Scans in from both ends: a regex trim is quadratic in backtracking engines on inner runs of spaces. */
function trim(s) {
    let start = 0;
    let end = s.length;
    while (start < end && isWhiteSpace(s.charCodeAt(start))) start++;
    while (end > start && isWhiteSpace(s.charCodeAt(end - 1))) end--;
    return start === 0 && end === s.length ? s : s.slice(start, end);
}

const STEPS = {
    trim,
    lowercase: (s) => s.toLowerCase(),
    uppercase: (s) => s.toUpperCase(),
    remove_spaces: (s) => s.replaceAll(" ", ""),
    remove_hyphens: (s) => s.replaceAll("-", ""),
};

/** Applies a type's normalize steps in order. */
export function normalize(t, value) {
    let s = String(value);
    for (const step of t.normalize ?? []) {
        const fn = STEPS[step];
        if (!fn) throw new Error(`Type "${t.name}" has unknown normalize step "${step}"`);
        s = fn(s);
    }
    return s;
}

// The checks, exactly as schema/scalar.schema.json $defs.check describes them. Each takes the normalized,
// pattern-matched value, so it is ASCII of the pattern's shape.
const gs1 = (s) => { let t = 0; for (let i = 0; i < s.length; i++) t += (s.charCodeAt(s.length - 1 - i) - 48) * (i % 2 ? 3 : 1); return t % 10 === 0; };
const mod97 = (s) => { let r = 0; for (const c of s) { const v = parseInt(c, 36); r = (v > 9 ? r * 100 + v : r * 10 + v) % 97; } return r === 1; };
const isbn10 = (s) => { let t = 0; for (let i = 0; i < 10; i++) t += (s[i] === "X" || s[i] === "x" ? 10 : s.charCodeAt(i) - 48) * (10 - i); return t % 11 === 0; };
const mod11_2 = (s) => { s = s.replaceAll("-", ""); let t = 0; for (let i = 0; i < s.length - 1; i++) t = ((t + s.charCodeAt(i) - 48) * 2) % 11; const r = (12 - t % 11) % 11; return s.at(-1) === (r === 10 ? "X" : String(r)); };
/** Digits compared as text: leading zeros dropped, then fewer digits is smaller and equal counts compare as text. O(n). */
const atMost = (digits, max) => { let i = 0; while (i < digits.length - 1 && digits[i] === "0") i++; const d = digits.slice(i); return d.length < max.length || (d.length === max.length && d <= max); };
export const CHECKS = {
    gs1_mod10: gs1,
    iso7064_mod97_10: mod97,
    iban: (s) => mod97(s.slice(4) + s.slice(0, 4)),
    isbn: (s) => (s.length === 13 ? gs1(s) : isbn10(s)),
    iso7064_mod11_2: mod11_2,
    int64_range: (s) => (s[0] === "-" ? atMost(s.slice(1), "9223372036854775808") : atMost(s, "9223372036854775807")),
    uint64_range: (s) => atMost(s, "18446744073709551615"),
};

const models = new WeakMap();
/** Length in code points (the library's length unit): a surrogate pair counts once, a lone surrogate once. */
export const codePoints = (s) => {
    let n = 0;
    for (let i = 0; i < s.length; i++) {
        n++;
        const c = s.charCodeAt(i);
        const next = s.charCodeAt(i + 1);
        if (c >= 0xd800 && c < 0xdc00 && next >= 0xdc00 && next < 0xe000) i++;
    }
    return n;
};

/** One frozen failure per reason of $meta.reasons (src/scalar.yaml $defs.reasons), so a failure allocates nothing. */
const FAIL = Object.fromEntries(Object.keys(readSource(new URL("../../src/scalar.yaml", import.meta.url)).$defs.reasons).map((r) => [r, Object.freeze({ ok: false, reason: r })]));

/**
 * Validates a value against a type, following the spec: text is trimmed, length-gated at maxLen
 * before case mapping, normalized, length-checked and pattern-matched; numbers are checked against bounds.
 * Returns { ok: true, value } where value is the normalized text or the integer, or { ok: false, reason }
 * where reason is the first rule the pass trips (REASON).
 */
export function validate(t, v) {
    if (!models.has(t)) {
        const list = t.schema?.enum ? new Set(t.schema.enum) : null;
        models.set(t, { m: modelOf(t), re: t.schema?.pattern ? new RegExp(t.schema.pattern, "u") : null, list });
    }
    const { m, re, list } = models.get(t);
    const inRange = (n) => (m.minimum === null || n >= m.minimum) && (m.maximum === null || n <= m.maximum);
    switch (m.kind) {
        case "text": {
            if (typeof v !== "string") return FAIL.wrong_kind;
            let s = v;
            // Once trimmed, before any other step (remove_* could join the halves of a pair): text already too long
            // fails, unless a remove_* step can shorten it, then text that is not Unicode scalar values
            // (WHATWG USVString, RFC 7493).
            const shortens = m.steps.some((step) => step === "remove_spaces" || step === "remove_hyphens");
            const formed = (s) => (m.maxLen !== null && !shortens && codePoints(s) > m.maxLen ? FAIL.too_long
                : s.isWellFormed() ? null : FAIL.malformed);
            let checked = false;
            // The length gate runs just before the first case step: remove_* steps shorten text, case steps never do.
            let gated = false;
            for (const step of m.steps) {
                if (!checked && step !== "trim") {
                    checked = true;
                    const f = formed(s);
                    if (f) return f;
                }
                if (!gated && (step === "lowercase" || step === "uppercase")) {
                    gated = true;
                    if (m.maxLen !== null && codePoints(s) > m.maxLen) return FAIL.too_long;
                }
                s = STEPS[step](s);
            }
            if (!checked) {
                const f = formed(s);
                if (f) return f;
            }
            const n = codePoints(s);
            if (m.maxLen !== null && n > m.maxLen) return FAIL.too_long;
            if (n < m.minLen) return FAIL.too_short;
            if (re && !re.test(s)) return FAIL.pattern;
            if (t.check && !CHECKS[t.check](s)) return FAIL.check;
            if (list && !list.has(s)) return FAIL.not_in_list;
            return { ok: true, value: s };
        }
        case "integer":
            if (typeof v !== "number" || !Number.isInteger(v)) return FAIL.wrong_kind;
            return inRange(v) ? { ok: true, value: v } : FAIL.out_of_range;
        case "number":
            if (typeof v !== "number") return FAIL.wrong_kind;
            return Number.isFinite(v) && inRange(v) ? { ok: true, value: v } : FAIL.out_of_range;
        case "boolean":
            return typeof v === "boolean" ? { ok: true, value: v } : FAIL.wrong_kind;
        case "object": {
            // Plain objects only (prototype Object.prototype or null), as every engine: not dates, maps or arrays.
            const proto = v !== null && typeof v === "object" ? Object.getPrototypeOf(v) : undefined;
            return proto === Object.prototype || proto === null ? { ok: true, value: v } : FAIL.wrong_kind;
        }
        case "array":
            return Array.isArray(v) ? { ok: true, value: v } : FAIL.wrong_kind;
        default:
            return { ok: true, value: v };
    }
}
