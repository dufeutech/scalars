// scalars.ts, catalogue version 0.8.0.
// Generated from dist/scalars.json by dev/codegen/ts.mjs. Do not edit: run `npm run build` in dev/.
// Requires TypeScript >= 5.6 or Node >= 22.18 (tested on Node 24). Erasable syntax only. No dependencies.
/**
 * A value failed a type's rule. `message` is the type's `error` text; `scalar` is the type; `reason` is the first
 * rule the value broke ($meta.reasons).
 */
export class ScalarError extends Error {
    readonly scalar: Scalar<unknown>;
    readonly reason: Reason;

    constructor(scalar: Scalar<unknown>, reason: Reason) {
        super(scalar.error);
        this.name = "ScalarError";
        this.scalar = scalar;
        this.reason = reason;
    }
}

/** What `run` returns for "not valid": one module constant per reason (FAIL), so it allocates nothing. */
class Failure {
    readonly reason: Reason;

    constructor(reason: Reason) {
        this.reason = reason;
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

type Check = "gs1_mod10" | "iso7064_mod97_10" | "iban" | "isbn" | "iso7064_mod11_2" | "int64_range" | "uint64_range";

// The checks of $meta.checks. Each runs on the normalized value after the pattern matched, so it reads ASCII of the
// pattern's shape: one UTF-16 unit per character, and digits where the pattern put digits. All are O(n).
const digit = (s: string, i: number): number => s.charCodeAt(i) - 48;

function gs1Mod10(s: string): boolean {
    let t = 0;
    for (let i = 0; i < s.length; i++) t += digit(s, s.length - 1 - i) * (i % 2 ? 3 : 1);
    return t % 10 === 0;
}

/** ISO 7064 MOD 97-10 over `s` from `from` to the end, then over `s` up to `from`: one pass, no rotated copy. */
function mod97(s: string, from: number): boolean {
    let r = 0;
    for (let k = 0; k < s.length; k++) {
        const c = s.charCodeAt((from + k) % s.length);
        r = c >= 65 ? (r * 100 + c - 55) % 97 : (r * 10 + c - 48) % 97; // A-Z are 10-35
    }
    return r === 1;
}

function isbn(s: string): boolean {
    if (s.length === 13) return gs1Mod10(s);
    let t = 0;
    for (let i = 0; i < 10; i++) t += (s[i] === "X" || s[i] === "x" ? 10 : digit(s, i)) * (10 - i);
    return t % 11 === 0;
}

function mod11_2(s: string): boolean {
    let t = 0;
    for (let i = 0; i < s.length - 1; i++) if (s[i] !== "-") t = ((t + digit(s, i)) * 2) % 11; // reduced each step: exact at any length
    const r = (12 - (t % 11)) % 11;
    return s[s.length - 1] === (r === 10 ? "X" : String(r));
}

/** Digits from `from` compared with `max` as text: leading zeros skipped, then fewer digits is smaller. */
function atMost(s: string, from: number, max: string): boolean {
    let i = from;
    while (i < s.length - 1 && s[i] === "0") i++;
    const n = s.length - i;
    if (n !== max.length) return n < max.length;
    return s.slice(i) <= max;
}

const CHECKS: Readonly<Record<Check, (s: string) => boolean>> = {
    gs1_mod10: gs1Mod10,
    iso7064_mod97_10: (s) => mod97(s, 0),
    iban: (s) => mod97(s, 4),
    isbn,
    iso7064_mod11_2: mod11_2,
    int64_range: (s) => (s[0] === "-" ? atMost(s, 1, "9223372036854775808") : atMost(s, 0, "9223372036854775807")),
    uint64_range: (s) => atMost(s, 0, "18446744073709551615"),
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

type Kind = "text" | "integer" | "number" | "boolean" | "object" | "array" | "any";

/** The limits of one setting in $meta.params; a limit it does not have is null. */
interface ParamRule {
    readonly kind: "integer" | "boolean" | "array";
    readonly minimum: number | null;
    readonly maximum: number | null;
    readonly minItems: number | null;
    readonly maxItemBytes: number | null;
}

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
    readonly params?: readonly string[];
    readonly examples: { readonly valid: readonly unknown[]; readonly invalid: readonly unknown[] };
    readonly kind?: Kind;
    readonly steps?: readonly Step[];
    readonly pattern?: string;
    readonly check?: Check;
    readonly list?: readonly string[];
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
    /** Names from $meta.params that a field of this type can set. */
    readonly params: readonly string[];
    /** The name of the rule beyond the pattern ($meta.checks), or undefined. */
    readonly check: string | undefined;
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
    private readonly test: ((s: string) => boolean) | undefined;
    private readonly list: ReadonlySet<string> | undefined; // the type's enum: a closed list, checked last
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
        this.params = init.params ?? [];
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
        this.check = init.check;
        if (init.check !== undefined && !Object.hasOwn(CHECKS, init.check)) throw new Error(`unknown check "${init.check}"`);
        this.test = init.check === undefined ? undefined : CHECKS[init.check];
        this.list = init.list === undefined ? undefined : new Set(init.list);
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
        const r = this.run(v);
        if (r instanceof Failure) throw new ScalarError(this, r.reason);
        return r as T;
    }

    /** True exactly when `validate(v)` would succeed. Never builds an error. */
    isValid(v: unknown): boolean {
        return !(this.run(v) instanceof Failure);
    }

    /** Once trimmed: not already too long (counting stops at maxLen + 1), then well-formed. The failure, or undefined. */
    private formed(s: string): Failure | undefined {
        if (this.early && longerThan(s, this.maxLen)) return FAIL.TooLong;
        return isWellFormed(s) ? undefined : FAIL.Malformed;
    }

    private run(v: unknown): unknown {
        switch (this.kind) {
            case "text": {
                if (typeof v !== "string") return FAIL.WrongKind;
                let s = v;
                const steps = this.steps;
                const gate = this.caseAt;
                const form = this.formAt;
                for (let i = 0; i < steps.length; i++) {
                    if (i === form) {
                        const f = this.formed(s);
                        if (f !== undefined) return f;
                    }
                    // Text already too long is refused before case mapping copies it.
                    if (i === gate && longerThan(s, this.maxLen)) return FAIL.TooLong;
                    s = steps[i](s);
                }
                if (form === steps.length) {
                    const f = this.formed(s);
                    if (f !== undefined) return f;
                }
                if (longerThan(s, this.maxLen)) return FAIL.TooLong;
                if (shorterThan(s, this.minLen)) return FAIL.TooShort;
                if (this.pattern !== undefined) {
                    const rx = (this.rx ??= new RegExp(this.pattern, "u"));
                    if (!rx.test(s)) return FAIL.Pattern;
                }
                if (this.test !== undefined && !this.test(s)) return FAIL.Check;
                if (this.list !== undefined && !this.list.has(s)) return FAIL.NotInList;
                return s;
            }
            case "integer":
                if (typeof v !== "number" || !Number.isInteger(v)) return FAIL.WrongKind;
                return v >= this.minimum && v <= this.maximum ? v : FAIL.OutOfRange;
            case "number":
                if (typeof v !== "number") return FAIL.WrongKind;
                return Number.isFinite(v) && v >= this.minimum && v <= this.maximum ? v : FAIL.OutOfRange;
            case "boolean":
                return typeof v === "boolean" ? v : FAIL.WrongKind;
            case "object":
                return isPlainObject(v) ? v : FAIL.WrongKind;
            case "array":
                return Array.isArray(v) ? v : FAIL.WrongKind;
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

// Models: a file of domains, models and fields (parsed JSON), loaded once, then payloads checked against a model.
// A port of dev/lib/models.mjs, the reference every engine copies. Load is O(file) and iterative: no recursion is
// driven by the input. Validate recurses, but load bounds a payload's depth at MAX_DEPTH levels.

/** The key only models() holds: a Model or Models built by hand would skip load's checks. */
const INTERNAL: unique symbol = Symbol("models()");

/** The UTF-8 length of well-formed text, counted over its UTF-16 code units: each half of a pair is 2 bytes. */
function utf8Length(s: string): number {
    let n = 0;
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        n += c < 0x80 ? 1 : c < 0x800 || (c >= 0xd800 && c <= 0xdfff) ? 2 : 3;
    }
    return n;
}

/** Refuses a constructor call from outside this module. */
function internalOnly(key: unknown, what: string): void {
    if (key !== INTERNAL) throw new TypeError(`${what} is built by models(), not by new`);
}

/** One problem: an RFC 6901 `pointer`, a fixed `code`, the `params` the message needs, the English `message`. */
export type Problem = {
    readonly pointer: string;
    readonly code: string;
    readonly params: Readonly<Record<string, unknown>>;
    readonly message: string;
};

const joinProblems = (problems: readonly Problem[]): string => problems.map((p) => `${p.pointer}: ${p.message}`).join("; ");

/** A models file was refused. `problems` lists every problem in it, sorted by location. */
export class ModelsError extends Error {
    readonly problems: readonly Problem[];

    constructor(problems: readonly Problem[]) {
        super(joinProblems(problems));
        this.name = "ModelsError";
        this.problems = problems;
    }
}

/** A payload failed its model. `problems` lists every problem in it, sorted by location. */
export class ModelError extends Error {
    readonly problems: readonly Problem[];

    constructor(problems: readonly Problem[]) {
        super(joinProblems(problems));
        this.name = "ModelError";
        this.problems = problems;
    }
}

/** A key or a list index: one step of a location. */
type Segment = string | number;

/** A problem paired with its decoded segments, which its order needs: a key "10" and an index 10 differ. */
type Located = { readonly segments: readonly Segment[]; readonly problem: Problem };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const escapeSegment = (s: Segment): string => String(s).replaceAll("~", "~0").replaceAll("/", "~1");

/** The code's ERRORS template with each `{name}` replaced: a list joined with ", ", anything else as text. */
function fill(code: string, params: Readonly<Record<string, unknown>>): string {
    const template = ERRORS[code];
    if (!template.includes("{")) return template;
    return template.replace(/\{([a-z_]+)\}/g, (_, name: string) => {
        if (!Object.hasOwn(params, name)) throw new Error(`Code "${code}" needs param "${name}"`);
        const v = params[name];
        return Array.isArray(v) ? v.join(", ") : String(v);
    });
}

/** A problem at `segments`. A code without a template (a reason like `pattern`, whose text is the type's `error`) needs `message`. */
function locate(segments: readonly Segment[], code: string, params: Readonly<Record<string, unknown>>, message?: string): Located {
    let text: string;
    if (Object.hasOwn(ERRORS, code)) text = fill(code, params);
    else if (typeof message === "string") text = message;
    else throw new Error(`Code "${code}" has no template, so it needs a message`);
    let pointer = "";
    for (const s of segments) pointer += "/" + escapeSegment(s);
    return { segments, problem: { pointer, code, params, message: text } };
}

/** Compares two strings by code point (JS `<` compares UTF-16 units, which misorders text outside the BMP). */
function compareText(a: string, b: string): number {
    let i = 0;
    while (i < a.length && i < b.length) {
        const ca = a.codePointAt(i) as number;
        const cb = b.codePointAt(i) as number;
        if (ca !== cb) return ca - cb;
        i += ca > 0xffff ? 2 : 1;
    }
    return a.length - b.length;
}

/** Segment by segment: list indices numerically, keys by code point, an index before a key; a parent first; then by code. */
function compareLocated(a: Located, b: Located): number {
    const x = a.segments;
    const y = b.segments;
    for (let i = 0; i < x.length && i < y.length; i++) {
        const sx = x[i];
        const sy = y[i];
        if (sx === sy) continue;
        if (typeof sx === "number" && typeof sy === "number") return sx - sy;
        if (typeof sx === "number") return -1;
        if (typeof sy === "number") return 1;
        return compareText(sx, sy);
    }
    return x.length - y.length || compareText(a.problem.code, b.problem.code);
}

const sorted = (located: Located[]): readonly Problem[] => located.sort(compareLocated).map((l) => l.problem);

/** Built on the first models() call, not at import: the name patterns and the settings each type takes. */
interface Catalogue {
    readonly name: RegExp;
    readonly ref: RegExp;
    readonly settings: ReadonlyMap<string, readonly string[]>;
}

/** The type whose canonical name is exactly `name`, or undefined: get() forgives aliases, a models file doesn't. */
function typeNamed(name: string): Scalar<unknown> | undefined {
    const found = scalars.get(name);
    return found !== undefined && found.name === name ? found : undefined;
}

/** A resolved field: kind "type" (a scalar and its settings), "model" (a full model name) or "array" (`items`). */
class ModelField {
    readonly kind: "type" | "model" | "array";
    readonly nullable: boolean;
    readonly type: Scalar<unknown> | null;
    readonly settings: Readonly<Record<string, unknown>> | null;
    /** The set of `values`, built once per written list and shared by its copies. */
    readonly allowed: ReadonlySet<unknown> | null;
    readonly model: string;
    readonly items: ModelField | null;
    /** The loaded Model named `model`, bound once the file has loaded. */
    target: Model | null = null;
    // The settings validate reads, unpacked once here.
    readonly length: number | null;
    readonly values: readonly string[] | null;
    readonly precision: number | null;
    readonly scale: number;
    /** Whether validate has any setting to check after the type's own: a plain field skips those reads. */
    readonly limited: boolean;

    constructor(kind: "type" | "model" | "array", nullable: boolean, type: Scalar<unknown> | null, settings: Readonly<Record<string, unknown>> | null,
        allowed: ReadonlySet<unknown> | null, model: string, items: ModelField | null) {
        this.kind = kind;
        this.nullable = nullable;
        this.type = type;
        this.settings = settings;
        this.allowed = allowed;
        this.model = model;
        this.items = items;
        const s: Readonly<Record<string, unknown>> = settings ?? {};
        this.length = Object.hasOwn(s, "length") ? (s.length as number) : null;
        this.values = Object.hasOwn(s, "values") ? (s.values as readonly string[]) : null;
        this.precision = Object.hasOwn(s, "precision") ? (s.precision as number) : null;
        this.scale = Object.hasOwn(s, "scale") ? (s.scale as number) : 0;
        this.limited = this.length !== null || this.values !== null || this.precision !== null;
    }
}

/** What a written field names: a type, a model, or another field it copies. */
type Ref = { readonly kind: "type"; readonly type: Scalar<unknown> }
    | { readonly kind: "model"; readonly target: ModelNode }
    | { readonly kind: "field"; readonly target: Def };

/** A written field, or an `items` definition (linked to its parent instead of copying the path), during load. */
class Def {
    readonly isModel = false;
    readonly segments: readonly Segment[] | null;
    readonly up: Def | null;
    readonly raw: unknown;
    readonly domain: string;
    ref: Ref | null = null;
    items: Def | null = null;
    field: ModelField | null = null;
    leaf: ModelNode | null = null; // the model this field nests, through any `items`
    arrays = 0; // how many `items` levels lie on the way to it
    failed = false;
    index = -1;
    low = -1;
    onStack = false;
    done = false;
    selfLoop = false;

    constructor(segments: readonly Segment[] | null, raw: unknown, domain: string, up: Def | null) {
        this.segments = segments;
        this.raw = raw;
        this.domain = domain;
        this.up = up;
    }

    /** The segments, built only for a problem, so a deep `items` chain stays linear. */
    path(...extra: Segment[]): Segment[] {
        let tail = 0;
        let d: Def = this;
        while (d.up !== null) {
            tail++;
            d = d.up;
        }
        const out: Segment[] = [...(d.segments as readonly Segment[])];
        for (let i = 0; i < tail; i++) out.push("items");
        out.push(...extra);
        return out;
    }
}

/** A model during load. */
class ModelNode {
    readonly isModel = true;
    readonly name: string;
    readonly fields = new Map<string, Def>();
    readonly list: Def[] = [];
    index = -1;
    low = -1;
    onStack = false;
    done = false;
    selfLoop = false;

    constructor(name: string) {
        this.name = name;
    }
}

/** One frame of the explicit Tarjan stack: a node and how many of its edges it has followed. */
type Frame = { readonly node: Def | ModelNode; step: number };

/** One load of a models file: the steps of dev/lib/models.mjs loadModels, in order. */
class Loader {
    readonly problems: Located[] = [];
    readonly nodes = new Map<string, ModelNode>(); // "domain:model" -> model node
    readonly defs: Def[] = []; // every written field, in file order
    readonly fields: ModelField[] = []; // every field resolve built, `items` included: models() binds their targets
    private readonly cat: Catalogue;

    constructor(data: Record<string, unknown>, cat: Catalogue) {
        this.cat = cat;
        this.names(data);
        for (const d of this.defs) this.parse(d);
        this.resolveAll();
        this.depths();
    }

    private report(segments: readonly Segment[], code: string, params: Record<string, unknown> = {}): void {
        this.problems.push(locate(segments, code, params));
    }

    /** 1. Names. A badly named entry is reported and its content isn't examined. */
    private names(data: Record<string, unknown>): void {
        const rx = this.cat.name;
        for (const [d, domain] of Object.entries(data)) {
            if (d === "$schema") continue;
            if (!rx.test(d)) { this.report([d], "bad_name"); continue; }
            if (!isObject(domain)) { this.report([d], "not_object"); continue; }
            for (const [m, fields] of Object.entries(domain)) {
                if (!rx.test(m)) { this.report([d, m], "bad_name"); continue; }
                if (typeNamed(m) !== undefined) { this.report([d, m], "type_name"); continue; }
                if (!isObject(fields)) { this.report([d, m], "not_object"); continue; }
                const node = new ModelNode(`${d}:${m}`);
                this.nodes.set(node.name, node);
                for (const [f, raw] of Object.entries(fields)) {
                    if (!rx.test(f)) { this.report([d, m, f], "bad_name"); continue; }
                    const df = new Def([d, m, f], raw, d, null);
                    node.fields.set(f, df);
                    node.list.push(df);
                    this.defs.push(df);
                }
            }
        }
    }

    /** 2. A reference, read once in the domain where it's written. Sets df.ref, or reports and leaves it null. */
    private parse(df: Def): void {
        const raw = df.raw;
        let written: string;
        if (typeof raw === "string") written = raw;
        else if (!isObject(raw)) return this.report(df.path(), "bad_setting");
        else if (Object.hasOwn(raw, "type") && typeof raw.type === "string") written = raw.type;
        else return this.report(df.path(), "missing_setting", { setting: "type" });
        const m = this.cat.ref.exec(written);
        if (m === null) return this.report(df.path(), "unresolved");
        const [, domain, name, field] = m;
        const home = `${domain ?? df.domain}:${name}`;
        if (field !== undefined) {
            const target = this.nodes.get(home)?.fields.get(field);
            if (target === undefined) return this.report(df.path(), "unresolved");
            df.ref = { kind: "field", target };
            return;
        }
        const t = domain === undefined ? typeNamed(name) : undefined;
        const node = this.nodes.get(home);
        const alias = domain === undefined && t === undefined ? scalars.get(name) : undefined;
        if (t !== undefined) df.ref = { kind: "type", type: t };
        else if (node !== undefined) df.ref = { kind: "model", target: node };
        else if (alias !== undefined) this.report(df.path(), "alias", { canonical: alias.name });
        else this.report(df.path(), "unresolved");
    }

    private takesItems(v: Def): boolean {
        const ref = v.ref;
        if (ref === null || !isObject(v.raw) || !Object.hasOwn(v.raw, "items")) return false;
        if (ref.kind === "type") return ref.type.name === "array";
        if (ref.kind !== "field") return false;
        const t = ref.target;
        return t.done && !t.failed && (t.field as ModelField).kind === "array";
    }

    /** The next node `frame`'s node points to, or null once it has no more. */
    private successor(frame: Frame): Def | ModelNode | null {
        const v = frame.node;
        if (v.isModel) return frame.step < v.list.length ? v.list[frame.step++] : null;
        while (frame.step < 2) {
            const step = frame.step++;
            if (step === 0 && v.ref !== null && v.ref.kind !== "type") return v.ref.target;
            if (step === 1 && this.takesItems(v)) {
                const items = new Def(null, (v.raw as Record<string, unknown>).items, v.domain, v);
                v.items = items;
                this.parse(items);
                return items;
            }
        }
        return null;
    }

    /**
     * 3. Resolution and cycles in one pass: Tarjan's strongly connected components over written fields and models,
     * with an explicit stack. Edges: a model reference -> that model; a model -> its fields; a field reference ->
     * the field it copies; an array field -> its `items`. A field's settings, `items` included, are read only once
     * its type resolves, so `items` is an edge only when the resolved type is an array. Components finish
     * dependencies-first, so each field resolves exactly once, after what it copies.
     */
    private resolveAll(): void {
        let counter = 0;
        const stack: (Def | ModelNode)[] = [];
        const calls: Frame[] = [];
        const enter = (v: Def | ModelNode): void => {
            v.index = v.low = counter++;
            v.onStack = true;
            stack.push(v);
            calls.push({ node: v, step: 0 });
        };
        for (const root of this.defs) {
            if (root.index >= 0) continue;
            enter(root);
            while (calls.length) {
                const frame = calls[calls.length - 1];
                const v = frame.node;
                const w = this.successor(frame);
                if (w !== null) {
                    if (w.index < 0) enter(w);
                    else if (w.onStack) {
                        v.low = Math.min(v.low, w.index);
                        if (w === v) v.selfLoop = true;
                    }
                    continue;
                }
                calls.pop();
                if (calls.length) {
                    const up = calls[calls.length - 1].node;
                    up.low = Math.min(up.low, v.low);
                }
                if (v.low !== v.index) continue;
                const component: (Def | ModelNode)[] = [];
                let u: Def | ModelNode;
                do {
                    u = stack.pop() as Def | ModelNode;
                    u.onStack = false;
                    u.done = true;
                    component.push(u);
                } while (u !== v);
                if (component.length > 1 || v.selfLoop) {
                    // A cycle: every field on it fails; the problem is reported at each reference on it.
                    for (const n of component) {
                        if (n.isModel) continue;
                        n.failed = true;
                        if ((n.ref as Ref).kind !== "type") this.report(n.path(), "cycle");
                    }
                } else if (!v.isModel) this.resolve(v);
            }
        }
    }

    /** Builds v.field from its resolved type plus the settings written next to it, or marks v failed. */
    private resolve(v: Def): void {
        const ref = v.ref;
        if (ref === null || (ref.kind === "field" && ref.target.failed)) {
            v.failed = true;
            return;
        }
        const base: ModelField = ref.kind === "field" ? (ref.target.field as ModelField)
            : ref.kind === "model" ? new ModelField("model", false, null, null, null, ref.target.name, null)
            : ref.type.name === "array" ? new ModelField("array", false, null, null, null, "", null)
            : new ModelField("type", false, ref.type, {}, null, "", null);
        const type = base.kind === "type" ? base.type : null;
        const allowed: readonly string[] = type !== null ? (this.cat.settings.get(type.name) as readonly string[]) : base.kind === "array" ? ["items"] : [];
        const written: Record<string, unknown> = isObject(v.raw) ? v.raw : {};
        const settings: Record<string, unknown> | null = type !== null ? { ...base.settings } : null;
        let nullable = base.nullable;
        let items = base.items;
        let valueSet = base.allowed;
        let failed = false;
        const before = this.problems.length;
        for (const key of Object.keys(written)) {
            if (key === "type") continue;
            if (key === "nullable") {
                if (this.checkSetting(null, v, key)) nullable = written[key] as boolean;
            } else if (!allowed.includes(key)) this.report(v.path(key), "unknown_setting");
            else if (key === "items") {
                const own = v.items as Def;
                if (own.failed) failed = true;
                else items = own.field;
            } else if (this.checkSetting(type, v, key)) {
                let value = written[key];
                if (Array.isArray(value)) {
                    // A list setting (`values`) is copied, so the loaded models never alias the caller's data.
                    value = [...value];
                    if (key === "values") valueSet = new Set(value as unknown[]);
                }
                (settings as Record<string, unknown>)[key] = value;
            }
        }
        // A written setting counts as present even when its value was refused, so it isn't also reported missing.
        const has = (key: string): boolean => Object.hasOwn(written, key) || (settings !== null && Object.hasOwn(base.settings as object, key));
        if (base.kind === "array" && items === null && !has("items")) this.report(v.path(), "missing_setting", { setting: "items" });
        if (type !== null && type.name === "enum" && !has("values")) this.report(v.path(), "missing_setting", { setting: "values" });
        if (allowed.includes("scale") && has("scale") && !has("precision")) this.report(v.path("scale"), "missing_setting", { setting: "precision" });
        if (failed || this.problems.length > before) {
            v.failed = true;
            return;
        }
        v.field = type !== null ? new ModelField("type", nullable, type, settings, valueSet, "", null)
            : base.kind === "array" ? new ModelField("array", nullable, null, null, null, "", items)
            : new ModelField("model", nullable, null, null, null, base.model, null);
        this.fields.push(v.field);
        // The model this field nests, through any `items` (an edge of the nesting graph), and how many `items`
        // levels lie on the way: each counts toward the depth limit like a model.
        const from: Def | null = ref.kind === "model" ? null
            : base.kind === "array" ? (items === base.items ? (ref.kind === "field" ? ref.target : null) : v.items)
            : ref.kind === "field" ? ref.target : null;
        v.leaf = ref.kind === "model" ? ref.target : from !== null ? from.leaf : null;
        v.arrays = from === null ? 0 : from === v.items ? 1 + from.arrays : from.arrays;
    }

    /** Checks the value v's `key` holds against its PARAM_RULES rule; reports and returns false when refused. */
    private checkSetting(type: Scalar<unknown> | null, v: Def, key: string): boolean {
        const rule = PARAM_RULES[key];
        const value = (v.raw as Record<string, unknown>)[key];
        let ok: boolean;
        if (rule.kind === "boolean") ok = typeof value === "boolean";
        else if (rule.kind === "integer") {
            ok = typeof value === "number" && Number.isInteger(value)
                && (rule.minimum === null || value >= rule.minimum) && (rule.maximum === null || value <= rule.maximum);
        } else if (rule.kind === "array") {
            ok = Array.isArray(value) && (rule.minItems === null || value.length >= rule.minItems);
            // Entries must be strings, unique, already clean (the type's validate returns each unchanged), and
            // within maxItemBytes as UTF-8.
            if (ok) {
                const seen = new Set<string>();
                const most = rule.maxItemBytes;
                (value as unknown[]).forEach((entry, i) => {
                    if (typeof entry === "string" && (type as Scalar<unknown>)["run"](entry) === entry && (most === null || utf8Length(entry) <= most)
                        && !seen.has(entry)) seen.add(entry);
                    else {
                        this.report(v.path(key, i), "bad_setting");
                        ok = false;
                    }
                });
                return ok;
            }
        } else throw new Error(`Setting "${key}" has unknown kind "${(rule as ParamRule).kind}"`);
        if (!ok) this.report(v.path(key), "bad_setting");
        return ok;
    }

    /**
     * 4. Nesting depth: the longest chain of levels, where each model and each `items` is one level (acyclic now:
     * fields on cycles failed above). Post-order with an explicit stack. A model of plain fields has depth 1; a
     * field adds its `items` levels plus the depth of the model it nests.
     */
    private depths(): void {
        const depth = new Map<ModelNode, number>();
        const fieldDepth = (d: Def): number => d.arrays + (d.leaf === null ? 0 : (depth.get(d.leaf) as number));
        for (const start of this.nodes.values()) {
            if (depth.has(start)) continue;
            const calls: { readonly model: ModelNode; i: number; d: number }[] = [{ model: start, i: 0, d: 1 }];
            const open = new Set<ModelNode>([start]);
            while (calls.length) {
                const frame = calls[calls.length - 1];
                if (frame.i < frame.model.list.length) {
                    const d = frame.model.list[frame.i];
                    const leaf = d.leaf;
                    if (leaf !== null && !depth.has(leaf)) {
                        // Visit the nested model first, then come back to this field.
                        if (open.has(leaf)) throw new Error(`Model cycle through "${leaf.name}" survived resolution`);
                        open.add(leaf);
                        calls.push({ model: leaf, i: 0, d: 1 });
                        continue;
                    }
                    frame.i++;
                    if (!d.failed) frame.d = Math.max(frame.d, 1 + fieldDepth(d));
                    continue;
                }
                calls.pop();
                open.delete(frame.model);
                depth.set(frame.model, frame.d);
            }
        }
        // Reported once per too-deep chain: at the outermost too-deep model, on each field that makes it too deep.
        const deep = [...this.nodes.values()].filter((m) => (depth.get(m) as number) > MAX_DEPTH);
        const inner = new Set<ModelNode>();
        for (const m of deep) for (const d of m.list) if (d.leaf !== null && (depth.get(d.leaf) as number) > MAX_DEPTH) inner.add(d.leaf);
        for (const m of deep) {
            if (inner.has(m)) continue;
            for (const d of m.list) if (!d.failed && 1 + fieldDepth(d) > MAX_DEPTH) this.report(d.segments as readonly Segment[], "too_deep", { max: MAX_DEPTH });
        }
    }
}

/** A location: a link to its parent, so a deep value costs O(1); the segments are built only for a problem. */
type Loc = { readonly up: Loc | null; readonly seg: Segment };

/** isValid found a problem: nothing more needs checking. */
const STOP = Symbol("stop");

/** One model of a loaded models file: `validate(payload)` and `isValid(payload)`. Only `scalars.models()` builds one. */
export class Model {
    readonly name: string;
    private readonly fields: ReadonlyMap<string, ModelField>;
    /**
     * [name, field, shadows] in declared order, built once, not per payload. `shadows` marks a name Object.prototype
     * also has (`constructor`): its output key is defined, since a plain assignment would hit the inherited one.
     */
    private readonly entries: readonly (readonly [string, ModelField, boolean])[];
    private readonly root: ModelField; // the payload itself, a value of this model

    constructor(key: typeof INTERNAL, name: string, fields: ReadonlyMap<string, ModelField>) {
        internalOnly(key, "Model");
        this.name = name;
        this.fields = fields;
        this.entries = [...fields].map(([f, field]) => [f, field, Object.hasOwn(Object.prototype, f)] as const);
        this.root = new ModelField("model", false, null, null, null, name, null);
        this.root.target = this;
    }

    /**
     * The cleaned payload (declared keys only, normalized values, a missing nullable key as null), or throws
     * ModelError listing every problem, sorted.
     */
    validate(payload: unknown): Record<string, unknown> {
        const problems: Located[] = [];
        const out = walkRoot(this, payload, problems);
        if (problems.length) throw new ModelError(sorted(problems));
        return out as Record<string, unknown>;
    }

    /** True exactly when `validate(payload)` would succeed. Stops at the first problem. */
    isValid(payload: unknown): boolean {
        try {
            walkRoot(this, payload, null);
        } catch (e) {
            if (e === STOP) return false;
            throw e;
        }
        return true;
    }
}

/** Records a problem at `at`; with no list (isValid), stops the walk instead. */
function report(problems: Located[] | null, at: Loc | null, code: string, params: Record<string, unknown> = {}, message?: string): void {
    if (problems === null) throw STOP;
    const segments: Segment[] = [];
    for (let l = at; l !== null; l = l.up) segments.push(l.seg);
    problems.push(locate(segments.reverse(), code, params, message));
}

function walkRoot(model: Model, payload: unknown, problems: Located[] | null): unknown {
    if (!isObject(payload)) {
        report(problems, null, "not_object");
        return null;
    }
    return walk(model["root"], payload, null, undefined, problems);
}

/**
 * The cleaned `v`, which sits at segment `seg` under location `up` (the root: null and undefined). Its own location
 * link is made only when it's needed: for a problem, or as the parent of its entries. Recursion follows the models,
 * at most MAX_DEPTH levels, never the input.
 */
function walk(f: ModelField, v: unknown, up: Loc | null, seg: Segment | undefined, problems: Located[] | null): unknown {
    if (v === null || v === undefined) {
        if (!f.nullable) report(problems, seg === undefined ? up : { up, seg }, "required");
        return null;
    }
    if (f.kind === "type") {
        const t = f.type as Scalar<unknown>;
        const r = t["run"](v);
        // The reason is the code; a type-level too_long reads like the field's, with the type's limit as max.
        if (r instanceof Failure) {
            const params = r.reason === Reason.TooLong ? { type: t.name, max: t["maxLen"] } : { type: t.name };
            report(problems, seg === undefined ? up : { up, seg }, r.reason, params, t.error);
            return null;
        }
        if (f.limited) {
            const length = f.length;
            if (length !== null && longerThan(r as string, length)) report(problems, seg === undefined ? up : { up, seg }, Reason.TooLong, { type: t.name, max: length });
            if (f.allowed !== null && !f.allowed.has(r)) report(problems, seg === undefined ? up : { up, seg }, "not_allowed", { type: t.name, values: [...(f.values as readonly string[])] });
            if (f.precision !== null && !fitsNumeric(r as string, f.precision, f.scale)) {
                report(problems, seg === undefined ? up : { up, seg }, "too_many_digits", { type: t.name, precision: f.precision, scale: f.scale });
            }
        }
        return r;
    }
    // A container's own link is the parent of its entries' links.
    const at = seg === undefined ? up : { up, seg };
    if (f.kind === "model") {
        if (!isObject(v)) {
            report(problems, at, "not_object");
            return null;
        }
        const model = f.target as Model;
        const fields = model["fields"];
        for (const k of Object.keys(v)) if (!fields.has(k)) report(problems, { up: at, seg: k }, "unknown_field");
        // A plain assignment runs [[Set]], which an inherited read-only `constructor` (a frozen Object.prototype)
        // refuses: a name Object.prototype has is defined instead. Field names match NAME, so none is "__proto__".
        const out: Record<string, unknown> = {};
        for (const [name, sub, shadows] of model["entries"]) {
            const value = walk(sub, Object.hasOwn(v, name) ? v[name] : undefined, at, name, problems);
            if (shadows) Object.defineProperty(out, name, { value, writable: true, enumerable: true, configurable: true });
            else out[name] = value;
        }
        return out;
    }
    if (!Array.isArray(v)) {
        report(problems, at, "not_list");
        return null;
    }
    const items = f.items as ModelField;
    const out = new Array<unknown>(v.length);
    for (let i = 0; i < v.length; i++) out[i] = walk(items, v[i], at, i, problems);
    return out;
}

/**
 * Rejects exactly what Postgres numeric(p, s) refuses, in one pass over the cleaned text `t`
 * (`-?[0-9]+(\.[0-9]+)?`): R = round(|value| * 10^s), half away from zero, must have at most p digits.
 */
function fitsNumeric(t: string, p: number, s: number): boolean {
    const start = t[0] === "-" ? 1 : 0;
    const dot = t.indexOf(".", start);
    const intLen = (dot < 0 ? t.length : dot) - start;
    const n = t.length - start - (dot < 0 ? 0 : 1); // digits, the point left out
    const digitAt = (i: number): number => t.charCodeAt(start + i + (dot >= 0 && i >= intLen ? 1 : 0)) - 48;
    const k = intLen + s; // digits of the value R keeps
    if (k < 0) return true; // rounds to 0
    let z = 0; // the first nonzero digit
    while (z < n && digitAt(z) === 0) z++;
    const kept = Math.min(k, n);
    const width = z < kept ? k - z : 0; // digits of R before any carry (padding zeros count)
    const carry = k < n && digitAt(k) >= 5;
    let nines = k <= n; // padding zeros aren't 9s
    for (let i = z; nines && i < kept; i++) if (digitAt(i) !== 9) nines = false;
    return width + (carry && nines ? 1 : 0) <= p;
}

/** A loaded models file: `get("domain:model")` and `all`, every full name, sorted by code point. Only `scalars.models()` builds one. */
export class Models {
    readonly all: readonly string[];
    private readonly byName: ReadonlyMap<string, Model>;
    private static catalogue: Catalogue | undefined = undefined; // built on the first load

    constructor(key: typeof INTERNAL, byName: ReadonlyMap<string, Model>) {
        internalOnly(key, "Models");
        this.byName = byName;
        this.all = [...byName.keys()].sort(compareText);
    }

    /** The model by its full `domain:model` name, exactly; nothing found gives undefined. */
    get(name: string): Model | undefined {
        return typeof name === "string" ? this.byName.get(name) : undefined;
    }
}

/** The catalogue, built on the first load: the name patterns and the settings each type takes. */
function catalogue(): Catalogue {
    let cat = Models["catalogue"];
    if (cat === undefined) {
        const settings = new Map<string, readonly string[]>();
        for (const t of scalars.all) settings.set(t.name, t.params);
        cat = {
            name: new RegExp(NAME_PATTERN),
            ref: new RegExp(REF_PATTERN),
            settings,
        };
        Models["catalogue"] = cat;
    }
    return cat;
}

/** Loads a models file (parsed JSON, never a path). Returns its Models, or throws ModelsError listing every problem, sorted. */
function loadModels(data: unknown): Models {
    if (!isObject(data)) throw new ModelsError(sorted([locate([], "not_object", {})]));
    const loaded = new Loader(data, catalogue());
    if (loaded.problems.length) throw new ModelsError(sorted(loaded.problems));
    const byName = new Map<string, Model>();
    for (const node of loaded.nodes.values()) {
        const fields = new Map<string, ModelField>();
        for (const [f, d] of node.fields) fields.set(f, d.field as ModelField);
        byName.set(node.name, new Model(INTERNAL, node.name, fields));
    }
    // Each model field points at its Model once, here, so validate never looks a model up by name.
    for (const field of loaded.fields) if (field.kind === "model") field.target = byName.get(field.model) as Model;
    return new Models(INTERNAL, byName);
}

/** Why a value failed ($meta.reasons): the first rule the single pass trips, in this order. */
export const Reason = {
    /** Not the type's primitive kind (TS, Python and models only; Go and Rust are typed by their signatures). */
    WrongKind: "wrong_kind",
    /** Text that isn't well-formed Unicode (a lone surrogate). */
    Malformed: "malformed",
    /** More code points than the type's maxLength (or a field's length). */
    TooLong: "too_long",
    /** Fewer code points than the type's minLength. */
    TooShort: "too_short",
    /** Doesn't match the type's pattern. */
    Pattern: "pattern",
    /** Below minimum, above maximum, or a non-finite number. */
    OutOfRange: "out_of_range",
    /** Failed the type's check (a check digit, a 64-bit range). */
    Check: "check",
    /** Not on the type's enum. */
    NotInList: "not_in_list",
} as const;
export type Reason = (typeof Reason)[keyof typeof Reason];

/** One failure per reason, so `run` allocates nothing to say "not valid". */
const FAIL = {
    WrongKind: new Failure(Reason.WrongKind),
    Malformed: new Failure(Reason.Malformed),
    TooLong: new Failure(Reason.TooLong),
    TooShort: new Failure(Reason.TooShort),
    Pattern: new Failure(Reason.Pattern),
    OutOfRange: new Failure(Reason.OutOfRange),
    Check: new Failure(Reason.Check),
    NotInList: new Failure(Reason.NotInList),
} as const;

/** The limits of each setting in $meta.params. */
const PARAM_RULES: Readonly<Record<string, ParamRule>> = {"length":{"kind":"integer","minimum":1,"maximum":10485760,"minItems":null,"maxItemBytes":null},"precision":{"kind":"integer","minimum":1,"maximum":1000,"minItems":null,"maxItemBytes":null},"scale":{"kind":"integer","minimum":-1000,"maximum":1000,"minItems":null,"maxItemBytes":null},"fractional_seconds":{"kind":"integer","minimum":0,"maximum":6,"minItems":null,"maxItemBytes":null},"values":{"kind":"array","minimum":null,"maximum":null,"minItems":1,"maxItemBytes":63},"nullable":{"kind":"boolean","minimum":null,"maximum":null,"minItems":null,"maxItemBytes":null}};

/** The message template of each error code in $meta.errors. */
const ERRORS: Readonly<Record<string, string>> = {"required":"Required.","unknown_field":"Not a field of this model.","not_object":"Must be an object.","not_list":"Must be a list.","too_long":"At most {max} characters.","not_allowed":"Must be one of: {values}.","too_many_digits":"Too many digits for precision {precision}, scale {scale}.","bad_name":"Names are lowercase letters, digits and underscores, starting with a letter.","type_name":"A model can't take a type's name.","unresolved":"No type or model by this name.","alias":"This is an alias; write \"{canonical}\".","unknown_setting":"This type takes no such setting.","bad_setting":"Out of range or the wrong kind of value.","missing_setting":"Needs \"{setting}\".","cycle":"This reference leads back to itself.","too_deep":"Models nest more than {max} levels deep."};

/** Nesting deeper than this, each model and each `items` one level, is refused at load. */
const MAX_DEPTH = 64;
/** A domain, model or field name, and a reference: [domain:]name[.field]. */
const NAME_PATTERN = "^[a-z][a-z0-9_]*$";
const REF_PATTERN = "^(?:([a-z][a-z0-9_]*):)?([a-z][a-z0-9_]*)(?:\\.([a-z][a-z0-9_]*))?$";

export type Name = "any" | "array" | "base64" | "base64url" | "bic" | "binary" | "boolean" | "char" | "cidr" | "color" | "commonmark" | "country" | "country_alpha3" | "cron" | "css_color" | "currency" | "date" | "date_time" | "date_time_local" | "decimal" | "decimal128" | "doi" | "duration" | "email" | "enum" | "float32" | "float64" | "gln" | "gtin" | "hostname" | "html" | "iban" | "int16" | "int32" | "int64" | "int8" | "ipv4" | "ipv4_cidr" | "ipv6" | "ipv6_cidr" | "isbn" | "json_pointer" | "jwt" | "language" | "lei" | "locale" | "mac_address" | "media_type" | "object" | "orcid" | "phone" | "port" | "regex" | "secret" | "semver" | "sha256" | "slug" | "string" | "subdivision" | "text" | "time" | "time_local" | "timezone" | "uint16" | "uint32" | "uint64" | "uint8" | "ulid" | "unix_time" | "uri" | "uri_reference" | "uri_template" | "uuid" | "uuid_v7" | "wikidata_qid";

/** Every type by name, plus `get` (name or alias), `all` and `models`. */
export const scalars = {
    /** Anything — Any value at all. Deliberately unconstrained: passthrough payloads and escape hatches. Reach for it last - every consumer inherits the validation burden. */
    "any": new Scalar<unknown>({
        name: "any",
        label: "Anything",
        hint: "Any value at all",
        error: "Any value is allowed here.",
        details: "Deliberately unconstrained: passthrough payloads and escape hatches. Reach for it last - every consumer inherits the validation burden.",
        level: "core",
        primitive: "any",
        aliases: ["json","jsonb"],
        examples: { valid: [{"anything":[1,"two",true]},null,"text",7], invalid: [] },
        kind: "any",
    }),
    /** List — Several values in order. An ordered JSON list: tags, attachments, embedded collections. Prefer a separate table or repeated field when elements need identity or independent querying. */
    "array": new Scalar<unknown[]>({
        name: "array",
        label: "List",
        hint: "Several values in order",
        error: "Please give a list of values.",
        details: "An ordered JSON list: tags, attachments, embedded collections. Prefer a separate table or repeated field when elements need identity or independent querying.",
        level: "core",
        primitive: "array",
        aliases: ["list"],
        examples: { valid: [[1,2,3],[]], invalid: [{"a":1}] },
        kind: "array",
    }),
    /** Base64 data — Bytes written as letters, + and /. Binary content as standard base64 text: payloads embedded in JSON. Prefer binary for raw transport and base64url when the value travels in URLs or filenames. */
    "base64": new Scalar<string>({
        name: "base64",
        label: "Base64 data",
        hint: "Bytes written as letters, + and /",
        error: "Please use base64 with = padding, like SGVsbG8gd29ybGQ=.",
        details: "Binary content as standard base64 text: payloads embedded in JSON. Prefer binary for raw transport and base64url when the value travels in URLs or filenames.",
        level: "advanced",
        primitive: "binary",
        aliases: ["b64"],
        examples: { valid: ["SGVsbG8gd29ybGQ=","","YQ=="], invalid: ["SGVsbG8gd29ybGQ","SGVsbG8_d29ybGQ="] },
        kind: "text",
        pattern: "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$",
    }),
    /** URL-safe base64 — Bytes written as letters, - and _. URL-safe base64 (no + or /): tokens and digests placed in URLs. Prefer base64 for ordinary embedded payloads. */
    "base64url": new Scalar<string>({
        name: "base64url",
        label: "URL-safe base64",
        hint: "Bytes written as letters, - and _",
        error: "Please use letters, digits, - and _, like SGVsbG8gd29ybGQ.",
        details: "URL-safe base64 (no + or /): tokens and digests placed in URLs. Prefer base64 for ordinary embedded payloads.",
        level: "advanced",
        primitive: "binary",
        aliases: ["b64url"],
        examples: { valid: ["SGVsbG8gd29ybGQ","YQ","-_-_"], invalid: ["SGVsbG8+d29ybGQ","SGVs/bG8"] },
        kind: "text",
        pattern: "^[A-Za-z0-9_-]*={0,2}$",
    }),
    /** Bank code (BIC) — 8 or 11 capital letters and digits. A BIC/SWIFT code identifying a bank for payment routing. Routing, not identity - prefer lei to identify the legal entity itself. */
    "bic": new Scalar<string>({
        name: "bic",
        label: "Bank code (BIC)",
        hint: "8 or 11 capital letters and digits",
        error: "Please use 8 or 11 capital letters and digits, like DEUTDEFF500.",
        details: "A BIC/SWIFT code identifying a bank for payment routing. Routing, not identity - prefer lei to identify the legal entity itself.",
        level: "domain",
        primitive: "string",
        aliases: ["swift","swift_code"],
        examples: { valid: ["DEUTDEFF500","DEUTDEFF"], invalid: ["DEUTDEFF5","deutdeff"] },
        kind: "text",
        steps: ["trim","uppercase"],
        pattern: "^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$",
        minLen: 8,
        maxLen: 11,
    }),
    /** File — Upload a file. Raw bytes: file uploads, blobs, digests. Inside JSON they travel as standard base64 (RFC 4648); storage keeps the decoded bytes. */
    "binary": new Scalar<string>({
        name: "binary",
        label: "File",
        hint: "Upload a file",
        error: "Please choose a file.",
        details: "Raw bytes: file uploads, blobs, digests. Inside JSON they travel as standard base64 (RFC 4648); storage keeps the decoded bytes.",
        level: "core",
        primitive: "binary",
        aliases: ["bytes","file","blob"],
        examples: { valid: ["SGVsbG8gd29ybGQ=",""], invalid: [] },
        kind: "text",
    }),
    /** Yes or no — Pick yes or no. A true/false fact: flags, toggles, switches. Prefer enum if a third state could ever appear, rather than a nullable boolean. */
    "boolean": new Scalar<boolean>({
        name: "boolean",
        label: "Yes or no",
        hint: "Pick yes or no",
        error: "Please pick yes or no.",
        details: "A true/false fact: flags, toggles, switches. Prefer enum if a third state could ever appear, rather than a nullable boolean.",
        level: "core",
        primitive: "boolean",
        aliases: ["bool","yes_no"],
        examples: { valid: [true,false], invalid: ["true",1] },
        kind: "boolean",
    }),
    /** Single character — Exactly one character. Exactly one character: a grade, flag, or single-letter code. Prefer string for anything that can grow, and enum when the values form a closed set. */
    "char": new Scalar<string>({
        name: "char",
        label: "Single character",
        hint: "Exactly one character",
        error: "Please type exactly one character, like A.",
        details: "Exactly one character: a grade, flag, or single-letter code. Prefer string for anything that can grow, and enum when the values form a closed set.",
        level: "advanced",
        primitive: "string",
        aliases: ["character","letter"],
        examples: { valid: ["A","é"], invalid: ["","AB"] },
        kind: "text",
        minLen: 1,
        maxLen: 1,
    }),
    /** Network range — An address and a size, like 192.0.2.0/24. A network prefix of either IP family: allowlists, routing rules. Prefer ipv4 or ipv6 for a single host. */
    "cidr": new Scalar<string>({
        name: "cidr",
        label: "Network range",
        hint: "An address and a size, like 192.0.2.0/24",
        error: "Please use an address, a slash and a size, like 192.0.2.0/24.",
        details: "A network prefix of either IP family: allowlists, routing rules. Prefer ipv4 or ipv6 for a single host.",
        level: "core",
        primitive: "string",
        aliases: ["subnet","network"],
        examples: { valid: ["192.0.2.0/24","2001:db8::/32","10.0.0.0/8"], invalid: [] },
        kind: "text",
    }),
    /** Color — Pick a color. An sRGB color as lowercase #rrggbb or #rrggbbaa - the exact form <input type="color"> produces, so it round-trips through forms, JSON, JS/TS and SQL unchanged. Prefer css_color only for wide-gamut or design-token values. */
    "color": new Scalar<string>({
        name: "color",
        label: "Color",
        hint: "Pick a color",
        error: "Please use # and 6 small hex digits, like #1a2b3c.",
        details: "An sRGB color as lowercase #rrggbb or #rrggbbaa - the exact form <input type=\"color\"> produces, so it round-trips through forms, JSON, JS/TS and SQL unchanged. Prefer css_color only for wide-gamut or design-token values.",
        level: "core",
        primitive: "string",
        aliases: ["colour","rgb","hex_color"],
        examples: { valid: ["#1a2b3c","#1a2b3c80","#000000"], invalid: ["#ABC","#1A2B3C","red"] },
        kind: "text",
        steps: ["trim","lowercase"],
        pattern: "^#[0-9a-f]{6}([0-9a-f]{2})?$",
        minLen: 7,
        maxLen: 9,
    }),
    /** Markdown — Text with # headings and **bold**. Markdown (CommonMark) source: user-authored rich content stored as written. Prefer html for already-rendered markup and text for plain prose. */
    "commonmark": new Scalar<string>({
        name: "commonmark",
        label: "Markdown",
        hint: "Text with # headings and **bold**",
        error: "Please type some Markdown text.",
        details: "Markdown (CommonMark) source: user-authored rich content stored as written. Prefer html for already-rendered markup and text for plain prose.",
        level: "advanced",
        primitive: "text",
        aliases: ["markdown","md"],
        examples: { valid: ["# Title\n\nSome **bold** text.","- one\n- two"], invalid: [] },
        kind: "text",
    }),
    /** Country — Pick a country. An ISO 3166-1 alpha-2 country code (US): the interchange default for countries. The list: ISO 3166-1 alpha-2 codes currently assigned, from Debian iso-codes v4.20.1 (data/iso_3166-1.json), copied 2026-11-21. */
    "country": new Scalar<string>({
        name: "country",
        label: "Country",
        hint: "Pick a country",
        error: "Please use the 2-letter country code, like US.",
        details: "An ISO 3166-1 alpha-2 country code (US): the interchange default for countries. The list: ISO 3166-1 alpha-2 codes currently assigned, from Debian iso-codes v4.20.1 (data/iso_3166-1.json), copied 2026-11-21.",
        level: "core",
        primitive: "string",
        aliases: ["country_code"],
        examples: { valid: ["US","DE"], invalid: ["us","USA"] },
        kind: "text",
        steps: ["trim","uppercase"],
        pattern: "^[A-Z]{2}$",
        list: ["AD","AE","AF","AG","AI","AL","AM","AO","AQ","AR","AS","AT","AU","AW","AX","AZ","BA","BB","BD","BE","BF","BG","BH","BI","BJ","BL","BM","BN","BO","BQ","BR","BS","BT","BV","BW","BY","BZ","CA","CC","CD","CF","CG","CH","CI","CK","CL","CM","CN","CO","CR","CU","CV","CW","CX","CY","CZ","DE","DJ","DK","DM","DO","DZ","EC","EE","EG","EH","ER","ES","ET","FI","FJ","FK","FM","FO","FR","GA","GB","GD","GE","GF","GG","GH","GI","GL","GM","GN","GP","GQ","GR","GS","GT","GU","GW","GY","HK","HM","HN","HR","HT","HU","ID","IE","IL","IM","IN","IO","IQ","IR","IS","IT","JE","JM","JO","JP","KE","KG","KH","KI","KM","KN","KP","KR","KW","KY","KZ","LA","LB","LC","LI","LK","LR","LS","LT","LU","LV","LY","MA","MC","MD","ME","MF","MG","MH","MK","ML","MM","MN","MO","MP","MQ","MR","MS","MT","MU","MV","MW","MX","MY","MZ","NA","NC","NE","NF","NG","NI","NL","NO","NP","NR","NU","NZ","OM","PA","PE","PF","PG","PH","PK","PL","PM","PN","PR","PS","PT","PW","PY","QA","RE","RO","RS","RU","RW","SA","SB","SC","SD","SE","SG","SH","SI","SJ","SK","SL","SM","SN","SO","SR","SS","ST","SV","SX","SY","SZ","TC","TD","TF","TG","TH","TJ","TK","TL","TM","TN","TO","TR","TT","TV","TW","TZ","UA","UG","UM","US","UY","UZ","VA","VC","VE","VG","VI","VN","VU","WF","WS","YE","YT","ZA","ZM","ZW"],
        minLen: 2,
        maxLen: 2,
    }),
    /** Country (3-letter) — Three capital letters, like USA. An ISO 3166-1 alpha-3 country code (USA): feeds and standards that require three letters. Prefer country (alpha-2) as the default. The list: ISO 3166-1 alpha-3 codes currently assigned, from Debian iso-codes v4.20.1 (data/iso_3166-1.json), copied 2026-11-21. */
    "country_alpha3": new Scalar<string>({
        name: "country_alpha3",
        label: "Country (3-letter)",
        hint: "Three capital letters, like USA",
        error: "Please use the 3-letter country code, like USA.",
        details: "An ISO 3166-1 alpha-3 country code (USA): feeds and standards that require three letters. Prefer country (alpha-2) as the default. The list: ISO 3166-1 alpha-3 codes currently assigned, from Debian iso-codes v4.20.1 (data/iso_3166-1.json), copied 2026-11-21.",
        level: "advanced",
        primitive: "string",
        aliases: ["country_code3"],
        examples: { valid: ["USA","DEU"], invalid: ["usa","US"] },
        kind: "text",
        steps: ["trim","uppercase"],
        pattern: "^[A-Z]{3}$",
        list: ["ABW","AFG","AGO","AIA","ALA","ALB","AND","ARE","ARG","ARM","ASM","ATA","ATF","ATG","AUS","AUT","AZE","BDI","BEL","BEN","BES","BFA","BGD","BGR","BHR","BHS","BIH","BLM","BLR","BLZ","BMU","BOL","BRA","BRB","BRN","BTN","BVT","BWA","CAF","CAN","CCK","CHE","CHL","CHN","CIV","CMR","COD","COG","COK","COL","COM","CPV","CRI","CUB","CUW","CXR","CYM","CYP","CZE","DEU","DJI","DMA","DNK","DOM","DZA","ECU","EGY","ERI","ESH","ESP","EST","ETH","FIN","FJI","FLK","FRA","FRO","FSM","GAB","GBR","GEO","GGY","GHA","GIB","GIN","GLP","GMB","GNB","GNQ","GRC","GRD","GRL","GTM","GUF","GUM","GUY","HKG","HMD","HND","HRV","HTI","HUN","IDN","IMN","IND","IOT","IRL","IRN","IRQ","ISL","ISR","ITA","JAM","JEY","JOR","JPN","KAZ","KEN","KGZ","KHM","KIR","KNA","KOR","KWT","LAO","LBN","LBR","LBY","LCA","LIE","LKA","LSO","LTU","LUX","LVA","MAC","MAF","MAR","MCO","MDA","MDG","MDV","MEX","MHL","MKD","MLI","MLT","MMR","MNE","MNG","MNP","MOZ","MRT","MSR","MTQ","MUS","MWI","MYS","MYT","NAM","NCL","NER","NFK","NGA","NIC","NIU","NLD","NOR","NPL","NRU","NZL","OMN","PAK","PAN","PCN","PER","PHL","PLW","PNG","POL","PRI","PRK","PRT","PRY","PSE","PYF","QAT","REU","ROU","RUS","RWA","SAU","SDN","SEN","SGP","SGS","SHN","SJM","SLB","SLE","SLV","SMR","SOM","SPM","SRB","SSD","STP","SUR","SVK","SVN","SWE","SWZ","SXM","SYC","SYR","TCA","TCD","TGO","THA","TJK","TKL","TKM","TLS","TON","TTO","TUN","TUR","TUV","TWN","TZA","UGA","UKR","UMI","URY","USA","UZB","VAT","VCT","VEN","VGB","VIR","VNM","VUT","WLF","WSM","YEM","ZAF","ZMB","ZWE"],
        minLen: 3,
        maxLen: 3,
    }),
    /** Schedule — Five fields, like 0 3 * * *. A POSIX crontab expression (0 3 * * *): recurring schedules. Prefer duration for simple intervals and date_time for one-shot schedules. */
    "cron": new Scalar<string>({
        name: "cron",
        label: "Schedule",
        hint: "Five fields, like 0 3 * * *",
        error: "Please use five fields, like 0 3 * * * (3 AM daily).",
        details: "A POSIX crontab expression (0 3 * * *): recurring schedules. Prefer duration for simple intervals and date_time for one-shot schedules.",
        level: "advanced",
        primitive: "string",
        aliases: ["cron_expression","crontab"],
        examples: { valid: ["0 3 * * *","*/15 9-17 * * 1-5"], invalid: [] },
        kind: "text",
    }),
    /** CSS color — Any CSS color, like oklch(70% 0.15 250). Any single CSS Color 4 value: hex, named, rgb(), hsl(), hwb(), lab(), lch(), oklab(), oklch() or color(display-p3 ...). The pattern only checks the shape; validate for real with CSS.supports('color', value). Level 5 expressions (color-mix(), relative colors, light-dark(), var()) are computed in context and are deliberately not data. */
    "css_color": new Scalar<string>({
        name: "css_color",
        label: "CSS color",
        hint: "Any CSS color, like oklch(70% 0.15 250)",
        error: "That doesn't look like a CSS color. Try oklch(70% 0.15 250).",
        details: "Any single CSS Color 4 value: hex, named, rgb(), hsl(), hwb(), lab(), lch(), oklab(), oklch() or color(display-p3 ...). The pattern only checks the shape; validate for real with CSS.supports('color', value). Level 5 expressions (color-mix(), relative colors, light-dark(), var()) are computed in context and are deliberately not data.",
        level: "advanced",
        primitive: "string",
        aliases: ["css_colour"],
        examples: { valid: ["oklch(70% 0.15 250)","#fff","rebeccapurple","color(display-p3 1 0.5 0)","rgb(10 20 30 / 50%)"], invalid: ["color-mix(in srgb, red, blue)","oklch(from var(--brand) l c h)","#12"] },
        kind: "text",
        pattern: "^(#[0-9a-fA-F]{3,4}|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8}|[a-zA-Z]+|(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\\([^()]*\\))$",
        minLen: 1,
    }),
    /** Currency — Pick a currency, like USD or EUR. An ISO 4217 currency code (USD): pair it with a decimal amount to represent money. Never derive it from country or locale - people transact across borders. The list: ISO 4217 List One active codes (with the X codes it assigns), from SIX list-one.xml published 2026-09-17, copied 2026-11-21. */
    "currency": new Scalar<string>({
        name: "currency",
        label: "Currency",
        hint: "Pick a currency, like USD or EUR",
        error: "Please use the 3-letter currency code, like USD.",
        details: "An ISO 4217 currency code (USD): pair it with a decimal amount to represent money. Never derive it from country or locale - people transact across borders. The list: ISO 4217 List One active codes (with the X codes it assigns), from SIX list-one.xml published 2026-09-17, copied 2026-11-21.",
        level: "core",
        primitive: "string",
        aliases: ["currency_code"],
        examples: { valid: ["USD","EUR"], invalid: ["usd","US"] },
        kind: "text",
        steps: ["trim","uppercase"],
        pattern: "^[A-Z]{3}$",
        list: ["AED","AFN","ALL","AMD","AOA","ARS","AUD","AWG","AZN","BAM","BBD","BDT","BHD","BIF","BMD","BND","BOB","BOV","BRL","BSD","BTN","BWP","BYN","BZD","CAD","CDF","CHE","CHF","CHW","CLF","CLP","CNY","COP","COU","CRC","CUP","CVE","CZK","DJF","DKK","DOP","DZD","EGP","ERN","ETB","EUR","FJD","FKP","GBP","GEL","GHS","GIP","GMD","GNF","GTQ","GYD","HKD","HNL","HTG","HUF","IDR","ILS","INR","IQD","IRR","ISK","JMD","JOD","JPY","KES","KGS","KHR","KMF","KPW","KRW","KWD","KYD","KZT","LAK","LBP","LKR","LRD","LSL","LYD","MAD","MDL","MGA","MKD","MMK","MNT","MOP","MRU","MUR","MVR","MWK","MXN","MXV","MYR","MZN","NAD","NGN","NIO","NOK","NPR","NZD","OMR","PAB","PEN","PGK","PHP","PKR","PLN","PYG","QAR","RON","RSD","RUB","RWF","SAR","SBD","SCR","SDG","SEK","SGD","SHP","SLE","SOS","SRD","SSP","STN","SVC","SYP","SZL","THB","TJS","TMT","TND","TOP","TRY","TTD","TWD","TZS","UAH","UGX","USD","USN","UYI","UYU","UYW","UZS","VED","VES","VND","VUV","WST","XAD","XAF","XAG","XAU","XBA","XBB","XBC","XBD","XCD","XCG","XDR","XOF","XPD","XPF","XPT","XSU","XTS","XUA","XXX","YER","ZAR","ZMW","ZWG"],
        minLen: 3,
        maxLen: 3,
    }),
    /** Date — Year-month-day, like 2026-08-16. A calendar date with no time or zone: birthdays, due dates, effective dates. Prefer date_time for an actual instant. */
    "date": new Scalar<string>({
        name: "date",
        label: "Date",
        hint: "Year-month-day, like 2026-08-16",
        error: "Please use year-month-day, like 2026-08-16.",
        details: "A calendar date with no time or zone: birthdays, due dates, effective dates. Prefer date_time for an actual instant.",
        level: "core",
        primitive: "date",
        aliases: ["day"],
        examples: { valid: ["2026-08-16","2024-02-29"], invalid: ["2026-8-16","16/08/2026"] },
        kind: "text",
        pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$",
        minLen: 10,
        maxLen: 10,
    }),
    /** Date and time — An exact moment, with its time zone. An absolute instant with offset - the default for created/updated timestamps and anything that really happened. Prefer date_time_local only for deliberately floating times. */
    "date_time": new Scalar<string>({
        name: "date_time",
        label: "Date and time",
        hint: "An exact moment, with its time zone",
        error: "Please use date, T, time and zone, like 2026-08-16T14:30:00Z.",
        details: "An absolute instant with offset - the default for created/updated timestamps and anything that really happened. Prefer date_time_local only for deliberately floating times.",
        level: "core",
        primitive: "date_time",
        aliases: ["datetime","timestamp","instant"],
        examples: { valid: ["2026-08-16T14:30:00Z","2026-08-16T14:30:00.123+02:00"], invalid: ["2026-08-16T14:30:00","2026-08-16 14:30:00Z"] },
        kind: "text",
        params: ["fractional_seconds"],
        pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}[Tt][0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?([Zz]|[+-][0-9]{2}:[0-9]{2})$",
        minLen: 20,
    }),
    /** Local date and time — A date and time on the clock, no zone. A date and time with no offset: floating events like 'Jan 1 at midnight, wherever the user is'. Prefer date_time for real instants; pair with timezone to reconstruct one. */
    "date_time_local": new Scalar<string>({
        name: "date_time_local",
        label: "Local date and time",
        hint: "A date and time on the clock, no zone",
        error: "Please use date, T and time, like 2026-08-16T14:30:00.",
        details: "A date and time with no offset: floating events like 'Jan 1 at midnight, wherever the user is'. Prefer date_time for real instants; pair with timezone to reconstruct one.",
        level: "core",
        primitive: "date_time_local",
        aliases: ["local_datetime","wall_time"],
        examples: { valid: ["2026-08-16T14:30:00","2026-08-16T09:00:00.5"], invalid: ["2026-08-16T14:30:00Z","2026-08-16"] },
        kind: "text",
        params: ["fractional_seconds"],
        pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}[Tt][0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?$",
        minLen: 19,
    }),
    /** Exact number — Exact amounts like money: 1234.56. Exact decimal value represented as text. Use for money, rates, quantities, and other values where decimal precision must be preserved. Precision and scale are determined by the target system. */
    "decimal": new Scalar<string>({
        name: "decimal",
        label: "Exact number",
        hint: "Exact amounts like money: 1234.56",
        error: "Please use digits and one dot, like 1234.56.",
        details: "Exact decimal value represented as text. Use for money, rates, quantities, and other values where decimal precision must be preserved. Precision and scale are determined by the target system.",
        level: "core",
        primitive: "decimal",
        aliases: ["money","numeric"],
        examples: { valid: ["1234.56","-0.01","42"], invalid: ["1,234.56","1e5"] },
        kind: "text",
        params: ["precision","scale"],
        pattern: "^-?[0-9]+(\\.[0-9]+)?$",
        minLen: 1,
    }),
    /** Very exact number — Up to 34 significant digits. IEEE 754 decimal128: exact decimals with a defined 34-significant-digit width, for interchange with fixed-width financial systems. Prefer decimal when arbitrary precision is acceptable. */
    "decimal128": new Scalar<string>({
        name: "decimal128",
        label: "Very exact number",
        hint: "Up to 34 significant digits",
        error: "Please use digits and one dot, like 1234.567890123456789012345678901234.",
        details: "IEEE 754 decimal128: exact decimals with a defined 34-significant-digit width, for interchange with fixed-width financial systems. Prefer decimal when arbitrary precision is acceptable.",
        level: "advanced",
        primitive: "decimal",
        aliases: ["dec128"],
        examples: { valid: ["1234.567890123456789012345678901234","-1"], invalid: ["1e10","abc"] },
        kind: "text",
        params: ["precision","scale"],
        pattern: "^-?[0-9]+(\\.[0-9]+)?$",
        minLen: 1,
    }),
    /** DOI — A paper ID, like 10.1000/182. A Digital Object Identifier: citations to papers, datasets, publications. Prefer uri only for links that are not registered DOIs. */
    "doi": new Scalar<string>({
        name: "doi",
        label: "DOI",
        hint: "A paper ID, like 10.1000/182",
        error: "Please start with 10., like 10.1000/182.",
        details: "A Digital Object Identifier: citations to papers, datasets, publications. Prefer uri only for links that are not registered DOIs.",
        level: "domain",
        primitive: "string",
        aliases: ["doi_name"],
        examples: { valid: ["10.1000/182","10.1038/nphys1170"], invalid: ["10.1/182","doi:10.1000/182"] },
        kind: "text",
        pattern: "^10\\.[0-9]{4,9}/[-._;()/:A-Za-z0-9]+$",
        minLen: 9,
    }),
    /** Length of time — How long something lasts, like P3DT4H30M. A span of time (ISO 8601): timeouts, retention windows, billing periods. A length, not a position - prefer date_time for points in time. */
    "duration": new Scalar<string>({
        name: "duration",
        label: "Length of time",
        hint: "How long something lasts, like P3DT4H30M",
        error: "Please write it like P3DT4H30M (3 days, 4 hours, 30 minutes).",
        details: "A span of time (ISO 8601): timeouts, retention windows, billing periods. A length, not a position - prefer date_time for points in time.",
        level: "core",
        primitive: "duration",
        aliases: ["interval","timespan"],
        examples: { valid: ["P3DT4H30M","PT0.5S","P1Y2M"], invalid: ["P","3 days"] },
        kind: "text",
        params: ["fractional_seconds"],
        pattern: "^P(([0-9]+Y([0-9]+M)?([0-9]+W)?([0-9]+D)?|[0-9]+M([0-9]+W)?([0-9]+D)?|[0-9]+W([0-9]+D)?|[0-9]+D)(T([0-9]+H([0-9]+M)?([0-9]+(\\.[0-9]+)?S)?|[0-9]+M([0-9]+(\\.[0-9]+)?S)?|[0-9]+(\\.[0-9]+)?S))?|T([0-9]+H([0-9]+M)?([0-9]+(\\.[0-9]+)?S)?|[0-9]+M([0-9]+(\\.[0-9]+)?S)?|[0-9]+(\\.[0-9]+)?S))$",
        minLen: 3,
    }),
    /** Email address — Like name@example.com. An email address, ASCII or international (RFC 6531, like 用户@例子.广告): login and contact fields. Whether a mail server delivers to a non-ASCII address is its own matter. */
    "email": new Scalar<string>({
        name: "email",
        label: "Email address",
        hint: "Like name@example.com",
        error: "That email looks wrong. Try user@example.com.",
        details: "An email address, ASCII or international (RFC 6531, like 用户@例子.广告): login and contact fields. Whether a mail server delivers to a non-ASCII address is its own matter.",
        level: "core",
        primitive: "string",
        aliases: ["email_address","mail"],
        examples: { valid: ["user@example.com","first.last+tag@sub.example.co.uk","用户@例子.广告"], invalid: ["user@","user example.com"] },
        kind: "text",
        steps: ["trim"],
        pattern: "^[^@\\x09-\\x0D\\x20]+@[^@\\x09-\\x0D\\x20][^.@\\x09-\\x0D\\x20]*\\.[^@\\x09-\\x0D\\x20]+$",
        minLen: 5,
    }),
    /** Choice — Pick one option from a fixed list. One value from a closed, named set: statuses, roles, kinds. Prefer string for open-ended sets and boolean for exactly two states. */
    "enum": new Scalar<string>({
        name: "enum",
        label: "Choice",
        hint: "Pick one option from a fixed list",
        error: "Please pick one of the options.",
        details: "One value from a closed, named set: statuses, roles, kinds. Prefer string for open-ended sets and boolean for exactly two states.",
        level: "core",
        primitive: "string",
        aliases: ["choice","select"],
        examples: { valid: ["active","draft","archived"], invalid: [] },
        kind: "text",
        params: ["values"],
    }),
    /** Small-precision number — Any number, stored with ~7 digits. Single-precision floats: bulk sensor readings or ML weights where memory beats precision. Prefer float64 as the default floating-point type. */
    "float32": new Scalar<number>({
        name: "float32",
        label: "Small-precision number",
        hint: "Any number, stored with ~7 digits",
        error: "Please type a number, like 3.14.",
        details: "Single-precision floats: bulk sensor readings or ML weights where memory beats precision. Prefer float64 as the default floating-point type.",
        level: "advanced",
        primitive: "float64",
        aliases: ["real","single"],
        examples: { valid: [3.14,-1.5], invalid: ["3.14"] },
        kind: "number",
    }),
    /** Number — Any number, like 3.14. The default floating-point number: measurements, ratios, scores. Never money or exact quantities - use decimal for anything where digits must be exact. */
    "float64": new Scalar<number>({
        name: "float64",
        label: "Number",
        hint: "Any number, like 3.14",
        error: "Please type a number, like 3.14.",
        details: "The default floating-point number: measurements, ratios, scores. Never money or exact quantities - use decimal for anything where digits must be exact.",
        level: "core",
        primitive: "float64",
        aliases: ["number","float","double"],
        examples: { valid: [3.141592653589793,-0.5,1e+21], invalid: ["3.14"] },
        kind: "number",
    }),
    /** Location number (GLN) — 13 digits. A GS1 GLN identifying a party or place: a company, a warehouse, a store, a dock door. Use gtin for the products themselves and lei for legal entities in finance. */
    "gln": new Scalar<string>({
        name: "gln",
        label: "Location number (GLN)",
        hint: "13 digits",
        error: "Please check the number: 13 digits, like 0614141000012.",
        details: "A GS1 GLN identifying a party or place: a company, a warehouse, a store, a dock door. Use gtin for the products themselves and lei for legal entities in finance.",
        level: "domain",
        primitive: "string",
        aliases: ["location_number","global_location_number"],
        examples: { valid: ["0614141000012","4000001000005"], invalid: ["061414100001","06141410000123"] },
        kind: "text",
        steps: ["remove_spaces","remove_hyphens"],
        pattern: "^[0-9]{13}$",
        check: "gs1_mod10",
        minLen: 13,
        maxLen: 13,
    }),
    /** Barcode number — 8, 12, 13 or 14 digits. A GS1 GTIN (UPC/EAN family) identifying a retail product. Prefer isbn when the domain is specifically books. */
    "gtin": new Scalar<string>({
        name: "gtin",
        label: "Barcode number",
        hint: "8, 12, 13 or 14 digits",
        error: "Please check the number: 8, 12, 13 or 14 digits, like 0614141000036.",
        details: "A GS1 GTIN (UPC/EAN family) identifying a retail product. Prefer isbn when the domain is specifically books.",
        level: "domain",
        primitive: "string",
        aliases: ["barcode","ean","upc"],
        examples: { valid: ["0614141000036","96385074"], invalid: ["123456789","0614141000036A"] },
        kind: "text",
        steps: ["remove_spaces","remove_hyphens"],
        pattern: "^([0-9]{8}|[0-9]{12}|[0-9]{13}|[0-9]{14})$",
        check: "gs1_mod10",
        minLen: 8,
        maxLen: 14,
    }),
    /** Website name — Like api.example.com. A DNS hostname: servers and endpoints without scheme or path. International names are stored in their ASCII (punycode) form, like xn--bcher-kva.example. Prefer uri when a full locator travels. */
    "hostname": new Scalar<string>({
        name: "hostname",
        label: "Website name",
        hint: "Like api.example.com",
        error: "Please use letters, digits, dots and dashes, like api.example.com.",
        details: "A DNS hostname: servers and endpoints without scheme or path. International names are stored in their ASCII (punycode) form, like xn--bcher-kva.example. Prefer uri when a full locator travels.",
        level: "core",
        primitive: "string",
        aliases: ["domain","domain_name","host"],
        examples: { valid: ["api.example.com","localhost","a-b.example"], invalid: ["-api.example.com","api..example.com","aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"] },
        kind: "text",
        steps: ["trim","lowercase"],
        pattern: "^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$",
        minLen: 1,
        maxLen: 253,
    }),
    /** HTML — Web page markup, like <p>Hello</p>. HTML markup stored as-is: rendered output, email bodies. Sanitize on the way in; prefer commonmark when users author the content. */
    "html": new Scalar<string>({
        name: "html",
        label: "HTML",
        hint: "Web page markup, like <p>Hello</p>",
        error: "Please type some HTML.",
        details: "HTML markup stored as-is: rendered output, email bodies. Sanitize on the way in; prefer commonmark when users author the content.",
        level: "advanced",
        primitive: "text",
        aliases: ["markup"],
        examples: { valid: ["<p>Hello</p>","<ul><li>one</li></ul>"], invalid: [] },
        kind: "text",
    }),
    /** Bank account (IBAN) — Country code, 2 digits, then account. An International Bank Account Number: identifying accounts for payments. Pair with bic for cross-border routing and treat as sensitive data. */
    "iban": new Scalar<string>({
        name: "iban",
        label: "Bank account (IBAN)",
        hint: "Country code, 2 digits, then account",
        error: "Please check the account: capitals and digits, no spaces, like DE89370400440532013000.",
        details: "An International Bank Account Number: identifying accounts for payments. Pair with bic for cross-border routing and treat as sensitive data.",
        level: "domain",
        primitive: "string",
        aliases: ["bank_account"],
        examples: { valid: ["DE89370400440532013000","GB82WEST12345698765432"], invalid: ["de89370400440532013000","DE89 3704 0044 0532 0130 00"] },
        kind: "text",
        steps: ["trim","remove_spaces","uppercase"],
        pattern: "^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$",
        check: "iban",
        minLen: 15,
        maxLen: 34,
    }),
    /** Small whole number — From -32768 to 32767. Signed 16-bit integers: compact numeric codes and small bounded quantities. Prefer int32 as the general-purpose default. */
    "int16": new Scalar<number>({
        name: "int16",
        label: "Small whole number",
        hint: "From -32768 to 32767",
        error: "Please use a whole number from -32768 to 32767.",
        details: "Signed 16-bit integers: compact numeric codes and small bounded quantities. Prefer int32 as the general-purpose default.",
        level: "advanced",
        primitive: "int32",
        aliases: ["smallint","short"],
        examples: { valid: [1024,-32768], invalid: [32768,-32769] },
        kind: "integer",
        minimum: -32768,
        maximum: 32767,
    }),
    /** Whole number — A number with no decimal point, like 42. The general-purpose signed integer: counts, quantities, offsets. Prefer int64 for identifiers or anything that can outgrow two billion. */
    "int32": new Scalar<number>({
        name: "int32",
        label: "Whole number",
        hint: "A number with no decimal point, like 42",
        error: "Please use a whole number, like 42.",
        details: "The general-purpose signed integer: counts, quantities, offsets. Prefer int64 for identifiers or anything that can outgrow two billion.",
        level: "core",
        primitive: "int32",
        aliases: ["int","integer"],
        examples: { valid: [42,-2147483648,0], invalid: [2147483648,1.5] },
        kind: "integer",
        minimum: -2147483648,
        maximum: 2147483647,
    }),
    /** Big whole number — A very big number with no decimal point. Signed 64-bit integers: database keys, byte sizes, high-resolution counters. Values beyond 2^53 lose precision as JSON numbers, so they travel as strings; storage is still a native 64-bit integer. */
    "int64": new Scalar<string>({
        name: "int64",
        label: "Big whole number",
        hint: "A very big number with no decimal point",
        error: "Please use a whole number that fits in 64 bits, digits only, like 9007199254740993.",
        details: "Signed 64-bit integers: database keys, byte sizes, high-resolution counters. Values beyond 2^53 lose precision as JSON numbers, so they travel as strings; storage is still a native 64-bit integer.",
        level: "core",
        primitive: "int64",
        aliases: ["bigint","long"],
        examples: { valid: ["9007199254740993","-42","0","9223372036854775807","-9223372036854775808"], invalid: ["12.5",123] },
        kind: "text",
        pattern: "^-?[0-9]+$",
        check: "int64_range",
        minLen: 1,
    }),
    /** Tiny whole number — From -128 to 127. Tiny signed integers (-128..127) where the bound is part of the contract. Prefer int32 as the general-purpose default. */
    "int8": new Scalar<number>({
        name: "int8",
        label: "Tiny whole number",
        hint: "From -128 to 127",
        error: "Please use a whole number from -128 to 127.",
        details: "Tiny signed integers (-128..127) where the bound is part of the contract. Prefer int32 as the general-purpose default.",
        level: "advanced",
        primitive: "int32",
        aliases: ["tinyint","byte"],
        examples: { valid: [-7,-128,127], invalid: [128,-129] },
        kind: "integer",
        minimum: -128,
        maximum: 127,
    }),
    /** IP address (v4) — Four numbers with dots, like 192.0.2.1. A dotted-quad IPv4 host address. Prefer cidr for networks rather than hosts. */
    "ipv4": new Scalar<string>({
        name: "ipv4",
        label: "IP address (v4)",
        hint: "Four numbers with dots, like 192.0.2.1",
        error: "Please use four numbers from 0 to 255, like 192.0.2.1.",
        details: "A dotted-quad IPv4 host address. Prefer cidr for networks rather than hosts.",
        level: "core",
        primitive: "string",
        aliases: ["ip","ip_address"],
        examples: { valid: ["192.0.2.1","0.0.0.0","255.255.255.255"], invalid: ["256.0.0.1","192.0.2"] },
        kind: "text",
        pattern: "^((25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])\\.){3}(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])$",
        minLen: 7,
        maxLen: 15,
    }),
    /** IPv4 network range — Like 192.0.2.0/24. An IPv4 network prefix like 192.0.2.0/24. Prefer cidr when either family may appear, and ipv4 for a single host. */
    "ipv4_cidr": new Scalar<string>({
        name: "ipv4_cidr",
        label: "IPv4 network range",
        hint: "Like 192.0.2.0/24",
        error: "Please use an IPv4 address, a slash and 0-32, like 192.0.2.0/24.",
        details: "An IPv4 network prefix like 192.0.2.0/24. Prefer cidr when either family may appear, and ipv4 for a single host.",
        level: "advanced",
        primitive: "string",
        aliases: ["ipv4_subnet"],
        examples: { valid: ["192.0.2.0/24","0.0.0.0/0"], invalid: ["192.0.2.0/33","192.0.2.0"] },
        kind: "text",
        pattern: "^((25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])\\.){3}(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])/(3[0-2]|[12]?[0-9])$",
        minLen: 9,
        maxLen: 18,
    }),
    /** IP address (v6) — Like 2001:db8::1. An IPv6 host address. Prefer cidr for prefixes rather than hosts. */
    "ipv6": new Scalar<string>({
        name: "ipv6",
        label: "IP address (v6)",
        hint: "Like 2001:db8::1",
        error: "That IP address looks wrong. Try 2001:db8::1.",
        details: "An IPv6 host address. Prefer cidr for prefixes rather than hosts.",
        level: "core",
        primitive: "string",
        aliases: ["ipv6_address"],
        examples: { valid: ["2001:db8::1","::1","fe80::1ff:fe23:4567:890a"], invalid: [] },
        kind: "text",
    }),
    /** IPv6 network range — Like 2001:db8::/32. An IPv6 network prefix like 2001:db8::/32. Prefer cidr when either family may appear, and ipv6 for a single host. */
    "ipv6_cidr": new Scalar<string>({
        name: "ipv6_cidr",
        label: "IPv6 network range",
        hint: "Like 2001:db8::/32",
        error: "Please use an IPv6 address, a slash and 0-128, like 2001:db8::/32.",
        details: "An IPv6 network prefix like 2001:db8::/32. Prefer cidr when either family may appear, and ipv6 for a single host.",
        level: "advanced",
        primitive: "string",
        aliases: ["ipv6_subnet"],
        examples: { valid: ["2001:db8::/32","::/0"], invalid: [] },
        kind: "text",
    }),
    /** Book number (ISBN) — 10 or 13 digits. An ISBN identifying a book edition. Prefer gtin for general retail products; every ISBN-13 is a GTIN, but not the reverse. */
    "isbn": new Scalar<string>({
        name: "isbn",
        label: "Book number (ISBN)",
        hint: "10 or 13 digits",
        error: "Please check the number: 10 or 13 digits, no dashes, like 9780306406157.",
        details: "An ISBN identifying a book edition. Prefer gtin for general retail products; every ISBN-13 is a GTIN, but not the reverse.",
        level: "domain",
        primitive: "string",
        aliases: ["isbn13","isbn10"],
        examples: { valid: ["9780306406157","080442957X","0306406152"], invalid: ["978030640615","0306406152XX"] },
        kind: "text",
        steps: ["remove_spaces","remove_hyphens","uppercase"],
        pattern: "^([0-9]{9}[0-9Xx]|97[89][0-9]{10})$",
        check: "isbn",
        minLen: 10,
        maxLen: 13,
    }),
    /** JSON Pointer — A path inside a document, like /users/0. An absolute JSON Pointer (/users/0/email): addressing a location inside a document from its root. */
    "json_pointer": new Scalar<string>({
        name: "json_pointer",
        label: "JSON Pointer",
        hint: "A path inside a document, like /users/0",
        error: "Start with / for each step, like /users/0/email.",
        details: "An absolute JSON Pointer (/users/0/email): addressing a location inside a document from its root.",
        level: "advanced",
        primitive: "string",
        aliases: ["pointer"],
        examples: { valid: ["/users/0/email","","/a~1b/~0c"], invalid: ["users/0","/a~2b"] },
        kind: "text",
        pattern: "^(/([^~/]|~[01])*)*$",
    }),
    /** Login token — Three parts joined by dots. A compact JSON Web Token: signed claims passed between parties. Handle like secret in storage and logs; prefer secret for opaque credentials. */
    "jwt": new Scalar<string>({
        name: "jwt",
        label: "Login token",
        hint: "Three parts joined by dots",
        error: "Please paste the whole token, like eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig.",
        details: "A compact JSON Web Token: signed claims passed between parties. Handle like secret in storage and logs; prefer secret for opaque credentials.",
        level: "advanced",
        primitive: "string",
        aliases: ["json_web_token","bearer_token"],
        examples: { valid: ["eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig","eyJhbGciOiJub25lIn0.eyJzdWIiOiIxIn0."], invalid: ["eyJhbGciOiJIUzI1NiJ9","not a token"] },
        kind: "text",
        pattern: "^[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]*$",
        minLen: 4,
    }),
    /** Language — Two or three small letters, like en. A BCP 47 language code (en): tagging what language content is in, with the 2-letter code where one exists. Prefer locale when region or script variants matter. The list: current language subtags (not deprecated, not private-use) from the IANA Language Subtag Registry, File-Date 2026-11-18, copied 2026-11-21. */
    "language": new Scalar<string>({
        name: "language",
        label: "Language",
        hint: "Two or three small letters, like en",
        error: "Please use the language code, like en.",
        details: "A BCP 47 language code (en): tagging what language content is in, with the 2-letter code where one exists. Prefer locale when region or script variants matter. The list: current language subtags (not deprecated, not private-use) from the IANA Language Subtag Registry, File-Date 2026-11-18, copied 2026-11-21.",
        level: "advanced",
        primitive: "string",
        aliases: ["language_code"],
        examples: { valid: ["en","haw","mul","cmn"], invalid: ["EN","english"] },
        kind: "text",
        pattern: "^[a-z]{2,3}$",
        list: ["aa","aaa","aab","aac","aad","aae","aaf","aag","aah","aai","aak","aal","aan","aao","aap","aaq","aas","aat","aau","aav","aaw","aax","aaz","ab","aba","abb","abc","abd","abe","abf","abg","abh","abi","abj","abl","abm","abn","abo","abp","abq","abr","abs","abt","abu","abv","abw","abx","aby","abz","aca","acb","acd","ace","acf","ach","aci","ack","acl","acm","acn","acp","acq","acr","acs","act","acu","acv","acw","acx","acy","acz","ada","adb","add","ade","adf","adg","adh","adi","adj","adl","adn","ado","adq","adr","ads","adt","adu","adw","adx","ady","adz","ae","aea","aeb","aec","aed","aee","aek","ael","aem","aen","aeq","aer","aes","aeu","aew","aey","aez","af","afa","afb","afd","afe","afg","afh","afi","afk","afn","afo","afp","afs","aft","afu","afz","aga","agb","agc","agd","age","agf","agg","agh","agi","agj","agk","agl","agm","agn","ago","agq","agr","ags","agt","agu","agv","agw","agx","agy","agz","aha","ahb","ahg","ahh","ahi","ahk","ahl","ahm","ahn","aho","ahp","ahr","ahs","aht","aia","aib","aic","aid","aie","aif","aig","aih","aii","aij","aik","ail","aim","ain","aio","aip","aiq","air","ait","aiw","aix","aiy","aja","ajg","aji","ajn","ajs","aju","ajw","ajz","ak","akb","akc","akd","ake","akf","akg","akh","aki","akj","akk","akl","akm","ako","akp","akq","akr","aks","akt","aku","akv","akw","akx","aky","akz","ala","alc","ald","ale","alf","alg","alh","ali","alj","alk","all","alm","aln","alo","alp","alq","alr","als","alt","alu","alv","alw","alx","aly","alz","am","ama","amb","amc","ame","amf","amg","ami","amj","amk","aml","amm","amn","amo","amp","amq","amr","ams","amt","amu","amv","amw","amx","amy","amz","an","ana","anb","anc","and","ane","anf","ang","anh","ani","anj","ank","anl","anm","ann","ano","anp","anq","anr","ans","ant","anu","anv","anw","anx","any","anz","aoa","aob","aoc","aod","aoe","aof","aog","aoi","aoj","aok","aol","aom","aon","aor","aos","aot","aou","aox","aoz","apa","apb","apc","apd","ape","apf","apg","aph","api","apj","apk","apl","apm","apn","apo","app","apq","apr","aps","apt","apu","apv","apw","apx","apy","apz","aqa","aqc","aqd","aqg","aqk","aql","aqm","aqn","aqp","aqr","aqt","aqz","ar","arb","arc","ard","are","arh","ari","arj","ark","arl","arn","aro","arp","arq","arr","ars","art","aru","arv","arw","arx","ary","arz","as","asa","asb","asc","ase","asf","asg","ash","asi","asj","ask","asl","asn","aso","asp","asq","asr","ass","ast","asu","asv","asw","asx","asy","asz","ata","atb","atc","atd","ate","atg","ath","ati","atj","atk","atl","atm","atn","ato","atp","atq","atr","ats","att","atu","atv","atw","atx","aty","atz","aua","aub","auc","aud","auf","aug","auh","aui","auj","auk","aul","aum","aun","auo","aup","auq","aur","aus","aut","auu","auw","aux","auy","auz","av","avb","avd","avi","avk","avl","avm","avn","avo","avs","avt","avu","avv","awa","awb","awc","awd","awe","awg","awh","awi","awk","awm","awn","awo","awr","aws","awt","awu","awv","aww","awx","awy","axb","axe","axg","axk","axl","axm","axx","ay","aya","ayb","ayc","ayd","aye","ayg","ayh","ayi","ayk","ayl","ayn","ayo","ayp","ayq","ayr","ays","ayt","ayu","ayz","az","aza","azb","azc","azd","azg","azj","azm","azn","azo","azt","azz","ba","baa","bab","bac","bad","bae","baf","bag","bah","bai","baj","bal","ban","bao","bap","bar","bas","bat","bau","bav","baw","bax","bay","bba","bbb","bbc","bbd","bbe","bbf","bbg","bbh","bbi","bbj","bbk","bbl","bbm","bbn","bbo","bbp","bbq","bbr","bbs","bbt","bbu","bbv","bbw","bbx","bby","bca","bcb","bcc","bcd","bce","bcf","bcg","bch","bci","bcj","bck","bcl","bcm","bcn","bco","bcp","bcq","bcr","bcs","bct","bcu","bcv","bcw","bcy","bcz","bda","bdb","bdc","bdd","bde","bdf","bdg","bdh","bdi","bdj","bdk","bdl","bdm","bdn","bdo","bdp","bdq","bdr","bds","bdt","bdu","bdv","bdw","bdx","bdy","bdz","be","bea","beb","bec","bed","bee","bef","beg","beh","bei","bej","bek","bem","beo","bep","beq","ber","bes","bet","beu","bev","bew","bex","bey","bez","bfa","bfb","bfc","bfd","bfe","bff","bfg","bfh","bfi","bfj","bfk","bfl","bfm","bfn","bfo","bfp","bfq","bfr","bfs","bft","bfu","bfw","bfx","bfy","bfz","bg","bga","bgb","bgc","bgd","bge","bgf","bgg","bgi","bgj","bgk","bgl","bgn","bgo","bgp","bgq","bgr","bgs","bgt","bgu","bgv","bgw","bgx","bgy","bgz","bha","bhb","bhc","bhd","bhe","bhf","bhg","bhh","bhi","bhj","bhl","bhm","bhn","bho","bhp","bhq","bhr","bhs","bht","bhu","bhv","bhw","bhx","bhy","bhz","bi","bia","bib","bid","bie","bif","big","bih","bik","bil","bim","bin","bio","bip","biq","bir","bit","biu","biv","biw","bix","biy","biz","bja","bjb","bjc","bje","bjf","bjg","bjh","bji","bjj","bjk","bjl","bjm","bjn","bjo","bjp","bjr","bjs","bjt","bju","bjv","bjw","bjx","bjy","bjz","bka","bkc","bkd","bkf","bkg","bkh","bki","bkj","bkk","bkl","bkm","bkn","bko","bkp","bkq","bkr","bks","bkt","bku","bkv","bkw","bkx","bky","bkz","bla","blb","blc","bld","ble","blf","blh","bli","blj","blk","bll","blm","bln","blo","blp","blq","blr","bls","blt","blv","blw","blx","bly","blz","bm","bma","bmb","bmc","bmd","bme","bmf","bmg","bmh","bmi","bmj","bmk","bml","bmm","bmn","bmo","bmp","bmq","bmr","bms","bmt","bmu","bmv","bmw","bmx","bmz","bn","bna","bnb","bnc","bnd","bne","bnf","bng","bni","bnj","bnk","bnl","bnm","bnn","bno","bnp","bnq","bnr","bns","bnt","bnu","bnv","bnw","bnx","bny","bnz","bo","boa","bob","boe","bof","bog","boh","boi","boj","bok","bol","bom","bon","boo","bop","boq","bor","bot","bou","bov","bow","box","boy","boz","bpa","bpc","bpd","bpe","bpg","bph","bpi","bpj","bpk","bpl","bpm","bpn","bpo","bpp","bpq","bpr","bps","bpt","bpu","bpv","bpw","bpx","bpy","bpz","bqa","bqb","bqc","bqd","bqf","bqg","bqh","bqi","bqj","bqk","bql","bqm","bqn","bqo","bqp","bqq","bqr","bqs","bqt","bqu","bqv","bqw","bqx","bqy","bqz","br","bra","brb","brc","brd","brf","brg","brh","bri","brj","brk","brl","brm","brn","bro","brp","brq","brr","brs","brt","bru","brv","brw","brx","bry","brz","bs","bsa","bsb","bsc","bse","bsf","bsg","bsh","bsi","bsj","bsk","bsl","bsm","bsn","bso","bsp","bsq","bsr","bss","bst","bsu","bsv","bsw","bsx","bsy","bta","btc","btd","bte","btf","btg","bth","bti","btj","btk","btm","btn","bto","btp","btq","btr","bts","btt","btu","btv","btw","btx","bty","btz","bua","bub","buc","bud","bue","buf","bug","buh","bui","buj","buk","bum","bun","buo","bup","buq","bus","but","buu","buv","buw","bux","buy","buz","bva","bvb","bvc","bvd","bve","bvf","bvg","bvh","bvi","bvj","bvk","bvl","bvm","bvn","bvo","bvp","bvq","bvr","bvt","bvu","bvv","bvw","bvx","bvy","bvz","bwa","bwb","bwc","bwd","bwe","bwf","bwg","bwh","bwi","bwj","bwk","bwl","bwm","bwn","bwo","bwp","bwq","bwr","bws","bwt","bwu","bww","bwx","bwy","bwz","bxa","bxb","bxc","bxd","bxe","bxf","bxg","bxh","bxi","bxj","bxk","bxl","bxm","bxn","bxo","bxp","bxq","bxr","bxs","bxu","bxv","bxw","bxz","bya","byb","byc","byd","bye","byf","byg","byh","byi","byj","byk","byl","bym","byn","byo","byp","byq","byr","bys","byt","byv","byw","byx","byz","bza","bzb","bzc","bzd","bze","bzf","bzg","bzh","bzi","bzj","bzk","bzl","bzm","bzn","bzo","bzp","bzq","bzr","bzs","bzt","bzu","bzv","bzw","bzx","bzy","bzz","ca","caa","cab","cac","cad","cae","caf","cag","cah","cai","caj","cak","cal","cam","can","cao","cap","caq","car","cas","cau","cav","caw","cax","cay","caz","cba","cbb","cbc","cbd","cbg","cbi","cbj","cbk","cbl","cbn","cbo","cbq","cbr","cbs","cbt","cbu","cbv","cbw","cby","ccc","ccd","cce","ccg","cch","ccj","ccl","ccm","ccn","cco","ccp","ccr","ccs","cda","cdc","cdd","cde","cdf","cdh","cdi","cdj","cdm","cdn","cdo","cdr","cds","cdy","cdz","ce","cea","ceb","ceg","cek","cel","cen","cet","cey","cfa","cfd","cfg","cfm","cga","cgc","cgg","cgk","ch","chb","chc","chd","chf","chg","chh","chj","chk","chl","chm","chn","cho","chp","chq","chr","cht","chw","chx","chy","chz","cia","cib","cic","cid","cie","cih","cik","cim","cin","cip","cir","ciw","ciy","cja","cje","cjh","cji","cjk","cjm","cjn","cjo","cjp","cjs","cjv","cjy","ckb","ckh","ckl","ckm","ckn","cko","ckq","ckr","cks","ckt","cku","ckv","ckx","cky","ckz","cla","clc","cld","cle","clh","cli","clj","clk","cll","clm","clo","cls","clt","clu","clw","cly","cma","cmc","cme","cmg","cmi","cml","cmm","cmn","cmo","cmr","cms","cmt","cna","cnb","cnc","cng","cnh","cni","cnk","cnl","cno","cnp","cnq","cnr","cns","cnt","cnu","cnw","cnx","co","coa","cob","coc","cod","coe","cof","cog","coh","coj","cok","col","com","con","coo","cop","coq","cot","cou","cov","cow","cox","coz","cpa","cpb","cpc","cpe","cpf","cpg","cpi","cpn","cpo","cpp","cps","cpu","cpx","cpy","cqd","cr","cra","crb","crc","crd","crf","crg","crh","cri","crj","crk","crl","crm","crn","cro","crp","crq","crr","crs","crt","crv","crw","crx","cry","crz","cs","csa","csb","csc","csd","cse","csf","csg","csh","csi","csj","csk","csl","csm","csn","cso","csp","csq","csr","css","cst","csu","csv","csw","csx","csy","csz","cta","ctc","ctd","cte","ctg","cth","ctl","ctm","ctn","cto","ctp","cts","ctt","ctu","cty","ctz","cu","cua","cub","cuc","cuh","cui","cuj","cuk","cul","cuo","cup","cuq","cur","cus","cut","cuu","cuv","cuw","cux","cuy","cv","cvg","cvn","cwa","cwb","cwd","cwe","cwg","cwt","cxh","cy","cya","cyb","cyo","czh","czk","czn","czo","czt","da","daa","dac","dad","dae","dag","dah","dai","daj","dak","dal","dam","dao","daq","dar","das","dau","dav","daw","dax","day","daz","dba","dbb","dbd","dbe","dbf","dbg","dbi","dbj","dbl","dbm","dbn","dbo","dbp","dbq","dbr","dbt","dbu","dbv","dbw","dby","dcc","dcr","dda","ddd","dde","ddg","ddi","ddj","ddn","ddo","ddr","dds","ddw","de","dec","ded","dee","def","deg","deh","dei","del","dem","den","dep","deq","der","des","dev","dez","dga","dgb","dgc","dgd","dge","dgg","dgh","dgi","dgk","dgl","dgn","dgo","dgr","dgs","dgt","dgw","dgx","dgz","dhd","dhg","dhi","dhl","dhm","dhn","dho","dhr","dhs","dhu","dhv","dhw","dhx","dia","dib","dic","did","dif","dig","dih","dii","dij","dik","dil","dim","din","dio","dip","diq","dir","dis","diu","diw","dix","diy","diz","dja","djb","djc","djd","dje","djf","dji","djj","djk","djm","djn","djo","djr","dju","djw","dka","dkg","dkk","dkr","dks","dkx","dlg","dlk","dlm","dln","dma","dmb","dmc","dmd","dme","dmf","dmg","dmk","dml","dmm","dmn","dmo","dmr","dms","dmu","dmv","dmw","dmx","dmy","dna","dnd","dne","dng","dni","dnj","dnk","dnn","dno","dnr","dnt","dnu","dnv","dnw","dny","doa","dob","doc","doe","dof","doh","doi","dok","dol","don","doo","dop","doq","dor","dos","dot","dov","dow","dox","doy","doz","dpp","dra","drb","drc","drd","dre","drg","dri","drl","drn","dro","drq","drs","drt","dru","dry","dsb","dse","dsh","dsi","dsk","dsl","dsn","dso","dsq","dsz","dta","dtb","dtd","dth","dti","dtk","dtm","dtn","dto","dtp","dtr","dts","dtt","dtu","dty","dua","dub","duc","due","duf","dug","duh","dui","duk","dul","dum","dun","duo","dup","duq","dur","dus","duu","duv","duw","dux","duy","duz","dv","dva","dwa","dwk","dwr","dws","dwu","dww","dwy","dwz","dya","dyb","dyd","dyg","dyi","dyl","dym","dyn","dyo","dyr","dyu","dyy","dz","dza","dzd","dze","dzg","dzl","dzn","eaa","ebc","ebg","ebk","ebo","ebr","ebu","ecr","ecs","ecy","ee","eee","efa","efe","efi","ega","egl","egm","ego","egx","egy","ehs","ehu","eip","eit","eiv","eja","eka","eke","ekg","eki","ekk","ekl","ekm","eko","ekp","ekr","eky","el","ele","elh","eli","elk","elm","elo","elu","elx","ema","emb","eme","emg","emi","emk","emm","emn","emp","emq","ems","emu","emw","emx","emy","emz","en","ena","enb","enc","end","enf","enh","enl","enm","enn","eno","enq","enr","enu","env","enw","enx","eo","eot","epi","era","erg","erh","eri","erk","ero","err","ers","ert","erw","es","ese","esg","esh","esi","esk","esl","esm","esn","eso","esq","ess","esu","esx","esy","et","etb","etc","eth","etn","eto","etr","ets","ett","etu","etx","etz","eu","eud","euq","eve","evh","evn","ewo","ext","eya","eyo","eza","eze","fa","faa","fab","fad","faf","fag","fah","fai","faj","fak","fal","fam","fan","fap","far","fat","fau","fax","fay","faz","fbl","fcs","fer","ff","ffi","ffm","fgr","fi","fia","fie","fif","fil","fip","fir","fit","fiu","fiw","fj","fkk","fkv","fla","flh","fli","fll","fln","flr","fly","fmp","fmu","fnb","fng","fni","fo","fod","foi","fom","fon","for","fos","fox","fpe","fqs","fr","frc","frd","frk","frm","fro","frp","frq","frr","frs","frt","fse","fsl","fss","fub","fuc","fud","fue","fuf","fuh","fui","fuj","fum","fun","fuq","fur","fut","fuu","fuv","fuy","fvr","fwa","fwe","fy","ga","gaa","gab","gac","gad","gae","gaf","gag","gah","gai","gaj","gak","gal","gam","gan","gao","gap","gaq","gar","gas","gat","gau","gaw","gax","gay","gaz","gba","gbb","gbd","gbe","gbf","gbg","gbh","gbi","gbj","gbk","gbl","gbm","gbn","gbo","gbp","gbq","gbr","gbs","gbu","gbv","gbw","gbx","gby","gbz","gcc","gcd","gce","gcf","gcl","gcn","gcr","gct","gd","gda","gdb","gdc","gdd","gde","gdf","gdg","gdh","gdi","gdj","gdk","gdl","gdm","gdn","gdo","gdq","gdr","gds","gdt","gdu","gdx","gea","geb","gec","ged","gef","geg","geh","gei","gej","gek","gel","gem","geq","ges","gev","gew","gex","gey","gez","gfk","gft","gga","ggb","ggd","gge","ggg","ggk","ggl","ggt","ggu","ggw","gha","ghc","ghe","ghh","ghk","ghl","ghn","gho","ghr","ghs","ght","gia","gib","gic","gid","gie","gig","gih","gii","gil","gim","gin","gip","giq","gir","gis","git","giu","giw","gix","giy","giz","gjk","gjm","gjn","gjr","gju","gka","gkd","gke","gkn","gko","gkp","gku","gl","glb","glc","gld","glh","glj","glk","gll","glo","glr","glu","glw","gly","gma","gmb","gmd","gme","gmg","gmh","gml","gmm","gmn","gmq","gmr","gmu","gmv","gmw","gmx","gmy","gmz","gn","gna","gnb","gnc","gnd","gne","gng","gnh","gni","gnj","gnk","gnl","gnm","gnn","gno","gnq","gnr","gnt","gnu","gnw","gnz","goa","gob","goc","god","goe","gof","gog","goh","goi","goj","gok","gol","gom","gon","goo","gop","goq","gor","gos","got","gou","gov","gow","gox","goy","goz","gpa","gpe","gpn","gqa","gqi","gqn","gqr","gqu","gra","grb","grc","grd","grg","grh","gri","grj","grk","grm","gro","grq","grr","grs","grt","gru","grv","grw","grx","gry","grz","gse","gsg","gsl","gsm","gsn","gso","gsp","gss","gsw","gta","gtu","gu","gua","gub","guc","gud","gue","guf","gug","guh","gui","guk","gul","gum","gun","guo","gup","guq","gur","gus","gut","guu","guw","gux","guz","gv","gva","gvc","gve","gvf","gvj","gvl","gvm","gvn","gvo","gvp","gvr","gvs","gvy","gwa","gwb","gwc","gwd","gwe","gwf","gwg","gwi","gwj","gwm","gwn","gwr","gwt","gwu","gww","gwx","gxx","gya","gyb","gyd","gye","gyf","gyg","gyi","gyl","gym","gyn","gyo","gyr","gyy","gyz","gza","gzi","gzn","ha","haa","hab","hac","had","hae","haf","hag","hah","hai","haj","hak","hal","ham","han","hao","hap","haq","har","has","hav","haw","hax","hay","haz","hba","hbb","hbn","hbo","hbu","hca","hch","hdn","hds","hdy","he","hea","hed","heg","heh","hei","hem","hgm","hgw","hhi","hhr","hhy","hi","hia","hib","hid","hif","hig","hih","hii","hij","hik","hil","him","hio","hir","hit","hiw","hix","hji","hka","hke","hkh","hkk","hkn","hks","hla","hlb","hld","hle","hlt","hlu","hma","hmb","hmc","hmd","hme","hmf","hmg","hmh","hmi","hmj","hmk","hml","hmm","hmn","hmp","hmq","hmr","hms","hmt","hmu","hmv","hmw","hmx","hmy","hmz","hna","hnd","hne","hng","hnh","hni","hnj","hnm","hnn","hno","hns","hnu","ho","hoa","hob","hoc","hod","hoe","hoh","hoi","hoj","hok","hol","hom","hoo","hop","hor","hos","hot","hov","how","hoy","hoz","hpo","hps","hr","hra","hrc","hre","hrk","hrm","hro","hrp","hrt","hru","hrw","hrx","hrz","hsb","hsh","hsl","hsn","hss","ht","hti","hto","hts","htu","htx","hu","hub","huc","hud","hue","huf","hug","huh","hui","huj","huk","hul","hum","huo","hup","huq","hur","hus","hut","huu","huv","huw","hux","huy","huz","hvc","hve","hvk","hvn","hvv","hwa","hwc","hwo","hy","hya","hyw","hyx","hz","ia","iai","ian","iar","iba","ibb","ibd","ibe","ibg","ibh","ibl","ibm","ibn","ibr","ibu","iby","ica","ich","icl","icr","id","ida","idb","idc","idd","ide","idi","idr","ids","idt","idu","ie","ifa","ifb","ife","iff","ifk","ifm","ifu","ify","ig","igb","ige","igg","igl","igm","ign","igo","igs","igw","ihb","ihi","ihp","ihw","ii","iin","iir","ijc","ije","ijj","ijn","ijo","ijs","ik","ike","ikh","iki","ikk","ikl","iko","ikp","ikr","iks","ikt","ikv","ikw","ikx","ikz","ila","ilb","ilg","ili","ilk","ilm","ilo","ilp","ils","ilu","ilv","ima","imi","iml","imn","imo","imr","ims","imt","imy","inb","inc","ine","ing","inh","inj","inl","inm","inn","ino","inp","ins","int","inz","io","ior","iou","iow","ipi","ipo","iqu","iqw","ira","ire","irh","iri","irk","irn","iro","irr","iru","irx","iry","is","isa","isc","isd","ise","isg","ish","isi","isk","ism","isn","iso","isr","ist","isu","isv","it","itb","itc","itd","ite","iti","itk","itl","itm","ito","itr","its","itt","itv","itw","itx","ity","itz","iu","ium","ivb","ivv","iwk","iwm","iwo","iws","ixc","ixl","iya","iyo","iyx","izh","izm","izr","izz","ja","jaa","jab","jac","jad","jae","jaf","jah","jaj","jak","jal","jam","jan","jao","jaq","jas","jat","jau","jax","jay","jaz","jbe","jbi","jbj","jbk","jbm","jbn","jbo","jbr","jbt","jbu","jbw","jcs","jct","jda","jdg","jdt","jeb","jee","jeh","jei","jek","jel","jen","jer","jet","jeu","jgb","jge","jgk","jgo","jhi","jhs","jia","jib","jic","jid","jie","jig","jih","jii","jil","jim","jio","jiq","jit","jiu","jiv","jiy","jje","jjr","jka","jkm","jko","jkp","jkr","jks","jku","jle","jls","jma","jmb","jmc","jmd","jmi","jml","jmn","jmr","jms","jmw","jmx","jna","jnd","jng","jni","jnj","jnl","jns","job","jod","jog","jor","jos","jow","jpa","jpr","jpx","jqr","jra","jrb","jrr","jrt","jru","jsl","jua","jub","juc","jud","juh","jui","juk","jul","jum","jun","juo","jup","jur","jus","jut","juu","juw","juy","jv","jvd","jvn","jwi","jya","jye","jyy","ka","kaa","kab","kac","kad","kae","kaf","kag","kah","kai","kaj","kak","kam","kao","kap","kaq","kar","kav","kaw","kax","kay","kba","kbb","kbc","kbd","kbe","kbg","kbh","kbi","kbj","kbk","kbl","kbm","kbn","kbo","kbp","kbq","kbr","kbs","kbt","kbu","kbv","kbw","kbx","kby","kbz","kca","kcb","kcc","kcd","kce","kcf","kcg","kch","kci","kcj","kck","kcl","kcm","kcn","kco","kcp","kcq","kcr","kcs","kct","kcu","kcv","kcw","kcx","kcy","kcz","kda","kdc","kdd","kde","kdf","kdg","kdh","kdi","kdj","kdk","kdl","kdm","kdn","kdo","kdp","kdq","kdr","kdt","kdu","kdw","kdx","kdy","kdz","kea","keb","kec","ked","kee","kef","keg","keh","kei","kej","kek","kel","kem","ken","keo","kep","keq","ker","kes","ket","keu","kev","kew","kex","key","kez","kfa","kfb","kfc","kfd","kfe","kff","kfg","kfh","kfi","kfj","kfk","kfl","kfm","kfn","kfo","kfp","kfq","kfr","kfs","kft","kfu","kfv","kfw","kfx","kfy","kfz","kg","kga","kgb","kge","kgf","kgg","kgi","kgj","kgk","kgl","kgn","kgo","kgp","kgq","kgr","kgs","kgt","kgu","kgv","kgw","kgx","kgy","kha","khb","khc","khd","khe","khf","khg","khh","khi","khj","khk","khl","khn","kho","khp","khq","khr","khs","kht","khu","khv","khw","khx","khy","khz","ki","kia","kib","kic","kid","kie","kif","kig","kih","kii","kij","kil","kim","kio","kip","kiq","kis","kit","kiu","kiv","kiw","kix","kiy","kiz","kj","kja","kjb","kjc","kjd","kje","kjg","kjh","kji","kjj","kjk","kjl","kjm","kjn","kjo","kjp","kjq","kjr","kjs","kjt","kju","kjv","kjx","kjy","kjz","kk","kka","kkb","kkc","kkd","kke","kkf","kkg","kkh","kki","kkj","kkk","kkl","kkm","kkn","kko","kkp","kkq","kkr","kks","kkt","kku","kkv","kkw","kkx","kky","kkz","kl","kla","klb","klc","kld","kle","klf","klg","klh","kli","klj","klk","kll","klm","kln","klo","klp","klq","klr","kls","klt","klu","klv","klw","klx","kly","klz","km","kma","kmb","kmc","kmd","kme","kmf","kmg","kmh","kmi","kmj","kmk","kml","kmm","kmn","kmo","kmp","kmq","kmr","kms","kmt","kmu","kmv","kmw","kmx","kmy","kmz","kn","kna","knb","knc","knd","kne","knf","kng","kni","knj","knk","knl","knm","knn","kno","knp","knq","knr","kns","knt","knu","knv","knw","knx","kny","knz","ko","koa","koc","kod","koe","kof","kog","koh","koi","kok","kol","koo","kop","koq","kos","kot","kou","kov","kow","koy","koz","kpa","kpb","kpc","kpd","kpe","kpf","kpg","kph","kpi","kpj","kpk","kpl","kpm","kpn","kpo","kpq","kpr","kps","kpt","kpu","kpv","kpw","kpx","kpy","kpz","kqa","kqb","kqc","kqd","kqe","kqf","kqg","kqh","kqi","kqj","kqk","kql","kqm","kqn","kqo","kqp","kqq","kqr","kqs","kqt","kqu","kqv","kqw","kqx","kqy","kqz","kr","kra","krb","krc","krd","kre","krf","krh","kri","krj","krk","krl","krn","kro","krp","krr","krs","krt","kru","krv","krw","krx","kry","krz","ks","ksb","ksc","ksd","kse","ksf","ksg","ksh","ksi","ksj","ksk","ksl","ksm","ksn","kso","ksp","ksq","ksr","kss","kst","ksu","ksv","ksw","ksx","ksy","ksz","kta","ktb","ktc","ktd","kte","ktf","ktg","kth","kti","ktj","ktk","ktl","ktm","ktn","kto","ktp","ktq","kts","ktt","ktu","ktv","ktw","ktx","kty","ktz","ku","kub","kuc","kud","kue","kuf","kug","kuh","kui","kuj","kuk","kul","kum","kun","kuo","kup","kuq","kus","kut","kuu","kuv","kuw","kux","kuy","kuz","kv","kva","kvb","kvc","kvd","kve","kvf","kvg","kvh","kvi","kvj","kvk","kvl","kvm","kvn","kvo","kvp","kvq","kvr","kvt","kvu","kvv","kvw","kvx","kvy","kvz","kw","kwa","kwb","kwc","kwd","kwe","kwf","kwg","kwh","kwi","kwj","kwk","kwl","kwm","kwn","kwo","kwp","kwr","kws","kwt","kwu","kwv","kww","kwx","kwy","kwz","kxa","kxb","kxc","kxd","kxf","kxh","kxi","kxj","kxk","kxm","kxn","kxo","kxp","kxq","kxr","kxs","kxt","kxv","kxw","kxx","kxy","kxz","ky","kya","kyb","kyc","kyd","kye","kyf","kyg","kyh","kyi","kyj","kyk","kyl","kym","kyn","kyo","kyp","kyq","kyr","kys","kyt","kyu","kyv","kyw","kyx","kyy","kyz","kza","kzb","kzc","kzd","kze","kzf","kzg","kzi","kzk","kzl","kzm","kzn","kzo","kzp","kzq","kzr","kzs","kzu","kzv","kzw","kzx","kzy","kzz","la","laa","lab","lac","lad","lae","laf","lag","lah","lai","laj","lal","lam","lan","lap","laq","lar","las","lau","law","lax","lay","laz","lb","lbb","lbc","lbe","lbf","lbg","lbi","lbj","lbk","lbl","lbm","lbn","lbo","lbq","lbr","lbs","lbt","lbu","lbv","lbw","lbx","lby","lbz","lcc","lcd","lce","lcf","lch","lcl","lcm","lcp","lcq","lcs","lda","ldb","ldd","ldg","ldh","ldi","ldj","ldk","ldl","ldm","ldn","ldo","ldp","ldq","lea","leb","lec","led","lee","lef","leh","lei","lej","lek","lel","lem","len","leo","lep","leq","ler","les","let","leu","lev","lew","lex","ley","lez","lfa","lfb","lfn","lg","lga","lgb","lgg","lgh","lgi","lgk","lgl","lgm","lgn","lgo","lgq","lgr","lgs","lgt","lgu","lgz","lha","lhh","lhi","lhl","lhm","lhn","lhp","lhs","lht","lhu","li","lia","lib","lic","lid","lie","lif","lig","lih","lij","lik","lil","lio","lip","liq","lir","lis","liu","liv","liw","lix","liy","liz","lja","lje","lji","ljl","ljp","ljw","ljx","lka","lkb","lkc","lkd","lke","lkh","lki","lkj","lkl","lkm","lkn","lko","lkr","lks","lkt","lku","lky","lla","llb","llc","lld","lle","llf","llg","llh","lli","llj","llk","lll","llm","lln","llp","llq","lls","llu","llx","lma","lmb","lmc","lmd","lme","lmf","lmg","lmh","lmi","lmj","lmk","lml","lmn","lmo","lmp","lmq","lmr","lmu","lmv","lmw","lmx","lmy","ln","lna","lnb","lnd","lng","lnh","lni","lnj","lnl","lnm","lnn","lns","lnu","lnw","lnz","lo","loa","lob","loc","loe","lof","log","loh","loi","loj","lok","lol","lom","lon","loo","lop","loq","lor","los","lot","lou","lov","low","lox","loy","loz","lpa","lpe","lpn","lpo","lpx","lqr","lra","lrc","lre","lrg","lri","lrk","lrl","lrm","lrn","lro","lrr","lrt","lrv","lrz","lsa","lsb","lsc","lsd","lse","lsh","lsi","lsl","lsm","lsn","lso","lsp","lsr","lss","lst","lsv","lsw","lsy","lt","ltc","ltg","lth","lti","ltn","lto","lts","ltu","lu","lua","luc","lud","lue","luf","luh","lui","luj","luk","lul","lum","lun","luo","lup","luq","lur","lus","lut","luu","luv","luw","luy","luz","lv","lva","lvi","lvk","lvl","lvs","lvu","lwa","lwe","lwg","lwh","lwl","lwm","lwo","lws","lwt","lwu","lww","lxm","lya","lyg","lyn","lzh","lzl","lzn","lzz","maa","mab","mad","mae","maf","mag","mai","maj","mak","mam","man","map","maq","mas","mat","mau","mav","maw","max","maz","mba","mbb","mbc","mbd","mbe","mbf","mbh","mbi","mbj","mbk","mbl","mbm","mbn","mbo","mbp","mbq","mbr","mbs","mbt","mbu","mbv","mbw","mbx","mby","mbz","mca","mcb","mcc","mcd","mce","mcf","mcg","mch","mci","mcj","mck","mcl","mcm","mcn","mco","mcp","mcq","mcr","mcs","mct","mcu","mcv","mcw","mcx","mcy","mcz","mda","mdb","mdc","mdd","mde","mdf","mdg","mdh","mdi","mdj","mdk","mdl","mdm","mdn","mdp","mdq","mdr","mds","mdt","mdu","mdv","mdw","mdx","mdy","mdz","mea","meb","mec","med","mee","mef","meh","mei","mej","mek","mel","mem","men","meo","mep","meq","mer","mes","met","meu","mev","mew","mey","mez","mfa","mfb","mfc","mfd","mfe","mff","mfg","mfh","mfi","mfj","mfk","mfl","mfm","mfn","mfo","mfp","mfq","mfr","mfs","mft","mfu","mfv","mfw","mfx","mfy","mfz","mg","mga","mgb","mgc","mgd","mge","mgf","mgg","mgh","mgi","mgj","mgk","mgl","mgm","mgn","mgo","mgp","mgq","mgr","mgs","mgt","mgu","mgv","mgw","mgy","mgz","mh","mha","mhb","mhc","mhd","mhe","mhf","mhg","mhi","mhj","mhk","mhl","mhm","mhn","mho","mhp","mhq","mhr","mhs","mht","mhu","mhw","mhx","mhy","mhz","mi","mia","mib","mic","mid","mie","mif","mig","mih","mii","mij","mik","mil","mim","min","mio","mip","miq","mir","mis","mit","miu","miw","mix","miy","miz","mjb","mjc","mjd","mje","mjg","mjh","mji","mjj","mjk","mjl","mjm","mjn","mjo","mjp","mjq","mjr","mjs","mjt","mju","mjv","mjw","mjx","mjy","mjz","mk","mka","mkb","mkc","mke","mkf","mkg","mkh","mki","mkj","mkk","mkl","mkm","mkn","mko","mkp","mkq","mkr","mks","mkt","mku","mkv","mkw","mkx","mky","mkz","ml","mla","mlb","mlc","mle","mlf","mlh","mli","mlj","mlk","mll","mlm","mln","mlo","mlp","mlq","mlr","mls","mlu","mlv","mlw","mlx","mlz","mma","mmb","mmc","mmd","mme","mmf","mmg","mmh","mmi","mmj","mmk","mml","mmm","mmn","mmo","mmp","mmq","mmr","mmt","mmu","mmv","mmw","mmx","mmy","mmz","mn","mna","mnb","mnc","mnd","mne","mnf","mng","mnh","mni","mnj","mnk","mnl","mnm","mnn","mno","mnp","mnq","mnr","mns","mnu","mnv","mnw","mnx","mny","mnz","moa","moc","mod","moe","mog","moh","moi","moj","mok","mom","moo","mop","moq","mor","mos","mot","mou","mov","mow","mox","moy","moz","mpa","mpb","mpc","mpd","mpe","mpg","mph","mpi","mpj","mpk","mpl","mpm","mpn","mpo","mpp","mpq","mpr","mps","mpt","mpu","mpv","mpw","mpx","mpy","mpz","mqa","mqb","mqc","mqe","mqf","mqg","mqh","mqi","mqj","mqk","mql","mqm","mqn","mqo","mqp","mqq","mqr","mqs","mqt","mqu","mqv","mqw","mqx","mqy","mqz","mr","mra","mrb","mrc","mre","mrf","mrg","mrh","mrj","mrk","mrl","mrm","mrn","mro","mrp","mrq","mrr","mrs","mrt","mru","mrv","mrw","mrx","mry","mrz","ms","msb","msc","msd","mse","msf","msg","msh","msi","msj","msk","msl","msm","msn","mso","msp","msq","msr","mss","msu","msv","msw","msx","msy","msz","mt","mta","mtb","mtc","mtd","mte","mtf","mtg","mth","mti","mtj","mtk","mtl","mtm","mtn","mto","mtp","mtq","mtr","mts","mtt","mtu","mtv","mtw","mtx","mty","mua","mub","muc","mud","mue","mug","muh","mui","muj","muk","mul","mum","mun","muo","mup","muq","mur","mus","mut","muu","muv","mux","muy","muz","mva","mvb","mvd","mve","mvf","mvg","mvh","mvi","mvk","mvl","mvn","mvo","mvp","mvq","mvr","mvs","mvt","mvu","mvv","mvw","mvx","mvy","mvz","mwa","mwb","mwc","mwe","mwf","mwg","mwh","mwi","mwk","mwl","mwm","mwn","mwo","mwp","mwq","mwr","mws","mwt","mwu","mwv","mww","mwz","mxa","mxb","mxc","mxd","mxe","mxf","mxg","mxh","mxi","mxj","mxk","mxl","mxm","mxn","mxo","mxp","mxq","mxr","mxs","mxt","mxu","mxv","mxw","mxx","mxy","mxz","my","myb","myc","mye","myf","myg","myh","myj","myk","myl","mym","myn","myo","myp","myr","mys","myu","myv","myw","myx","myy","myz","mza","mzb","mzc","mzd","mze","mzg","mzh","mzi","mzj","mzk","mzl","mzm","mzn","mzo","mzp","mzq","mzr","mzs","mzt","mzu","mzv","mzw","mzx","mzy","mzz","na","naa","nab","nac","nae","naf","nag","nah","nai","naj","nak","nal","nam","nan","nao","nap","naq","nar","nas","nat","naw","nax","nay","naz","nb","nba","nbb","nbc","nbd","nbe","nbg","nbh","nbi","nbj","nbk","nbm","nbn","nbo","nbp","nbq","nbr","nbs","nbt","nbu","nbv","nbw","nby","nca","ncb","ncc","ncd","nce","ncf","ncg","nch","nci","ncj","nck","ncl","ncm","ncn","nco","ncq","ncr","ncs","nct","ncu","ncx","ncz","nd","nda","ndb","ndc","ndd","ndf","ndg","ndh","ndi","ndj","ndk","ndl","ndm","ndn","ndp","ndq","ndr","nds","ndt","ndu","ndv","ndw","ndx","ndy","ndz","ne","nea","neb","nec","ned","nee","nef","neg","neh","nei","nej","nek","nem","nen","neo","neq","ner","nes","net","neu","nev","new","nex","ney","nez","nfa","nfd","nfl","nfr","nfu","ng","nga","ngb","ngc","ngd","nge","ngf","ngg","ngh","ngi","ngj","ngk","ngl","ngm","ngn","ngp","ngq","ngr","ngs","ngt","ngu","ngv","ngw","ngx","ngy","ngz","nha","nhb","nhc","nhd","nhe","nhf","nhg","nhh","nhi","nhk","nhm","nhn","nho","nhp","nhq","nhr","nht","nhu","nhv","nhw","nhx","nhy","nhz","nia","nib","nic","nid","nie","nif","nig","nih","nii","nij","nik","nil","nim","nin","nio","niq","nir","nis","nit","niu","niv","niw","nix","niy","niz","nja","njb","njd","njh","nji","njj","njl","njm","njn","njo","njr","njs","njt","nju","njx","njy","njz","nka","nkb","nkc","nkd","nke","nkf","nkg","nkh","nki","nkj","nkk","nkm","nkn","nko","nkp","nkq","nkr","nks","nkt","nku","nkv","nkw","nkx","nkz","nl","nla","nlc","nle","nlg","nli","nlj","nlk","nll","nlm","nlo","nlq","nlu","nlv","nlw","nlx","nly","nlz","nma","nmb","nmc","nmd","nme","nmf","nmg","nmh","nmi","nmj","nmk","nml","nmm","nmn","nmo","nmp","nmq","nmr","nms","nmt","nmu","nmv","nmw","nmx","nmy","nmz","nn","nna","nnb","nnc","nnd","nne","nnf","nng","nnh","nni","nnj","nnk","nnl","nnm","nnn","nnp","nnq","nnr","nnt","nnu","nnv","nnw","nny","nnz","no","noa","noc","nod","noe","nof","nog","noh","noi","noj","nok","nol","non","nop","noq","nos","not","nou","nov","now","noy","noz","npa","npb","npg","nph","npi","npl","npn","npo","nps","npu","npx","npy","nqg","nqk","nql","nqm","nqn","nqo","nqq","nqt","nqy","nr","nra","nrb","nrc","nre","nrf","nrg","nri","nrk","nrl","nrm","nrn","nrp","nrr","nrt","nru","nrx","nrz","nsa","nsb","nsc","nsd","nse","nsf","nsg","nsh","nsi","nsk","nsl","nsm","nsn","nso","nsp","nsq","nsr","nss","nst","nsu","nsv","nsw","nsx","nsy","nsz","ntd","ntg","nti","ntj","ntk","ntm","nto","ntp","ntr","ntu","ntw","ntx","nty","ntz","nua","nub","nuc","nud","nue","nuf","nug","nuh","nui","nuj","nuk","nul","num","nun","nuo","nup","nuq","nur","nus","nut","nuu","nuv","nuw","nux","nuy","nuz","nv","nvh","nvm","nvo","nwa","nwb","nwc","nwe","nwg","nwi","nwm","nwo","nwr","nww","nwx","nwy","nxa","nxd","nxe","nxg","nxi","nxk","nxl","nxm","nxn","nxo","nxq","nxr","nxx","ny","nyb","nyc","nyd","nye","nyf","nyg","nyh","nyi","nyj","nyk","nyl","nym","nyn","nyo","nyp","nyq","nyr","nys","nyt","nyu","nyv","nyw","nyx","nyy","nza","nzb","nzd","nzi","nzk","nzm","nzr","nzs","nzu","nzy","nzz","oaa","oac","oak","oar","oav","obi","obk","obl","obm","obo","obr","obt","obu","oc","oca","och","ocm","oco","ocu","oda","odk","odt","odu","ofo","ofs","ofu","ogb","ogc","oge","ogg","ogo","ogu","oht","ohu","oia","oie","oin","oj","ojb","ojc","ojg","ojp","ojs","ojv","ojw","oka","okb","okc","okd","oke","okg","okh","oki","okj","okk","okl","okm","okn","oko","okr","oks","oku","okv","okx","okz","ola","olb","old","ole","olk","olm","olo","olr","olt","olu","om","oma","omb","omc","omg","omi","omk","oml","omn","omo","omp","omq","omr","omt","omu","omv","omw","omx","omy","ona","onb","one","ong","oni","onj","onk","onn","ono","onp","onr","ons","ont","onu","onw","onx","ood","oog","oon","oor","oos","opa","opk","opm","opo","opt","opy","or","ora","orc","ore","org","orh","orn","oro","orr","ors","ort","oru","orv","orw","orx","ory","orz","os","osa","osc","osd","osi","osn","oso","osp","ost","osu","osx","ota","otb","otd","ote","oti","otk","otl","otm","otn","oto","otq","otr","ots","ott","otu","otw","otx","oty","otz","oua","oub","oue","oui","oum","ovd","owi","owl","oyb","oyd","oym","oyy","ozm","pa","paa","pab","pac","pad","pae","paf","pag","pah","pai","pak","pal","pam","pao","pap","paq","par","pas","pau","pav","paw","pax","pay","paz","pbb","pbc","pbe","pbf","pbg","pbh","pbi","pbl","pbm","pbn","pbo","pbp","pbr","pbs","pbt","pbu","pbv","pby","pca","pcb","pcc","pcd","pce","pcf","pcg","pch","pci","pcj","pck","pcl","pcm","pcn","pcp","pcw","pda","pdc","pdi","pdn","pdo","pdt","pdu","pea","peb","ped","pee","pef","peg","peh","pei","pej","pek","pel","pem","peo","pep","peq","pes","pev","pex","pey","pez","pfa","pfe","pfl","pga","pgd","pgg","pgi","pgk","pgl","pgn","pgs","pgu","pgz","pha","phd","phg","phh","phi","phj","phk","phl","phm","phn","pho","phq","phr","pht","phu","phv","phw","pi","pia","pib","pic","pid","pie","pif","pig","pih","pij","pil","pim","pin","pio","pip","pir","pis","pit","piu","piv","piw","pix","piy","piz","pjt","pka","pkb","pkc","pkg","pkh","pkn","pko","pkp","pkr","pks","pkt","pku","pl","pla","plb","plc","pld","ple","plf","plg","plh","plk","pll","pln","plo","plq","plr","pls","plt","plu","plv","plw","ply","plz","pma","pmb","pmd","pme","pmf","pmh","pmi","pmj","pml","pmm","pmn","pmo","pmq","pmr","pms","pmt","pmw","pmx","pmy","pmz","pna","pnb","pnc","pnd","pne","png","pnh","pni","pnj","pnk","pnl","pnm","pnn","pno","pnp","pnq","pnr","pns","pnt","pnu","pnv","pnw","pnx","pny","pnz","poc","poe","pof","pog","poh","poi","pok","pom","pon","poo","pop","poq","pos","pot","pov","pow","pox","poy","poz","ppe","ppi","ppk","ppl","ppm","ppn","ppo","ppp","ppq","pps","ppt","ppu","pqa","pqe","pqm","pqw","pra","prc","prd","pre","prf","prg","prh","pri","prk","prl","prm","prn","pro","prq","prr","prs","prt","pru","prw","prx","prz","ps","psa","psc","psd","pse","psg","psh","psi","psl","psm","psn","pso","psp","psq","psr","pss","pst","psu","psw","psy","pt","pta","pth","pti","ptn","pto","ptp","ptq","ptr","ptt","ptu","ptv","ptw","pty","pua","pub","puc","pud","pue","puf","pug","pui","puj","pum","puo","pup","puq","pur","put","puu","puw","pux","puy","pwa","pwb","pwg","pwi","pwm","pwn","pwo","pwr","pww","pxm","pye","pym","pyn","pys","pyu","pyx","pyy","pze","pzh","pzn","qu","qua","qub","quc","qud","quf","qug","quh","qui","quk","qul","qum","qun","qup","quq","qur","qus","quv","quw","qux","quy","quz","qva","qvc","qve","qvh","qvi","qvj","qvl","qvm","qvn","qvo","qvp","qvs","qvw","qvy","qvz","qwa","qwc","qwe","qwh","qwm","qws","qwt","qxa","qxc","qxh","qxl","qxn","qxo","qxp","qxq","qxr","qxs","qxt","qxu","qxw","qya","qyp","raa","rab","rac","rad","raf","rag","rah","rai","raj","rak","ral","ram","ran","rao","rap","raq","rar","ras","rat","rau","rav","raw","rax","ray","raz","rbb","rbk","rbl","rbp","rcf","rdb","rea","reb","ree","reg","rei","rej","rel","rem","ren","rer","res","ret","rey","rga","rge","rgk","rgn","rgr","rgs","rgu","rhg","rhp","ria","rib","rif","ril","rim","rin","rir","rit","riu","rjg","rji","rjs","rka","rkb","rkh","rki","rkm","rkt","rkw","rm","rma","rmb","rmc","rmd","rme","rmf","rmg","rmh","rmi","rmk","rml","rmm","rmn","rmo","rmp","rmq","rms","rmt","rmu","rmv","rmw","rmx","rmy","rmz","rn","rnb","rnd","rng","rnl","rnn","rnp","rnr","rnw","ro","roa","rob","roc","rod","roe","rof","rog","rol","rom","roo","rop","ror","rou","row","rpn","rpt","rri","rrm","rro","rrt","rsb","rsk","rsl","rsm","rsn","rsw","rtc","rth","rtm","rts","rtw","ru","rub","ruc","rue","ruf","rug","ruh","rui","ruk","ruo","rup","ruq","rut","ruu","ruy","ruz","rw","rwa","rwk","rwl","rwm","rwo","rwr","rxd","rxw","ryn","rys","ryu","rzh","sa","saa","sab","sac","sad","sae","saf","sah","sai","saj","sak","sal","sam","sao","saq","sar","sas","sat","sau","sav","saw","sax","say","saz","sba","sbb","sbc","sbd","sbe","sbf","sbg","sbh","sbi","sbj","sbk","sbl","sbm","sbn","sbo","sbp","sbq","sbr","sbs","sbt","sbu","sbv","sbw","sbx","sby","sbz","sc","scb","sce","scf","scg","sch","sci","sck","scl","scn","sco","scp","scq","scs","sct","scu","scv","scw","scx","scz","sd","sda","sdb","sdc","sde","sdf","sdg","sdh","sdj","sdk","sdl","sdn","sdo","sdp","sdq","sdr","sds","sdt","sdu","sdv","sdx","sdz","se","sea","seb","sec","sed","see","sef","seg","seh","sei","sej","sek","sel","sem","sen","seo","sep","seq","ser","ses","set","seu","sev","sew","sey","sez","sfb","sfe","sfm","sfs","sfw","sg","sga","sgb","sgc","sgd","sge","sgg","sgh","sgi","sgj","sgk","sgm","sgn","sgp","sgr","sgs","sgt","sgu","sgw","sgx","sgy","sgz","sh","sha","shb","shc","shd","she","shg","shh","shi","shj","shk","shm","shn","sho","shp","shq","shr","shs","sht","shu","shv","shw","shx","shy","shz","si","sia","sib","sid","sie","sif","sig","sih","sii","sij","sik","sil","sim","sio","sip","siq","sir","sis","sit","siu","siv","siw","six","siy","siz","sja","sjb","sjc","sjd","sje","sjg","sjk","sjl","sjm","sjn","sjo","sjp","sjr","sjs","sjt","sju","sjw","sk","ska","skb","skc","skd","ske","skf","skg","skh","ski","skj","skm","skn","sko","skp","skq","skr","sks","skt","sku","skv","skw","skx","sky","skz","sl","sla","slc","sld","sle","slf","slg","slh","sli","slj","sll","slm","sln","slp","slr","sls","slt","slu","slw","slx","sly","slz","sm","sma","smb","smc","smf","smg","smh","smi","smj","smk","sml","smm","smn","smp","smq","smr","sms","smt","smu","smv","smw","smx","smy","smz","sn","snc","sne","snf","sng","sni","snj","snk","snl","snm","snn","sno","snp","snq","snr","sns","snu","snv","snw","snx","sny","snz","so","soa","sob","soc","sod","soe","sog","soh","soi","soj","sok","sol","son","soo","sop","soq","sor","sos","sou","sov","sow","sox","soy","soz","spb","spc","spd","spe","spg","spi","spk","spl","spm","spn","spo","spp","spq","spr","sps","spt","spu","spv","spx","spy","sq","sqa","sqh","sqj","sqk","sqm","sqn","sqo","sqq","sqr","sqs","sqt","squ","sqx","sr","sra","srb","src","sre","srf","srg","srh","sri","srk","srl","srm","srn","sro","srq","srr","srs","srt","sru","srv","srw","srx","sry","srz","ss","ssa","ssb","ssc","ssd","sse","ssf","ssg","ssh","ssi","ssj","ssk","ssl","ssm","ssn","sso","ssp","ssq","ssr","sss","sst","ssu","ssv","ssx","ssy","ssz","st","sta","stb","std","ste","stf","stg","sth","sti","stj","stk","stl","stm","stn","sto","stp","stq","str","sts","stt","stu","stv","stw","sty","su","sua","sub","suc","sue","sug","sui","suj","suk","suo","suq","sur","sus","sut","suv","suw","sux","suy","suz","sv","sva","svb","svc","sve","svk","svm","svs","svx","sw","swb","swc","swf","swg","swh","swi","swj","swk","swl","swm","swn","swo","swp","swq","swr","sws","swt","swu","swv","sww","swx","swy","sxb","sxc","sxe","sxg","sxk","sxl","sxm","sxn","sxo","sxr","sxs","sxu","sxw","sya","syb","syc","syd","syi","syk","syl","sym","syn","syo","syr","sys","syw","syx","syy","sza","szb","szc","sze","szg","szl","szn","szp","szs","szv","szw","szy","ta","taa","tab","tac","tad","tae","taf","tag","tai","taj","tak","tal","tan","tao","tap","taq","tar","tas","tau","tav","taw","tax","tay","taz","tba","tbc","tbd","tbe","tbf","tbg","tbh","tbi","tbj","tbk","tbl","tbm","tbn","tbo","tbp","tbq","tbr","tbs","tbt","tbu","tbv","tbw","tbx","tby","tbz","tca","tcb","tcc","tcd","tce","tcf","tcg","tch","tci","tck","tcl","tcm","tcn","tco","tcp","tcq","tcs","tct","tcu","tcw","tcx","tcy","tcz","tda","tdb","tdc","tdd","tde","tdf","tdg","tdh","tdi","tdj","tdk","tdl","tdm","tdn","tdo","tdq","tdr","tds","tdt","tdv","tdx","tdy","te","tea","teb","tec","ted","tee","tef","teg","teh","tei","tek","tem","ten","teo","tep","teq","ter","tes","tet","teu","tev","tew","tex","tey","tez","tfi","tfn","tfo","tfr","tft","tg","tga","tgb","tgc","tgd","tge","tgf","tgh","tgi","tgj","tgn","tgo","tgp","tgq","tgr","tgs","tgt","tgu","tgv","tgw","tgx","tgy","tgz","th","thd","the","thf","thh","thi","thk","thl","thm","thn","thp","thq","thr","ths","tht","thu","thv","thy","thz","ti","tia","tic","tif","tig","tih","tii","tij","tik","til","tim","tin","tio","tip","tiq","tis","tit","tiu","tiv","tiw","tix","tiy","tiz","tja","tjg","tji","tjj","tjl","tjm","tjn","tjo","tjp","tjs","tju","tjw","tk","tka","tkb","tkd","tke","tkf","tkg","tkl","tkm","tkn","tkp","tkq","tkr","tks","tkt","tku","tkv","tkw","tkx","tkz","tl","tla","tlb","tlc","tld","tlf","tlg","tlh","tli","tlj","tlk","tll","tlm","tln","tlo","tlp","tlq","tlr","tls","tlt","tlu","tlv","tlx","tly","tma","tmb","tmc","tmd","tme","tmf","tmg","tmh","tmi","tmj","tml","tmm","tmn","tmo","tmq","tmr","tms","tmt","tmu","tmv","tmw","tmy","tmz","tn","tna","tnb","tnc","tnd","tng","tnh","tni","tnk","tnl","tnm","tnn","tno","tnp","tnq","tnr","tns","tnt","tnu","tnv","tnw","tnx","tny","tnz","to","tob","toc","tod","tof","tog","toh","toi","toj","tok","tol","tom","too","top","toq","tor","tos","tou","tov","tow","tox","toy","toz","tpa","tpc","tpe","tpf","tpg","tpi","tpj","tpk","tpl","tpm","tpn","tpo","tpp","tpq","tpr","tpt","tpu","tpv","tpx","tpy","tpz","tqb","tql","tqm","tqn","tqo","tqp","tqq","tqr","tqt","tqu","tqw","tr","tra","trb","trc","trd","tre","trf","trg","trh","tri","trj","trk","trl","trm","trn","tro","trp","trq","trr","trs","trt","tru","trv","trw","trx","try","trz","ts","tsa","tsb","tsc","tsd","tse","tsg","tsh","tsi","tsj","tsk","tsl","tsm","tsp","tsq","tsr","tss","tst","tsu","tsv","tsw","tsx","tsy","tsz","tt","tta","ttb","ttc","ttd","tte","ttf","ttg","tth","tti","ttj","ttk","ttl","ttm","ttn","tto","ttp","ttq","ttr","tts","ttt","ttu","ttv","ttw","tty","ttz","tua","tub","tuc","tud","tue","tuf","tug","tuh","tui","tuj","tul","tum","tun","tuo","tup","tuq","tus","tut","tuu","tuv","tuw","tux","tuy","tuz","tva","tvd","tve","tvg","tvi","tvk","tvl","tvm","tvn","tvo","tvs","tvt","tvu","tvw","tvx","tvy","tw","twa","twb","twc","twd","twe","twf","twg","twh","twl","twm","twn","two","twp","twq","twr","twt","twu","tww","twx","twy","txa","txb","txc","txe","txg","txh","txi","txj","txm","txn","txo","txq","txr","txs","txt","txu","txx","txy","ty","tya","tye","tyh","tyi","tyj","tyl","tyn","typ","tyr","tys","tyt","tyu","tyv","tyx","tyy","tyz","tza","tzh","tzj","tzl","tzm","tzn","tzo","tzx","uam","uan","uar","uba","ubi","ubl","ubr","ubu","uby","uda","ude","udg","udi","udj","udl","udm","udu","ues","ufi","ug","uga","ugb","uge","ugh","ugn","ugo","ugy","uha","uhn","uis","uiv","uji","uk","uka","ukg","ukh","uki","ukk","ukl","ukp","ukq","uks","uku","ukv","ukw","uky","ula","ulb","ulc","ule","ulf","uli","ulk","ull","ulm","uln","ulu","ulw","uly","uma","umb","umc","umd","umg","umi","umm","umn","umo","ump","umr","ums","umu","una","und","une","ung","uni","unk","unm","unn","unr","unu","unx","unz","uon","upi","upv","ur","ura","urb","urc","ure","urf","urg","urh","uri","urj","urk","url","urm","urn","uro","urp","urr","urt","uru","urv","urw","urx","ury","urz","usa","ush","usi","usk","usp","uss","usu","uta","ute","uth","utp","utr","utu","uum","uur","uuu","uve","uvh","uvl","uwa","uya","uz","uzn","uzs","vaa","vae","vaf","vag","vah","vai","vaj","val","vam","van","vao","vap","var","vas","vau","vav","vay","vbb","vbk","ve","vec","ved","vel","vem","veo","vep","ver","vgr","vgt","vi","vic","vid","vif","vig","vil","vin","vis","vit","viv","vjk","vka","vkj","vkk","vkl","vkm","vkn","vko","vkp","vkt","vku","vkz","vlp","vls","vma","vmb","vmc","vmd","vme","vmf","vmg","vmh","vmi","vmj","vmk","vml","vmm","vmp","vmq","vmr","vms","vmu","vmv","vmw","vmx","vmy","vmz","vnk","vnm","vnp","vo","vor","vot","vra","vro","vrs","vrt","vsi","vsl","vsn","vsv","vto","vum","vun","vut","vwa","wa","waa","wab","wac","wad","wae","waf","wag","wah","wai","waj","wak","wal","wam","wan","wao","wap","waq","war","was","wat","wau","wav","waw","wax","way","waz","wba","wbb","wbe","wbf","wbh","wbi","wbj","wbk","wbl","wbm","wbp","wbq","wbr","wbs","wbt","wbv","wbw","wca","wci","wdd","wdg","wdj","wdk","wdt","wdu","wdy","wea","wec","wed","weg","weh","wei","wem","wen","weo","wep","wer","wes","wet","weu","wew","wfg","wga","wgb","wgg","wgi","wgo","wgu","wgy","wha","whg","whk","whu","wib","wic","wie","wif","wig","wih","wii","wij","wik","wil","wim","win","wir","wiu","wiv","wiy","wja","wji","wka","wkb","wkd","wkl","wkr","wku","wkw","wky","wla","wlc","wle","wlg","wlh","wli","wlk","wll","wlm","wlo","wlr","wls","wlu","wlv","wlw","wlx","wly","wma","wmb","wmc","wmd","wme","wmg","wmh","wmi","wmm","wmn","wmo","wms","wmt","wmw","wmx","wnb","wnc","wnd","wne","wng","wni","wnk","wnm","wnn","wno","wnp","wnu","wnw","wny","wo","woa","wob","woc","wod","woe","wof","wog","woi","wok","wom","won","woo","wor","wos","wow","woy","wpc","wrb","wrg","wrh","wri","wrk","wrl","wrm","wrn","wro","wrp","wrr","wrs","wru","wrv","wrw","wrx","wry","wrz","wsa","wsg","wsi","wsk","wsr","wss","wsu","wsv","wtb","wtf","wth","wti","wtk","wtm","wtw","wua","wub","wud","wuh","wul","wum","wun","wur","wut","wuu","wuv","wux","wuy","wwa","wwb","wwo","wwr","www","wxa","wxw","wyb","wyi","wym","wyn","wyr","wyy","xaa","xab","xac","xad","xae","xag","xai","xaj","xak","xal","xam","xan","xao","xap","xaq","xar","xas","xat","xau","xav","xaw","xay","xbb","xbc","xbd","xbe","xbg","xbi","xbj","xbm","xbn","xbo","xbp","xbr","xbw","xby","xcb","xcc","xce","xcg","xch","xcl","xcm","xcn","xco","xcr","xct","xcu","xcv","xcw","xcy","xda","xdc","xdk","xdm","xdo","xdq","xdy","xeb","xed","xeg","xel","xem","xep","xer","xes","xet","xeu","xfa","xga","xgb","xgd","xgf","xgg","xgi","xgl","xgm","xgn","xgr","xgu","xgw","xh","xha","xhc","xhd","xhe","xhm","xhr","xht","xhu","xhv","xib","xii","xil","xin","xir","xis","xiv","xiy","xjb","xjt","xka","xkb","xkc","xkd","xke","xkf","xkg","xki","xkj","xkk","xkl","xkn","xko","xkp","xkq","xkr","xks","xkt","xku","xkv","xkw","xkx","xky","xkz","xla","xlb","xlc","xld","xle","xlg","xli","xln","xlo","xlp","xls","xlu","xly","xma","xmb","xmc","xmd","xme","xmf","xmg","xmh","xmj","xmk","xml","xmm","xmn","xmo","xmp","xmq","xmr","xms","xmt","xmu","xmv","xmw","xmx","xmy","xmz","xna","xnb","xnd","xng","xnh","xni","xnj","xnk","xnm","xnn","xno","xnq","xnr","xns","xnt","xnu","xny","xnz","xoc","xod","xog","xoi","xok","xom","xon","xoo","xop","xor","xow","xpa","xpb","xpc","xpd","xpe","xpf","xpg","xph","xpi","xpj","xpk","xpl","xpm","xpn","xpo","xpp","xpq","xpr","xps","xpt","xpu","xpv","xpw","xpx","xpy","xpz","xqa","xqt","xra","xrb","xrd","xre","xrg","xri","xrm","xrn","xrr","xrt","xru","xrw","xsa","xsb","xsc","xsd","xse","xsh","xsi","xsj","xsl","xsm","xsn","xso","xsp","xsq","xsr","xsu","xsv","xsy","xta","xtb","xtc","xtd","xte","xtg","xth","xti","xtj","xtl","xtm","xtn","xto","xtp","xtq","xtr","xts","xtt","xtu","xtv","xtw","xty","xua","xub","xud","xug","xuj","xul","xum","xun","xuo","xup","xur","xut","xuu","xve","xvi","xvn","xvo","xvs","xwa","xwc","xwd","xwe","xwg","xwj","xwk","xwl","xwo","xwr","xwt","xww","xxb","xxk","xxm","xxr","xxt","xya","xyb","xyj","xyk","xyl","xyt","xyy","xzh","xzm","xzp","yaa","yab","yac","yad","yae","yaf","yag","yah","yai","yaj","yak","yal","yam","yan","yao","yap","yaq","yar","yas","yat","yau","yav","yaw","yax","yay","yaz","yba","ybb","ybe","ybh","ybi","ybj","ybk","ybl","ybm","ybn","ybo","ybx","yby","ych","ycl","ycn","ycp","ycr","yda","ydd","yde","ydg","ydk","yea","yec","yee","yei","yej","yel","yer","yes","yet","yeu","yev","yey","yga","ygi","ygl","ygm","ygp","ygr","ygs","ygu","ygw","yha","yhd","yhl","yhs","yi","yia","yif","yig","yih","yii","yij","yik","yil","yim","yin","yip","yiq","yir","yis","yit","yiu","yiv","yix","yiz","yka","ykg","ykh","yki","ykk","ykl","ykm","ykn","yko","ykr","ykt","yku","yky","yla","ylb","yle","ylg","yli","yll","ylm","yln","ylo","ylr","ylu","yly","ymb","ymc","ymd","yme","ymg","ymh","ymi","ymk","yml","ymm","ymn","ymo","ymp","ymq","ymr","yms","ymx","ymz","yna","ynb","ynd","yne","yng","ynk","ynl","ynn","yno","ynq","yns","ynu","yo","yob","yog","yoi","yok","yom","yon","yot","yox","yoy","ypa","ypb","ypg","yph","ypk","ypm","ypn","ypo","ypp","ypz","yra","yrb","yre","yrk","yrl","yrm","yrn","yro","yrs","yrw","yry","ysc","ysd","ysg","ysl","ysm","ysn","yso","ysp","ysr","yss","ysy","yta","ytl","ytp","ytw","yty","yua","yub","yuc","yud","yue","yuf","yug","yui","yuj","yuk","yul","yum","yun","yup","yuq","yur","yut","yuw","yux","yuy","yuz","yva","yvt","ywa","ywg","ywl","ywn","ywq","ywr","ywt","ywu","yww","yxa","yxg","yxl","yxm","yxu","yxy","yyr","yyu","yyz","yzg","yzk","za","zaa","zab","zac","zad","zae","zaf","zag","zah","zai","zaj","zak","zal","zam","zao","zap","zaq","zar","zas","zat","zau","zav","zaw","zax","zay","zaz","zba","zbc","zbe","zbl","zbt","zbu","zbw","zca","zcd","zch","zdj","zea","zeg","zeh","zem","zen","zga","zgb","zgh","zgm","zgn","zgr","zh","zhb","zhd","zhi","zhk","zhn","zhw","zhx","zia","zib","zik","zil","zim","zin","ziw","ziz","zka","zkd","zkg","zkh","zkk","zkn","zko","zkp","zkr","zkt","zku","zkv","zkz","zla","zle","zlj","zlm","zln","zlq","zls","zlu","zlw","zma","zmb","zmc","zmd","zme","zmf","zmg","zmh","zmi","zmj","zmk","zml","zmm","zmn","zmo","zmp","zmq","zmr","zms","zmt","zmu","zmv","zmw","zmx","zmy","zmz","zna","znd","zne","zng","znk","zns","zoc","zoh","zom","zoo","zoq","zor","zos","zpa","zpb","zpc","zpd","zpe","zpf","zpg","zph","zpi","zpj","zpk","zpl","zpm","zpn","zpo","zpp","zpq","zpr","zps","zpt","zpu","zpv","zpw","zpx","zpy","zpz","zqe","zra","zrg","zrn","zro","zrp","zrs","zsa","zsk","zsl","zsm","zsr","zsu","zte","ztg","ztl","ztm","ztn","ztp","ztq","zts","ztt","ztu","ztx","zty","zu","zuh","zum","zun","zuy","zwa","zxx","zyb","zyg","zyj","zyn","zyp","zza","zzj"],
        minLen: 2,
        maxLen: 3,
    }),
    /** Legal Entity ID — 20 capital letters and digits. A Legal Entity Identifier: organizations in financial and regulatory contexts. Identity, not routing - prefer bic for payment routing. */
    "lei": new Scalar<string>({
        name: "lei",
        label: "Legal Entity ID",
        hint: "20 capital letters and digits",
        error: "Please check the ID: 20 capital letters and digits, like 5493001KJTIIGC8Y1R12.",
        details: "A Legal Entity Identifier: organizations in financial and regulatory contexts. Identity, not routing - prefer bic for payment routing.",
        level: "domain",
        primitive: "string",
        aliases: ["legal_entity_identifier"],
        examples: { valid: ["5493001KJTIIGC8Y1R12","529900T8BM49AURSDO55"], invalid: ["5493001KJTIIGC8Y1R1","5493001kjtiigc8y1r12"] },
        kind: "text",
        pattern: "^[A-Z0-9]{18}[0-9]{2}$",
        check: "iso7064_mod97_10",
        minLen: 20,
        maxLen: 20,
    }),
    /** Language and region — Like en-US or es-419. A BCP 47 language tag (en, en-US): a language with optional script and region, for formatting, translations, and user preferences. */
    "locale": new Scalar<string>({
        name: "locale",
        label: "Language and region",
        hint: "Like en-US or es-419",
        error: "Please use a language code, like en-US.",
        details: "A BCP 47 language tag (en, en-US): a language with optional script and region, for formatting, translations, and user preferences.",
        level: "core",
        primitive: "string",
        aliases: ["language_tag","lang"],
        examples: { valid: ["en-US","en","zh-Hant-TW","es-419"], invalid: ["english","en_US"] },
        kind: "text",
        pattern: "^[a-zA-Z]{2,3}(-[a-zA-Z]{4})?(-([a-zA-Z]{2}|[0-9]{3}))?$",
        minLen: 2,
        maxLen: 12,
    }),
    /** Hardware address — Six pairs of hex digits. An EUI-48 hardware address: device inventory, DHCP leases. Never an identity for people or accounts - MACs are spoofable and privacy-sensitive. */
    "mac_address": new Scalar<string>({
        name: "mac_address",
        label: "Hardware address",
        hint: "Six pairs of hex digits",
        error: "Please use six hex pairs with : or -, like 00:1b:44:11:3a:b7.",
        details: "An EUI-48 hardware address: device inventory, DHCP leases. Never an identity for people or accounts - MACs are spoofable and privacy-sensitive.",
        level: "advanced",
        primitive: "string",
        aliases: ["mac","mac_addr"],
        examples: { valid: ["00:1b:44:11:3a:b7","00-1B-44-11-3A-B7"], invalid: ["00:1b:44:11:3a","00:1b:44:11:3a:zz"] },
        kind: "text",
        pattern: "^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$",
        minLen: 17,
        maxLen: 17,
    }),
    /** File type — What kind of file, like application/json. A concrete media type like application/json: labeling stored content. */
    "media_type": new Scalar<string>({
        name: "media_type",
        label: "File type",
        hint: "What kind of file, like application/json",
        error: "Please write kind/subkind, like application/json.",
        details: "A concrete media type like application/json: labeling stored content.",
        level: "core",
        primitive: "string",
        aliases: ["mime_type","content_type"],
        examples: { valid: ["application/json","text/html; charset=utf-8","image/svg+xml"], invalid: ["json","application/"] },
        kind: "text",
        pattern: "^[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+(;[^\\x00-\\x1F\\x7F]*)?$",
        minLen: 3,
    }),
    /** Group of fields — Named values kept together. A nested JSON object: structured payloads, settings blobs, documents. Prefer dedicated fields or columns once the shape is stable enough to query. */
    "object": new Scalar<Record<string, unknown>>({
        name: "object",
        label: "Group of fields",
        hint: "Named values kept together",
        error: "Please give named values, like a small card of facts.",
        details: "A nested JSON object: structured payloads, settings blobs, documents. Prefer dedicated fields or columns once the shape is stable enough to query.",
        level: "core",
        primitive: "object",
        aliases: ["map","dict","record"],
        examples: { valid: [{"key":"value"},{}], invalid: [[1,2]] },
        kind: "object",
    }),
    /** ORCID iD — Four groups of four digits. An ORCID iD identifying a researcher. Prefer lei for organizations and wikidata_qid for entities outside scholarly identity. */
    "orcid": new Scalar<string>({
        name: "orcid",
        label: "ORCID iD",
        hint: "Four groups of four digits",
        error: "Please check the iD: four groups of 4 with dashes, like 0000-0002-1825-0097.",
        details: "An ORCID iD identifying a researcher. Prefer lei for organizations and wikidata_qid for entities outside scholarly identity.",
        level: "domain",
        primitive: "string",
        aliases: ["orcid_id"],
        examples: { valid: ["0000-0002-1825-0097","0000-0002-9079-593X"], invalid: ["0000-0002-1825-009","0000000218250097"] },
        kind: "text",
        pattern: "^[0-9]{4}-[0-9]{4}-[0-9]{4}-[0-9]{3}[0-9X]$",
        check: "iso7064_mod11_2",
        minLen: 19,
        maxLen: 19,
    }),
    /** Phone number — Start with + and your country code. An E.164 phone number (+country code, digits only): dialing and SMS. Store normalized; display formatting is presentation, not data. */
    "phone": new Scalar<string>({
        name: "phone",
        label: "Phone number",
        hint: "Start with + and your country code",
        error: "Start with + and the country code, no spaces, like +14155552671.",
        details: "An E.164 phone number (+country code, digits only): dialing and SMS. Store normalized; display formatting is presentation, not data.",
        level: "core",
        primitive: "string",
        aliases: ["tel","telephone","mobile","phone_number"],
        examples: { valid: ["+14155552671","+442071838750"], invalid: ["4155552671","+1 415 555 2671"] },
        kind: "text",
        steps: ["trim","remove_spaces","remove_hyphens"],
        pattern: "^\\+[1-9][0-9]{1,14}$",
        minLen: 3,
        maxLen: 16,
    }),
    /** Port number — From 0 to 65535, like 5432. A TCP/UDP port number (0..65535): service endpoints and configuration. Prefer uint16 for 16-bit values that are not ports. */
    "port": new Scalar<number>({
        name: "port",
        label: "Port number",
        hint: "From 0 to 65535, like 5432",
        error: "Please use a whole number from 0 to 65535.",
        details: "A TCP/UDP port number (0..65535): service endpoints and configuration. Prefer uint16 for 16-bit values that are not ports.",
        level: "advanced",
        primitive: "int32",
        aliases: ["port_number"],
        examples: { valid: [5432,0,65535], invalid: [65536,-1] },
        kind: "integer",
        minimum: 0,
        maximum: 65535,
    }),
    /** Text pattern — A regular expression, like ^[a-z]+$. An ECMA-262 regular expression source: validation rules and matchers stored as data. Prefer enum when the acceptable values are simply a closed set. */
    "regex": new Scalar<string>({
        name: "regex",
        label: "Text pattern",
        hint: "A regular expression, like ^[a-z]+$",
        error: "That regular expression looks wrong. Try ^[a-z]+$.",
        details: "An ECMA-262 regular expression source: validation rules and matchers stored as data. Prefer enum when the acceptable values are simply a closed set.",
        level: "advanced",
        primitive: "string",
        aliases: ["regexp","regular_expression"],
        examples: { valid: ["^[a-z][a-z0-9_]*$","\\d+"], invalid: [] },
        kind: "text",
    }),
    /** Secret — Kept hidden, like a password. Sensitive text that must never be displayed or logged: passwords, API keys. The format is a masking hint, not protection - hash or encrypt at rest. */
    "secret": new Scalar<string>({
        name: "secret",
        label: "Secret",
        hint: "Kept hidden, like a password",
        error: "Please type the secret.",
        details: "Sensitive text that must never be displayed or logged: passwords, API keys. The format is a masking hint, not protection - hash or encrypt at rest.",
        level: "core",
        primitive: "string",
        aliases: ["password","api_key"],
        examples: { valid: ["••••••••","correct horse battery staple"], invalid: [] },
        kind: "text",
    }),
    /** Version number — Major.minor.patch, like 1.4.2. A Semantic Version (1.4.2-rc.1): package and API versions with defined precedence. Prefer string for version-ish labels that do not follow SemVer. */
    "semver": new Scalar<string>({
        name: "semver",
        label: "Version number",
        hint: "Major.minor.patch, like 1.4.2",
        error: "Please use three numbers with dots, like 1.4.2-rc.1.",
        details: "A Semantic Version (1.4.2-rc.1): package and API versions with defined precedence. Prefer string for version-ish labels that do not follow SemVer.",
        level: "advanced",
        primitive: "string",
        aliases: ["version","semantic_version"],
        examples: { valid: ["1.4.2-rc.1","0.0.1","2.0.0+build.5"], invalid: ["1.4","01.4.2"] },
        kind: "text",
        pattern: "^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(?:-((?:0|[1-9][0-9]*|[0-9]*[a-zA-Z-][0-9a-zA-Z-]*)(?:\\.(?:0|[1-9][0-9]*|[0-9]*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\\+([0-9a-zA-Z-]+(?:\\.[0-9a-zA-Z-]+)*))?$",
        minLen: 5,
    }),
    /** SHA-256 hash — 64 hex characters. A SHA-256 digest: content addressing, integrity checks, dedup keys. Never for passwords - those take a dedicated password hash stored as secret. */
    "sha256": new Scalar<string>({
        name: "sha256",
        label: "SHA-256 hash",
        hint: "64 hex characters",
        error: "Needs 64 hex characters, like e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855.",
        details: "A SHA-256 digest: content addressing, integrity checks, dedup keys. Never for passwords - those take a dedicated password hash stored as secret.",
        level: "advanced",
        primitive: "string",
        aliases: ["hash","digest"],
        examples: { valid: ["e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855"], invalid: ["e3b0","zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"] },
        kind: "text",
        pattern: "^[A-Fa-f0-9]{64}$",
        minLen: 64,
        maxLen: 64,
    }),
    /** Web address name — Small letters, digits and dashes. A lowercase-hyphen URL token (getting-started): readable path segments derived from a title. Presentation identity only - prefer uuid as the real key. */
    "slug": new Scalar<string>({
        name: "slug",
        label: "Web address name",
        hint: "Small letters, digits and dashes",
        error: "Use small letters, digits and single dashes, like getting-started.",
        details: "A lowercase-hyphen URL token (getting-started): readable path segments derived from a title. Presentation identity only - prefer uuid as the real key.",
        level: "core",
        primitive: "string",
        aliases: ["permalink","url_name"],
        examples: { valid: ["getting-started","a","v2-release-notes"], invalid: ["Getting-Started","getting--started"] },
        kind: "text",
        steps: ["trim","lowercase"],
        pattern: "^[a-z0-9]+(-[a-z0-9]+)*$",
        minLen: 1,
    }),
    /** Short text — A few words, like a name or a title. Single-line text where a length bound is meaningful: names, titles, labels. Prefer text when there is no maximum, and enum when the values form a closed set. */
    "string": new Scalar<string>({
        name: "string",
        label: "Short text",
        hint: "A few words, like a name or a title",
        error: "Please type some text.",
        details: "Single-line text where a length bound is meaningful: names, titles, labels. Prefer text when there is no maximum, and enum when the values form a closed set.",
        level: "core",
        primitive: "string",
        aliases: ["short_text","varchar"],
        examples: { valid: ["hello","Ada Lovelace"], invalid: [42,null] },
        kind: "text",
        params: ["length"],
    }),
    /** State or region — Country, dash, region, like US-CA. An ISO 3166-2 subdivision code (US-CA): states, provinces, regions. Carries its country prefix, so no separate country field is needed to interpret it. */
    "subdivision": new Scalar<string>({
        name: "subdivision",
        label: "State or region",
        hint: "Country, dash, region, like US-CA",
        error: "Please use country-region, like US-CA.",
        details: "An ISO 3166-2 subdivision code (US-CA): states, provinces, regions. Carries its country prefix, so no separate country field is needed to interpret it.",
        level: "advanced",
        primitive: "string",
        aliases: ["region","state","province"],
        examples: { valid: ["US-CA","GB-ENG","FR-75C"], invalid: ["US_CA","US-"] },
        kind: "text",
        steps: ["trim","uppercase"],
        pattern: "^[A-Z]{2}-[A-Z0-9]{1,3}$",
        minLen: 4,
        maxLen: 6,
    }),
    /** Long text — As many lines as you need. Unbounded prose: article bodies, comments, logs. Prefer string when a length limit is part of the contract. */
    "text": new Scalar<string>({
        name: "text",
        label: "Long text",
        hint: "As many lines as you need",
        error: "Please type some text.",
        details: "Unbounded prose: article bodies, comments, logs. Prefer string when a length limit is part of the contract.",
        level: "core",
        primitive: "text",
        aliases: ["long_text","paragraph"],
        examples: { valid: ["unbounded multi-line body","Line one\nLine two"], invalid: [["not","text"]] },
        kind: "text",
    }),
    /** Time with offset — Like 14:30:00Z or 14:30:00+02:00. A wall-clock time with an explicit UTC offset. Prefer time_local for schedules that float with the local zone. */
    "time": new Scalar<string>({
        name: "time",
        label: "Time with offset",
        hint: "Like 14:30:00Z or 14:30:00+02:00",
        error: "Please add the zone offset, like 14:30:00Z.",
        details: "A wall-clock time with an explicit UTC offset. Prefer time_local for schedules that float with the local zone.",
        level: "advanced",
        primitive: "time_local",
        aliases: ["timetz","offset_time"],
        examples: { valid: ["14:30:00Z","09:05:30.250+05:30"], invalid: ["14:30:00","2:30 PM"] },
        kind: "text",
        params: ["fractional_seconds"],
        pattern: "^[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?([Zz]|[+-][0-9]{2}:[0-9]{2})$",
        minLen: 9,
    }),
    /** Time of day — Hours:minutes:seconds, like 14:30:00. A wall-clock time with no offset: daily schedules like 'every day at 14:30' that follow whatever zone applies. Pair with timezone when the zone is fixed. */
    "time_local": new Scalar<string>({
        name: "time_local",
        label: "Time of day",
        hint: "Hours:minutes:seconds, like 14:30:00",
        error: "Please use hours:minutes:seconds, like 14:30:00.",
        details: "A wall-clock time with no offset: daily schedules like 'every day at 14:30' that follow whatever zone applies. Pair with timezone when the zone is fixed.",
        level: "core",
        primitive: "time_local",
        aliases: ["time_of_day","local_time"],
        examples: { valid: ["14:30:00","09:05:30.250"], invalid: ["14:30","14:30:00Z"] },
        kind: "text",
        params: ["fractional_seconds"],
        pattern: "^[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?$",
        minLen: 8,
    }),
    /** Time zone — A region and city, like America/New_York. An IANA zone name like America/New_York: user preferences and scheduling context. Store the name, never a raw offset - offsets change with DST and law. */
    "timezone": new Scalar<string>({
        name: "timezone",
        label: "Time zone",
        hint: "A region and city, like America/New_York",
        error: "Please pick a time zone, like America/New_York.",
        details: "An IANA zone name like America/New_York: user preferences and scheduling context. Store the name, never a raw offset - offsets change with DST and law.",
        level: "core",
        primitive: "string",
        aliases: ["tz","time_zone"],
        examples: { valid: ["America/New_York","UTC","America/Argentina/Buenos_Aires"], invalid: ["New York","America/New York"] },
        kind: "text",
        pattern: "^(UTC|[A-Za-z_]+/[A-Za-z0-9_+-]+(/[A-Za-z0-9_+-]+)?)$",
        minLen: 3,
    }),
    /** Small count — From 0 to 65535. Unsigned 16-bit integers (0..65535). Prefer port for network ports specifically, and int32 when a negative value could ever appear. */
    "uint16": new Scalar<number>({
        name: "uint16",
        label: "Small count",
        hint: "From 0 to 65535",
        error: "Please use a whole number from 0 to 65535.",
        details: "Unsigned 16-bit integers (0..65535). Prefer port for network ports specifically, and int32 when a negative value could ever appear.",
        level: "advanced",
        primitive: "int32",
        aliases: ["ushort"],
        examples: { valid: [8080,65535], invalid: [65536,-1] },
        kind: "integer",
        minimum: 0,
        maximum: 65535,
    }),
    /** Count — From 0 to 4294967295. Unsigned 32-bit integers: large counters and IDs from systems that use them. Prefer int64 in new designs; signed types survive arithmetic and language boundaries better. */
    "uint32": new Scalar<number>({
        name: "uint32",
        label: "Count",
        hint: "From 0 to 4294967295",
        error: "Please use a whole number from 0 to 4294967295.",
        details: "Unsigned 32-bit integers: large counters and IDs from systems that use them. Prefer int64 in new designs; signed types survive arithmetic and language boundaries better.",
        level: "advanced",
        primitive: "int32",
        aliases: ["uint","unsigned"],
        examples: { valid: [3000000000,4294967295], invalid: [4294967296,-1] },
        kind: "integer",
        minimum: 0,
        maximum: 4294967295,
    }),
    /** Huge count — Digits only, no minus sign. The full unsigned 64-bit range: hashes and foreign systems' identifiers. Most languages and JSON cannot represent the upper half natively, so values travel as strings; prefer int64 unless the source really uses all 64 bits. */
    "uint64": new Scalar<string>({
        name: "uint64",
        label: "Huge count",
        hint: "Digits only, no minus sign",
        error: "Please use only digits, up to 18446744073709551615.",
        details: "The full unsigned 64-bit range: hashes and foreign systems' identifiers. Most languages and JSON cannot represent the upper half natively, so values travel as strings; prefer int64 unless the source really uses all 64 bits.",
        level: "advanced",
        primitive: "int64",
        aliases: ["ulong"],
        examples: { valid: ["18446744073709551615","0"], invalid: ["-1","1.5"] },
        kind: "text",
        params: ["precision","scale"],
        pattern: "^[0-9]+$",
        check: "uint64_range",
        minLen: 1,
    }),
    /** Tiny count — From 0 to 255. Unsigned bytes (0..255): color channels, small numeric codes. Prefer int32 unless the byte range is intrinsic to the data. */
    "uint8": new Scalar<number>({
        name: "uint8",
        label: "Tiny count",
        hint: "From 0 to 255",
        error: "Please use a whole number from 0 to 255.",
        details: "Unsigned bytes (0..255): color channels, small numeric codes. Prefer int32 unless the byte range is intrinsic to the data.",
        level: "advanced",
        primitive: "int32",
        aliases: ["ubyte"],
        examples: { valid: [200,0,255], invalid: [256,-1] },
        kind: "integer",
        minimum: 0,
        maximum: 255,
    }),
    /** Sortable ID — 26 letters and digits. A lexically sortable 128-bit ID in Crockford Base32: time-ordered keys that stay readable as text. Prefer uuid_v7 where native UUID column types and tooling matter. */
    "ulid": new Scalar<string>({
        name: "ulid",
        label: "Sortable ID",
        hint: "26 letters and digits",
        error: "Please use 26 letters and digits, like 01ARZ3NDEKTSV4RRFFQ69G5FAV.",
        details: "A lexically sortable 128-bit ID in Crockford Base32: time-ordered keys that stay readable as text. Prefer uuid_v7 where native UUID column types and tooling matter.",
        level: "advanced",
        primitive: "string",
        aliases: ["sortable_id"],
        examples: { valid: ["01ARZ3NDEKTSV4RRFFQ69G5FAV","7ZZZZZZZZZZZZZZZZZZZZZZZZZ"], invalid: ["01ARZ3NDEKTSV4RRFFQ69G5FA","81ARZ3NDEKTSV4RRFFQ69G5FAV","01ARZ3NDEKTSV4RRFFQ69G5FAI"] },
        kind: "text",
        pattern: "^[0-7][0-9A-HJKMNP-TV-Z]{25}$",
        minLen: 26,
        maxLen: 26,
    }),
    /** Unix timestamp — Seconds since 1970-01-01. Seconds since the Unix epoch as an integer: compact machine timestamps and TTLs. Prefer date_time for anything humans or APIs read directly. */
    "unix_time": new Scalar<number>({
        name: "unix_time",
        label: "Unix timestamp",
        hint: "Seconds since 1970-01-01",
        error: "Please use whole seconds since 1970, like 1786000000.",
        details: "Seconds since the Unix epoch as an integer: compact machine timestamps and TTLs. Prefer date_time for anything humans or APIs read directly.",
        level: "advanced",
        primitive: "int32",
        aliases: ["epoch","epoch_seconds"],
        examples: { valid: [1786000000,0,-86400], invalid: [9007199254740992,1.5] },
        kind: "integer",
        minimum: -9007199254740991,
        maximum: 9007199254740991,
    }),
    /** Web link — Like https://example.com/page. An absolute URI with scheme: links, webhooks, resource locators. International text is percent-encoded and the host is punycode. Prefer uri_reference for relative paths. */
    "uri": new Scalar<string>({
        name: "uri",
        label: "Web link",
        hint: "Like https://example.com/page",
        error: "That link looks wrong. Try https://example.com/page.",
        details: "An absolute URI with scheme: links, webhooks, resource locators. International text is percent-encoded and the host is punycode. Prefer uri_reference for relative paths.",
        level: "core",
        primitive: "string",
        aliases: ["url","link","website"],
        examples: { valid: ["https://example.com/a/b?c=1","mailto:user@example.com","urn:isbn:9780306406157"], invalid: [] },
        kind: "text",
    }),
    /** Link or path — A full link or a path like /a/b. A URI reference, absolute or relative: redirect targets, in-site paths. International text is percent-encoded, as in uri. Prefer uri when an absolute, scheme-carrying value is required. */
    "uri_reference": new Scalar<string>({
        name: "uri_reference",
        label: "Link or path",
        hint: "A full link or a path like /a/b",
        error: "That link or path looks wrong. Try /a/b?c=1.",
        details: "A URI reference, absolute or relative: redirect targets, in-site paths. International text is percent-encoded, as in uri. Prefer uri when an absolute, scheme-carrying value is required.",
        level: "advanced",
        primitive: "string",
        aliases: ["relative_url","href"],
        examples: { valid: ["/a/b?c=1","../up","#fragment"], invalid: [] },
        kind: "text",
    }),
    /** Link template — A link with {placeholders}. An RFC 6570 URL pattern with {variables}: route and link templates. Prefer uri for concrete, already-expanded links. */
    "uri_template": new Scalar<string>({
        name: "uri_template",
        label: "Link template",
        hint: "A link with {placeholders}",
        error: "That template looks wrong. Try /users/{id}.",
        details: "An RFC 6570 URL pattern with {variables}: route and link templates. Prefer uri for concrete, already-expanded links.",
        level: "advanced",
        primitive: "string",
        aliases: ["url_template"],
        examples: { valid: ["/users/{id}{?fields}","https://api.example.com{/version}/items"], invalid: [] },
        kind: "text",
    }),
    /** Unique ID — A long ID with dashes, made by the computer. A 128-bit universal identifier, any version: primary keys and references. Which version to mint (such as time-ordered v7) is a generation option, not a separate type. */
    "uuid": new Scalar<string>({
        name: "uuid",
        label: "Unique ID",
        hint: "A long ID with dashes, made by the computer",
        error: "That ID looks wrong. It should look like f81d4fae-7dec-11d0-a765-00a0c91e6bf6.",
        details: "A 128-bit universal identifier, any version: primary keys and references. Which version to mint (such as time-ordered v7) is a generation option, not a separate type.",
        level: "core",
        primitive: "string",
        aliases: ["guid","unique_id"],
        examples: { valid: ["f81d4fae-7dec-11d0-a765-00a0c91e6bf6","F81D4FAE-7DEC-11D0-A765-00A0C91E6BF6"], invalid: ["f81d4fae7dec11d0a76500a0c91e6bf6","f81d4fae-7dec-11d0-a765-00a0c91e6bfg"] },
        kind: "text",
        steps: ["trim","lowercase"],
        pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
        minLen: 36,
        maxLen: 36,
    }),
    /** Time-ordered ID — A unique ID that sorts by time. A time-ordered UUID: new primary keys that index and sort by creation time. Prefer uuid when accepting identifiers you did not mint. */
    "uuid_v7": new Scalar<string>({
        name: "uuid_v7",
        label: "Time-ordered ID",
        hint: "A unique ID that sorts by time",
        error: "It needs a 7 after the second dash, like 018f4b2c-9c1e-7a3b-8f2d-1a2b3c4d5e6f.",
        details: "A time-ordered UUID: new primary keys that index and sort by creation time. Prefer uuid when accepting identifiers you did not mint.",
        level: "advanced",
        primitive: "string",
        aliases: ["uuidv7"],
        examples: { valid: ["018f4b2c-9c1e-7a3b-8f2d-1a2b3c4d5e6f","018F4B2C-9C1E-7A3B-BF2D-1A2B3C4D5E6F"], invalid: ["f81d4fae-7dec-11d0-a765-00a0c91e6bf6","018f4b2c-9c1e-7a3b-cf2d-1a2b3c4d5e6f"] },
        kind: "text",
        steps: ["trim","lowercase"],
        pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-7[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$",
        minLen: 36,
        maxLen: 36,
    }),
    /** Wikidata ID — Q and a number, like Q42. A Wikidata entity ID (Q42): linking records to globally known entities. Prefer the domain registry when one exists - doi, orcid, lei, isbn. */
    "wikidata_qid": new Scalar<string>({
        name: "wikidata_qid",
        label: "Wikidata ID",
        hint: "Q and a number, like Q42",
        error: "Please use Q and a number, like Q42.",
        details: "A Wikidata entity ID (Q42): linking records to globally known entities. Prefer the domain registry when one exists - doi, orcid, lei, isbn.",
        level: "domain",
        primitive: "string",
        aliases: ["qid"],
        examples: { valid: ["Q42","Q1"], invalid: ["Q0","42"] },
        kind: "text",
        pattern: "^Q[1-9][0-9]*$",
        minLen: 2,
    }),
    /** Find a type by name or alias; spacing, hyphens and case are forgiven. Nothing found gives undefined. */
    get(word: Name | (string & {})): Scalar<unknown> | undefined {
        return find(word, scalars.all);
    },
    /** Loads a models file (parsed JSON, never a path). Returns its Models, or throws ModelsError listing every problem, sorted. */
    models(data: unknown): Models {
        return loadModels(data);
    },
    /** Every type, in catalogue order. */
    get all(): readonly Scalar<unknown>[] {
        return every;
    },
} as const;

const every: readonly Scalar<unknown>[] = [scalars["any"], scalars["array"], scalars["base64"], scalars["base64url"], scalars["bic"], scalars["binary"], scalars["boolean"], scalars["char"], scalars["cidr"], scalars["color"], scalars["commonmark"], scalars["country"], scalars["country_alpha3"], scalars["cron"], scalars["css_color"], scalars["currency"], scalars["date"], scalars["date_time"], scalars["date_time_local"], scalars["decimal"], scalars["decimal128"], scalars["doi"], scalars["duration"], scalars["email"], scalars["enum"], scalars["float32"], scalars["float64"], scalars["gln"], scalars["gtin"], scalars["hostname"], scalars["html"], scalars["iban"], scalars["int16"], scalars["int32"], scalars["int64"], scalars["int8"], scalars["ipv4"], scalars["ipv4_cidr"], scalars["ipv6"], scalars["ipv6_cidr"], scalars["isbn"], scalars["json_pointer"], scalars["jwt"], scalars["language"], scalars["lei"], scalars["locale"], scalars["mac_address"], scalars["media_type"], scalars["object"], scalars["orcid"], scalars["phone"], scalars["port"], scalars["regex"], scalars["secret"], scalars["semver"], scalars["sha256"], scalars["slug"], scalars["string"], scalars["subdivision"], scalars["text"], scalars["time"], scalars["time_local"], scalars["timezone"], scalars["uint16"], scalars["uint32"], scalars["uint64"], scalars["uint8"], scalars["ulid"], scalars["unix_time"], scalars["uri"], scalars["uri_reference"], scalars["uri_template"], scalars["uuid"], scalars["uuid_v7"], scalars["wikidata_qid"]];

export default scalars;
