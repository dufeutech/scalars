// Reads dist/scalars.json the way a TypeScript tool would and checks every example plus cases.json.
// Run: node check.ts <dist/scalars.json> <cases.json>
import fs from "node:fs";

type Schema = { type?: string; pattern?: string; minLength?: number; maxLength?: number };
type Type = { name: string; aliases?: string[]; normalize?: string[]; schema: Schema; examples: { valid: unknown[]; invalid?: unknown[] } };

const [distPath, casesPath] = process.argv.slice(2);
const types: Record<string, Type> = JSON.parse(fs.readFileSync(distPath, "utf8")).types;
const cases = JSON.parse(fs.readFileSync(casesPath, "utf8"));

// The trim step's set (Unicode White_Space), written out: String.prototype.trim also strips U+FEFF.
const WS = "\\u0009-\\u000D\\u0020\\u0085\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000";
const TRIM = new RegExp(`^[${WS}]+|[${WS}]+$`, "gu");
const STEPS: Record<string, (s: string) => string> = {
    trim: (s) => s.replace(TRIM, ""),
    lowercase: (s) => s.toLowerCase(),
    uppercase: (s) => s.toUpperCase(),
    remove_spaces: (s) => s.replaceAll(" ", ""),
    remove_hyphens: (s) => s.replaceAll("-", ""),
};
const normalize = (steps: string[], s: string) => steps.reduce((v, step) => STEPS[step](v), s);

function lookup(word: string): string | null {
    const key = STEPS.lowercase(STEPS.trim(word)).replace(/[ -]+/g, "_");
    if (Object.hasOwn(types, key)) return key;
    return Object.values(types).find((t) => t.aliases?.includes(key))?.name ?? null;
}

const regexes = new Map<string, RegExp>();
function matches(t: Type, s: string): boolean {
    const { pattern, minLength, maxLength } = t.schema;
    const n = [...s].length; // code points
    if (minLength !== undefined && n < minLength) return false;
    if (maxLength !== undefined && n > maxLength) return false;
    if (!pattern) return true;
    if (!regexes.has(t.name)) regexes.set(t.name, new RegExp(pattern, "u"));
    return regexes.get(t.name)!.test(s);
}

const fails: string[] = [];
for (const t of Object.values(types)) {
    if (t.schema.type !== "string") continue;
    for (const v of t.examples.valid) if (typeof v === "string" && !matches(t, v)) fails.push(`${t.name} rejects valid ${JSON.stringify(v)}`);
    for (const v of t.examples.invalid ?? []) if (typeof v === "string" && matches(t, v)) fails.push(`${t.name} accepts invalid ${JSON.stringify(v)}`);
}
for (const c of cases.normalize) {
    const got = normalize(c.steps, c.in);
    if (got !== c.out) fails.push(`normalize ${JSON.stringify(c.in)} ${c.steps} = ${JSON.stringify(got)}, want ${JSON.stringify(c.out)}`);
}
for (const c of cases.lookup) {
    const got = lookup(c.in);
    if (got !== c.out) fails.push(`lookup ${JSON.stringify(c.in)} = ${got}, want ${c.out}`);
}
for (const c of cases.match) {
    if (matches(types[c.type], c.in) !== c.ok) fails.push(`${c.type} on ${JSON.stringify(c.in)}: want ${c.ok}`);
}

console.log(fails.length ? fails.join("\n") : `ts: ok, ${Object.keys(types).length} types`);
process.exit(fails.length ? 1 : 0);
