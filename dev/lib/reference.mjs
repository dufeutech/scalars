// Dev-only reference implementations of the rules dist/ describes as data.
// They exist to prove the written rules mean what they say; tools implement them in their own language.

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
