// Models: a file of domains, models and fields (parsed JSON), loaded once, then payloads checked against a model.
// A port of dev/lib/models.mjs, the reference every engine copies. Load is O(file) and iterative: no recursion is
// driven by the input. Validate recurses, but load bounds a payload's depth at MAX_DEPTH levels.

/** Nesting deeper than this, each model and each `items` one level, is refused at load. */
const MAX_DEPTH = 64;
/** Settings refused on number-kind types: float text differs by language, so digit counts can't agree. */
const DIGIT_SETTINGS: readonly string[] = ["precision", "scale"];

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

/** A problem at `segments`. A code without a template (`invalid`, whose text is the type's `error`) needs `message`. */
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
            // Entries must be strings, unique, and already clean: the type's validate returns each unchanged.
            if (ok) {
                const seen = new Set<string>();
                (value as unknown[]).forEach((entry, i) => {
                    if (typeof entry === "string" && (type as Scalar<unknown>)["run"](entry) === entry && !seen.has(entry)) seen.add(entry);
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

/** One model of a loaded models file: `validate(payload)` and `isValid(payload)`. */
export class Model {
    readonly name: string;
    private readonly fields: ReadonlyMap<string, ModelField>;
    /**
     * [name, field, shadows] in declared order, built once, not per payload. `shadows` marks a name Object.prototype
     * also has (`constructor`): its output key is defined, since a plain assignment would hit the inherited one.
     */
    private readonly entries: readonly (readonly [string, ModelField, boolean])[];
    private readonly root: ModelField; // the payload itself, a value of this model

    constructor(name: string, fields: ReadonlyMap<string, ModelField>) {
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
        if (r === NO) {
            report(problems, seg === undefined ? up : { up, seg }, "invalid", { type: t.name }, t.error);
            return null;
        }
        if (f.limited) {
            const length = f.length;
            if (length !== null && longerThan(r as string, length)) report(problems, seg === undefined ? up : { up, seg }, "too_long", { max: length });
            if (f.allowed !== null && !f.allowed.has(r)) report(problems, seg === undefined ? up : { up, seg }, "not_allowed", { values: [...(f.values as readonly string[])] });
            if (f.precision !== null && !fitsNumeric(r as string, f.precision, f.scale)) {
                report(problems, seg === undefined ? up : { up, seg }, "too_many_digits", { precision: f.precision, scale: f.scale });
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

/** A loaded models file: `get("domain:model")` and `all`, every full name, sorted by code point. */
export class Models {
    readonly all: readonly string[];
    private readonly byName: ReadonlyMap<string, Model>;
    private static catalogue: Catalogue | undefined = undefined; // built on the first load

    constructor(byName: ReadonlyMap<string, Model>) {
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
        for (const t of scalars.all) settings.set(t.name, t["kind"] === "number" ? t.params.filter((p) => !DIGIT_SETTINGS.includes(p)) : t.params);
        cat = {
            name: /^[a-z][a-z0-9_]*$/,
            ref: /^(?:([a-z][a-z0-9_]*):)?([a-z][a-z0-9_]*)(?:\.([a-z][a-z0-9_]*))?$/,
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
        byName.set(node.name, new Model(node.name, fields));
    }
    // Each model field points at its Model once, here, so validate never looks a model up by name.
    for (const field of loaded.fields) if (field.kind === "model") field.target = byName.get(field.model) as Model;
    return new Models(byName);
}
