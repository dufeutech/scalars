// Dev-only: values generated into dist/ from the core rule, never written in source.

/** Characters the `v` flag requires (syntax) or allows (reserved punctuators) escaped inside [...]. */
const CLASS_ESCAPE = new Set("()[]{}/|&!#$%*+,.:;<=>?@^`~");

/**
 * HTML `pattern` from a JSON Schema pattern: drop the ^...$ anchors (the attribute is implicitly
 * anchored) and escape what the `v` flag rejects inside character classes.
 */
export function htmlPattern(jsonPattern) {
    if (!jsonPattern.startsWith("^") || !jsonPattern.endsWith("$")) {
        throw new Error(`Pattern must be anchored with ^...$: ${jsonPattern}`);
    }
    const p = jsonPattern.slice(1, -1);
    let out = "";
    let inClass = false;
    let classStart = false; // just after "[" or "[^"
    for (let i = 0; i < p.length; i++) {
        const c = p[i];
        if (c === "\\") {
            out += p.slice(i, i + 2);
            i++;
            classStart = false;
            continue;
        }
        if (!inClass) {
            out += c;
            if (c === "[") {
                inClass = true;
                classStart = true;
                if (p[i + 1] === "^") { out += "^"; i++; }
            }
            continue;
        }
        if (c === "]" && !classStart) {
            inClass = false;
            out += c;
        } else if (c === "-") {
            const isRange = !classStart && p[i + 1] !== undefined && p[i + 1] !== "]";
            out += isRange ? "-" : "\\-";
        } else {
            out += CLASS_ESCAPE.has(c) ? "\\" + c : c;
        }
        classStart = false;
    }
    return out;
}

export const sqlString = (s) => "'" + String(s).replace(/'/g, "''") + "'";

const TEXT_COLUMNS = new Set(["text", "varchar"]);
const INT_RANGES = {
    smallint: [-32768n, 32767n],
    integer: [-2147483648n, 2147483647n],
    bigint: [-9223372036854775808n, 9223372036854775807n],
};

/** The CHECK constraint for a resolved type, with a {column} placeholder, or null. */
export function pgCheck(t) {
    const pg = t.postgres ?? {};
    if (pg.check_extra) return pg.check_extra;
    if (TEXT_COLUMNS.has(pg.type) && t.pattern) return `CHECK ({column} ~ ${sqlString(t.pattern)})`;
    const native = INT_RANGES[pg.type];
    if (native && t.minimum !== undefined && t.maximum !== undefined) {
        const [lo, hi] = [BigInt(t.minimum), BigInt(t.maximum)];
        if (lo !== native[0] || hi !== native[1]) return `CHECK ({column} BETWEEN ${lo} AND ${hi})`;
    }
    return null;
}

const SCHEMA_KEYS = ["type", "format", "pattern", "minimum", "maximum", "contentEncoding"];

/** A plain JSON Schema (OpenAPI 3.1 compatible) for one resolved type. */
export function toJsonSchema(t) {
    const s = {};
    for (const k of SCHEMA_KEYS) if (t[k] !== undefined) s[k] = t[k];
    if (t.label !== undefined) s.title = t.label;
    if (t.hint !== undefined) s.description = t.hint;
    if (t.examples?.valid) s.examples = t.examples.valid;
    return s;
}

const PATTERN_INPUTS = new Set(["text", "tel", "search", "password"]);

/** Adds generated keys to a resolved type's target blocks (mutates and returns t). */
export function applyGenerated(t) {
    const h = t.html;
    if (h?.element === "input" && PATTERN_INPUTS.has(h.attrs?.type) && t.pattern) {
        h.attrs = { ...h.attrs, pattern: htmlPattern(t.pattern) };
        // The browser shows title when the pattern fails; placeholder shows the shape before typing.
        if (t.error) h.attrs.title = t.error;
        if (t.examples?.valid?.length) h.attrs.placeholder = String(t.examples.valid[0]);
    }
    const check = pgCheck(t);
    delete t.postgres.check_extra;
    if (check) t.postgres.check = check;
    return t;
}
