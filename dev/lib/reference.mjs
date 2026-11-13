// Dev-only reference implementations of the rules dist/ describes as data.
// They exist to prove the written rules mean what they say; tools implement them in their own language.

/** Lookup rule: case-insensitive, spaces and "-" become "_", exact type name first, then alias. */
export function lookup(types, word) {
    const key = String(word).trim().toLowerCase().replace(/[\s-]+/g, "_");
    if (Object.hasOwn(types, key)) return types[key];
    for (const t of Object.values(types)) if (t.aliases?.includes(key)) return t;
    return null;
}
