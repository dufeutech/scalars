// Dev-only reference implementations of the rules dist/ describes as data.
// They exist to prove the written rules mean what they say; tools implement them in their own language.
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

const models = new WeakMap();
const codePoints = (s) => { let n = 0; for (let i = 0; i < s.length; i++) { n++; if (s.charCodeAt(i) >= 0xd800 && s.charCodeAt(i) < 0xdc00) i++; } return n; };

/**
 * Validates a value against a type, following the spec: text is trimmed, length-gated at maxLen
 * before case mapping, normalized, length-checked and pattern-matched; numbers are checked against bounds.
 * Returns { ok, value } where value is the normalized text or the integer.
 */
export function validate(t, v) {
    if (!models.has(t)) models.set(t, { m: modelOf(t), re: t.schema?.pattern ? new RegExp(t.schema.pattern, "u") : null });
    const { m, re } = models.get(t);
    const fail = { ok: false };
    const inRange = (n) => (m.minimum === null || n >= m.minimum) && (m.maximum === null || n <= m.maximum);
    switch (m.kind) {
        case "text": {
            // Text must be Unicode scalar values (WHATWG USVString, RFC 7493): a lone surrogate fails first.
            if (typeof v !== "string" || !v.isWellFormed()) return fail;
            let s = v;
            // The length gate runs just before the first case step: remove_* steps shorten text, case steps never do.
            let gated = false;
            for (const step of m.steps) {
                if (!gated && (step === "lowercase" || step === "uppercase")) {
                    gated = true;
                    if (m.maxLen !== null && codePoints(s) > m.maxLen) return fail;
                }
                s = STEPS[step](s);
            }
            const n = codePoints(s);
            if (n < m.minLen || (m.maxLen !== null && n > m.maxLen)) return fail;
            if (re && !re.test(s)) return fail;
            return { ok: true, value: s };
        }
        case "integer":
            return typeof v === "number" && Number.isInteger(v) && inRange(v) ? { ok: true, value: v } : fail;
        case "number":
            return typeof v === "number" && Number.isFinite(v) && inRange(v) ? { ok: true, value: v } : fail;
        case "boolean":
            return typeof v === "boolean" ? { ok: true, value: v } : fail;
        case "object": {
            // Plain objects only (prototype Object.prototype or null), as every engine: not dates, maps or arrays.
            const proto = v !== null && typeof v === "object" ? Object.getPrototypeOf(v) : undefined;
            return proto === Object.prototype || proto === null ? { ok: true, value: v } : fail;
        }
        case "array":
            return Array.isArray(v) ? { ok: true, value: v } : fail;
        default:
            return { ok: true, value: v };
    }
}
