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
const WS = "\\u0009-\\u000D\\u0020\\u0085\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000";
const TRIM = new RegExp(`^[${WS}]+|[${WS}]+$`, "gu");

const STEPS = {
    trim: (s) => s.replace(TRIM, ""),
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
