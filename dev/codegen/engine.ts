/** A value failed a type's rule. `message` is the type's `error` text; `scalar` is the type. */
export class ScalarError extends Error {
    readonly scalar: Scalar<unknown>;

    constructor(scalar: Scalar<unknown>) {
        super(scalar.error);
        this.name = "ScalarError";
        this.scalar = scalar;
    }
}

// Unicode White_Space, written out: String.prototype.trim also strips U+FEFF, which is not white space.
// All of it is in the BMP, so one UTF-16 unit is one character here.
function isWhiteSpace(c: number): boolean {
    return (c >= 0x09 && c <= 0x0d) || c === 0x20 || c === 0x85 || c === 0xa0 || c === 0x1680
        || (c >= 0x2000 && c <= 0x200a) || c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f || c === 0x3000;
}

/** Scans in from both ends and returns `s` itself when nothing was cut. */
function trim(s: string): string {
    let start = 0;
    let end = s.length;
    while (start < end && isWhiteSpace(s.charCodeAt(start))) start++;
    while (end > start && isWhiteSpace(s.charCodeAt(end - 1))) end--;
    return start === 0 && end === s.length ? s : s.slice(start, end);
}

type Step = "trim" | "lowercase" | "uppercase" | "remove_spaces" | "remove_hyphens";

// Each step by name, resolved once per type in the Scalar constructor. No regex: the string methods are linear.
const STEPS: Readonly<Record<Step, (s: string) => string>> = {
    trim,
    lowercase: (s) => s.toLowerCase(),
    uppercase: (s) => s.toUpperCase(),
    remove_spaces: (s) => s.replaceAll(" ", ""),
    remove_hyphens: (s) => s.replaceAll("-", ""),
};

/** True when a low surrogate sits at `i`, so the unit before it is the first half of a pair. */
function isLow(s: string, i: number): boolean {
    const c = s.charCodeAt(i);
    return c >= 0xdc00 && c < 0xe000;
}

/** True when `s` has more than `max` code points. Counts only when the UTF-16 length leaves it open, and stops at `max + 1`. */
function longerThan(s: string, max: number): boolean {
    if (s.length <= max) return false;
    let n = 0;
    for (let i = 0; i < s.length; i++) {
        if (++n > max) return true;
        const c = s.charCodeAt(i);
        if (c >= 0xd800 && c < 0xdc00 && isLow(s, i + 1)) i++;
    }
    return false;
}

/** True when `s` has fewer than `min` code points. The UTF-16 length bounds the count: n <= length <= 2n. */
function shorterThan(s: string, min: number): boolean {
    if (min === 0 || s.length >= 2 * min) return false;
    if (s.length < min) return true;
    let n = 0;
    for (let i = 0; i < s.length && n < min; i++) {
        n++;
        const c = s.charCodeAt(i);
        if (c >= 0xd800 && c < 0xdc00 && isLow(s, i + 1)) i++;
    }
    return n < min;
}

/** String.prototype.isWellFormed (ES2024), typed here so the file also checks under an older `lib`. */
interface WellFormed {
    isWellFormed(): boolean;
}

// Node < 20 and Safari < 16.4 lack isWellFormed; there the check falls back to a loop.
const hasWellFormed = typeof (String.prototype as Partial<WellFormed>).isWellFormed === "function";

/** True when `s` has no lone surrogate. One pass, no allocation: the fallback for isWellFormed. */
function wellFormedLoop(s: string): boolean {
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        if (c >= 0xd800 && c < 0xe000) {
            if (c >= 0xdc00 || !isLow(s, i + 1)) return false;
            i++;
        }
    }
    return true;
}

/** Text is Unicode scalar values only (WHATWG USVString, RFC 7493). Linear, allocates nothing. */
function isWellFormed(s: string): boolean {
    return hasWellFormed ? (s as string & WellFormed).isWellFormed() : wellFormedLoop(s);
}

/** A plain object: prototype is Object.prototype or null. Dates, maps and class instances are not. */
function isPlainObject(v: unknown): boolean {
    if (typeof v !== "object" || v === null) return false;
    const proto = Object.getPrototypeOf(v);
    return proto === Object.prototype || proto === null;
}

const NO = Symbol("not valid"); // what `check` returns for "not valid"; a value can never be this symbol

type Kind = "text" | "integer" | "number" | "boolean" | "object" | "array" | "any";

/** The fields a type is built from. */
export interface ScalarInit {
    readonly name: string;
    readonly label: string;
    readonly hint: string;
    readonly error: string;
    readonly details: string;
    readonly level: string;
    readonly primitive: string;
    readonly aliases: readonly string[];
    readonly examples: { readonly valid: readonly unknown[]; readonly invalid: readonly unknown[] };
    readonly kind?: Kind;
    readonly steps?: readonly Step[];
    readonly pattern?: string;
    readonly minLen?: number;
    readonly maxLen?: number;
    readonly minimum?: number;
    readonly maximum?: number;
}

/** One scalar type. Instances are plain records; the regex is compiled on first use. */
export class Scalar<T> {
    readonly name: string;
    readonly label: string;
    readonly hint: string;
    readonly error: string;
    readonly details: string;
    readonly level: string;
    readonly primitive: string;
    readonly aliases: readonly string[];
    /**
     * `invalid` values break the type's raw rule (pattern, length or bounds) before any cleanup; a few become
     * valid after `normalize` (country "us" -> "US").
     */
    readonly examples: { readonly valid: readonly unknown[]; readonly invalid: readonly unknown[] };
    private readonly kind: Kind;
    private readonly steps: readonly ((s: string) => string)[];
    private readonly caseAt: number; // index of the first case step, or -1
    private readonly formAt: number; // index of the first step that is not trim, or steps.length
    private readonly early: boolean; // a maxLen and no step that shortens text: refuse overlong text once trimmed
    private readonly pattern: string | undefined;
    private readonly minLen: number;
    private readonly maxLen: number; // Infinity when unbounded
    private readonly minimum: number;
    private readonly maximum: number;
    private rx: RegExp | undefined = undefined;
    private static index: Map<string, Scalar<unknown>> | undefined = undefined; // every name and alias, built on the first lookup
    private static readonly wellFormedLoop = wellFormedLoop; // reachable for the runner, which tests the fallback

    constructor(init: ScalarInit) {
        this.name = init.name;
        this.label = init.label;
        this.hint = init.hint;
        this.error = init.error;
        this.details = init.details;
        this.level = init.level;
        this.primitive = init.primitive;
        this.aliases = init.aliases;
        this.examples = init.examples;
        this.kind = init.kind ?? "any";
        const names = init.steps ?? [];
        this.steps = names.map((s) => {
            if (!Object.hasOwn(STEPS, s)) throw new Error(`unknown normalize step "${s}"`); // fails here, not on first use
            return STEPS[s];
        });
        // The length gate runs just before the first case step: case mapping never shortens text, but
        // remove_spaces and remove_hyphens do.
        this.caseAt = names.findIndex((s) => s === "lowercase" || s === "uppercase");
        // The well-formed check runs once trimming is done, before any other step: trim cannot join two halves of
        // a pair, but remove_spaces and remove_hyphens could.
        const formAt = names.findIndex((s) => s !== "trim");
        this.formAt = formAt === -1 ? names.length : formAt;
        this.early = init.maxLen !== undefined && !names.some((s) => s === "remove_spaces" || s === "remove_hyphens");
        this.pattern = init.pattern;
        this.minLen = init.minLen ?? 0;
        this.maxLen = init.maxLen ?? Infinity;
        this.minimum = init.minimum ?? -Infinity;
        this.maximum = init.maximum ?? Infinity;
    }

    /** Apply the type's normalize steps in order. Identity for types that are not text. */
    normalize(s: string): string {
        if (this.kind === "text") for (const step of this.steps) s = step(s);
        return s;
    }

    /** Normalize (text), then check kind, length, pattern and bounds. Returns the clean value or throws ScalarError. */
    validate(v: unknown): T {
        const r = this.check(v);
        if (r === NO) throw new ScalarError(this);
        return r as T;
    }

    /** True exactly when `validate(v)` would succeed. Never builds an error. */
    isValid(v: unknown): boolean {
        return this.check(v) !== NO;
    }

    /** Once trimmed: not already too long (O(1): a code point is at most two units), then well-formed. */
    private formed(s: string): boolean {
        if (this.early && Math.ceil(s.length / 2) > this.maxLen) return false;
        return isWellFormed(s);
    }

    private check(v: unknown): unknown {
        switch (this.kind) {
            case "text": {
                if (typeof v !== "string") return NO;
                let s = v;
                const steps = this.steps;
                const gate = this.caseAt;
                const form = this.formAt;
                for (let i = 0; i < steps.length; i++) {
                    if (i === form && !this.formed(s)) return NO;
                    // Text already too long is refused before case mapping copies it.
                    if (i === gate && longerThan(s, this.maxLen)) return NO;
                    s = steps[i](s);
                }
                if (form === steps.length && !this.formed(s)) return NO;
                if (longerThan(s, this.maxLen) || shorterThan(s, this.minLen)) return NO;
                if (this.pattern !== undefined) {
                    const rx = (this.rx ??= new RegExp(this.pattern, "u"));
                    if (!rx.test(s)) return NO;
                }
                return s;
            }
            case "integer":
                return typeof v === "number" && Number.isInteger(v) && v >= this.minimum && v <= this.maximum ? v : NO;
            case "number":
                return typeof v === "number" && Number.isFinite(v) && v >= this.minimum && v <= this.maximum ? v : NO;
            case "boolean":
                return typeof v === "boolean" ? v : NO;
            case "object":
                return isPlainObject(v) ? v : NO;
            case "array":
                return Array.isArray(v) ? v : NO;
            default:
                return v;
        }
    }
}

/** The lookup key: trim, lowercase, each run of spaces and hyphens becomes one underscore. One pass, no regex. */
function clean(word: string): string {
    const s = trim(word).toLowerCase();
    if (!s.includes(" ") && !s.includes("-")) return s;
    let out = "";
    let gap = false;
    for (const ch of s) {
        if (ch === " " || ch === "-") {
            gap = true;
        } else {
            if (gap) {
                out += "_";
                gap = false;
            }
            out += ch;
        }
    }
    return gap ? out + "_" : out;
}

/** Find a type by name or alias; spacing, hyphens and case are forgiven. Nothing found gives undefined. */
function find(word: unknown, all: readonly Scalar<unknown>[]): Scalar<unknown> | undefined {
    if (typeof word !== "string") return undefined;
    let map = Scalar["index"]; // bracket access: `index` is private to the class, and find is the one reader
    if (map === undefined) {
        map = new Map();
        for (const t of all) map.set(t.name, t);
        for (const t of all) for (const alias of t.aliases) if (!map.has(alias)) map.set(alias, t);
        Scalar["index"] = map;
    }
    const found = map.get(word);
    if (found !== undefined) return found;
    const key = clean(word);
    return key === word ? undefined : map.get(key);
}
