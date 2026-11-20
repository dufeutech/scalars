// Dev-only reference loader for models files, as docs/superpowers/specs/2026-11-20-models-design.md describes them.
// Every language engine copies this behaviour; the shared cases are in dev/langs/cases.json under "models".
// Load is O(file) and iterative: no recursion is driven by the input, so long reference chains can't overflow.
import { modelOf, paramRules } from "../codegen/model.mjs";
import { codePoints, validate } from "./reference.mjs";

export const NAME = /^[a-z][a-z0-9_]*$/;
export const REF = /^(?:([a-z][a-z0-9_]*):)?([a-z][a-z0-9_]*)(?:\.([a-z][a-z0-9_]*))?$/;
/** Nesting deeper than this, each model and each `items` one level, is refused at load: it bounds a payload's depth. */
export const MAX_DEPTH = 64;
/** Settings refused on number-kind types: float text differs by language, so digit counts can't agree. */
const DIGIT_SETTINGS = ["precision", "scale"];
/** A field's `values` array → its Set, built at load so validate looks a value up in O(1). */
const valueSets = new WeakMap();

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const escape = (s) => String(s).replaceAll("~", "~0").replaceAll("/", "~1");

/**
 * A problem at `segments` (keys and list indices). The message is the code's `$meta.errors` template, filled in;
 * a code without a template (`invalid`, whose text is the type's `error`) needs `message`, used only then.
 */
export function problem(segments, code, params, $meta, message) {
    if (!Object.hasOwn($meta.errors, code)) {
        if (typeof message !== "string") throw new Error(`Code "${code}" has no template, so it needs a message`);
        return located(segments, { code, params, message });
    }
    return located(segments, { code, params, message: fill(code, params, $meta) });
}

/** Adds the pointer, and the decoded segments sorting needs (a key "10" and an index 10 differ), kept off the visible shape. */
function located(segments, { code, params, message }) {
    const p = { pointer: segments.map((s) => "/" + escape(s)).join(""), code, params, message };
    Object.defineProperty(p, "segments", { value: [...segments] });
    return p;
}

function fill(code, params, $meta) {
    return $meta.errors[code].replace(/\{([a-z_]+)\}/g, (_, name) => {
        if (!Object.hasOwn(params, name)) throw new Error(`Code "${code}" needs param "${name}"`);
        const v = params[name];
        return Array.isArray(v) ? v.join(", ") : String(v);
    });
}

/** Compares two strings by code point (JS `<` compares UTF-16 units, which misorders text outside the BMP). */
export function compareText(a, b) {
    let i = 0;
    while (i < a.length && i < b.length) {
        const ca = a.codePointAt(i);
        const cb = b.codePointAt(i);
        if (ca !== cb) return ca - cb;
        i += ca > 0xffff ? 2 : 1;
    }
    return a.length - b.length;
}

/** Segment by segment: list indices numerically, keys by code point, an index before a key; a parent first. */
function compareProblems(a, b) {
    const x = a.segments;
    const y = b.segments;
    for (let i = 0; i < x.length && i < y.length; i++) {
        if (x[i] === y[i]) continue;
        const nx = typeof x[i] === "number";
        const ny = typeof y[i] === "number";
        if (nx && ny) return x[i] - y[i];
        if (nx !== ny) return nx ? -1 : 1;
        return compareText(x[i], y[i]);
    }
    return x.length - y.length || compareText(a.code, b.code);
}

/**
 * A new array of problems, sorted by location (then by code, for two at one location). Every problem must be
 * built with problem(): the order needs its decoded segments, which the pointer text can't give back.
 */
export function sortProblems(problems) {
    for (const p of problems) {
        if (!Array.isArray(p.segments)) throw new Error(`Problem at "${p.pointer}" has no segments: build problems with problem()`);
    }
    return [...problems].sort(compareProblems);
}

/** Per catalogue: alias → canonical name, the settings each type takes, and the setting rules. */
const catalogues = new WeakMap();
function catalogue(scalars) {
    let c = catalogues.get(scalars);
    if (c) return c;
    const aliases = new Map();
    const settings = new Map();
    for (const t of Object.values(scalars.types)) {
        for (const a of t.aliases ?? []) aliases.set(a, t.name);
        const m = modelOf(t);
        settings.set(t.name, m.kind === "number" ? m.params.filter((p) => !DIGIT_SETTINGS.includes(p)) : m.params);
    }
    c = { aliases, settings, rules: paramRules(scalars.$meta) };
    catalogues.set(scalars, c);
    return c;
}

/**
 * Loads a models file (parsed JSON). Returns { ok: true, models } with `models.get("domain:model")` and
 * `models.all`, or { ok: false, problems } listing every problem in the file, sorted.
 */
export function loadModels(data, scalars) {
    const { types, $meta } = scalars;
    const cat = catalogue(scalars);
    const problems = [];
    const report = (segments, code, params = {}) => problems.push(problem(segments, code, params, $meta));
    if (!isObject(data)) return { ok: false, problems: [problem([], "not_object", {}, $meta)] };

    // 1. Names. A badly named entry is reported and its content isn't examined.
    const models = new Map(); // "domain:model" → model node
    const defs = []; // every written field, in file order
    // A written field holds its segments; an `items` def links to its parent instead of copying the path, which
    // pathOf builds only for a problem, so a deep `items` chain stays linear.
    const newDef = (segments, raw, domain, up = null) => ({ segments, up, raw, domain, ref: null, items: null, field: null, leaf: null, arrays: 0, failed: false });
    const pathOf = (def, ...extra) => {
        const tail = [];
        let n = def;
        for (; n.up; n = n.up) tail.push("items");
        return [...n.segments, ...tail, ...extra];
    };
    for (const [d, domain] of Object.entries(data)) {
        if (d === "$schema") continue;
        if (!NAME.test(d)) { report([d], "bad_name"); continue; }
        if (!isObject(domain)) { report([d], "not_object"); continue; }
        for (const [m, fields] of Object.entries(domain)) {
            if (!NAME.test(m)) { report([d, m], "bad_name"); continue; }
            if (Object.hasOwn(types, m)) { report([d, m], "type_name"); continue; }
            if (!isObject(fields)) { report([d, m], "not_object"); continue; }
            const model = { isModel: true, name: `${d}:${m}`, fields: new Map(), list: [] };
            models.set(model.name, model);
            for (const [f, raw] of Object.entries(fields)) {
                if (!NAME.test(f)) { report([d, m, f], "bad_name"); continue; }
                const def = newDef([d, m, f], raw, d);
                model.fields.set(f, def);
                model.list.push(def);
                defs.push(def);
            }
        }
    }

    // 2. References, each read once in the domain where it's written. Sets def.ref, or reports and leaves it null.
    function parse(def) {
        const { raw } = def;
        let written;
        if (typeof raw === "string") written = raw;
        else if (!isObject(raw)) return report(pathOf(def), "bad_setting");
        else if (Object.hasOwn(raw, "type") && typeof raw.type === "string") written = raw.type;
        else return report(pathOf(def), "missing_setting", { setting: "type" });
        const m = REF.exec(written);
        if (!m) return report(pathOf(def), "unresolved");
        const [, domain, name, field] = m;
        const home = `${domain ?? def.domain}:${name}`;
        if (field !== undefined) {
            const target = models.get(home)?.fields.get(field);
            if (!target) return report(pathOf(def), "unresolved");
            def.ref = { kind: "field", target };
        } else if (domain === undefined && Object.hasOwn(types, name)) def.ref = { kind: "type", type: types[name] };
        else if (models.has(home)) def.ref = { kind: "model", target: models.get(home) };
        else if (domain === undefined && cat.aliases.has(name)) report(pathOf(def), "alias", { canonical: cat.aliases.get(name) });
        else report(pathOf(def), "unresolved");
    }
    for (const def of defs) parse(def);

    // 3. Resolution and cycles in one pass: Tarjan's strongly connected components over written fields and
    // models, with an explicit stack. Edges: a model reference → that model; a model → its fields; a field
    // reference → the field it copies; an array field → its `items`. A field's settings, `items` included, are
    // read only once its type resolves, so `items` is an edge only when the resolved type is an array.
    // Components finish dependencies-first, so each field resolves exactly once, after what it copies.
    const takesItems = (v) => {
        if (!v.ref || !isObject(v.raw) || !Object.hasOwn(v.raw, "items")) return false;
        if (v.ref.kind === "type") return v.ref.type.name === "array";
        const t = v.ref.target;
        return v.ref.kind === "field" && t.done && !t.failed && t.field.kind === "array";
    };
    function successor(frame) {
        const v = frame.node;
        if (v.isModel) return frame.step < v.list.length ? v.list[frame.step++] : null;
        while (frame.step < 2) {
            const step = frame.step++;
            if (step === 0 && v.ref && v.ref.kind !== "type") return v.ref.target;
            if (step === 1 && takesItems(v)) {
                v.items = newDef(null, v.raw.items, v.domain, v);
                parse(v.items);
                return v.items;
            }
        }
        return null;
    }
    let counter = 0;
    const stack = [];
    const enter = (v, calls) => {
        v.index = v.low = counter++;
        v.onStack = true;
        stack.push(v);
        calls.push({ node: v, step: 0 });
    };
    for (const root of defs) {
        if (root.index !== undefined) continue;
        const calls = [];
        enter(root, calls);
        while (calls.length) {
            const frame = calls.at(-1);
            const v = frame.node;
            const w = successor(frame);
            if (w) {
                if (w.index === undefined) enter(w, calls);
                else if (w.onStack) {
                    v.low = Math.min(v.low, w.index);
                    if (w === v) v.selfLoop = true;
                }
                continue;
            }
            calls.pop();
            if (calls.length) calls.at(-1).node.low = Math.min(calls.at(-1).node.low, v.low);
            if (v.low !== v.index) continue;
            const component = [];
            let u;
            do {
                u = stack.pop();
                u.onStack = false;
                u.done = true;
                component.push(u);
            } while (u !== v);
            if (component.length > 1 || v.selfLoop) {
                // A cycle: every field on it fails; the problem is reported at each reference on it.
                for (const n of component) {
                    if (n.isModel) continue;
                    n.failed = true;
                    if (n.ref.kind !== "type") report(pathOf(n), "cycle");
                }
            } else if (!v.isModel) resolve(v);
        }
    }

    /** Builds v.field from its resolved type plus the settings written next to it, or marks v failed. */
    function resolve(v) {
        const { ref, raw } = v;
        if (!ref || (ref.kind === "field" && ref.target.failed)) { v.failed = true; return; }
        const base = ref.kind === "field" ? ref.target.field
            : ref.kind === "model" ? { kind: "model", model: ref.target.name, nullable: false }
            : ref.type.name === "array" ? { kind: "array", items: null, nullable: false }
            : { kind: "type", type: ref.type.name, settings: {}, nullable: false };
        const type = base.kind === "type" ? types[base.type] : null;
        const allowed = type ? cat.settings.get(base.type) : base.kind === "array" ? ["items"] : [];
        const written = isObject(raw) ? raw : {};
        const settings = type ? { ...base.settings } : null;
        let { nullable, items } = base;
        let failed = false;
        const before = problems.length;
        for (const key of Object.keys(written)) {
            if (key === "type") continue;
            if (key === "nullable") { if (checkSetting(null, v, key)) nullable = written[key]; }
            else if (!allowed.includes(key)) report(pathOf(v, key), "unknown_setting");
            else if (key === "items") { if (v.items.failed) failed = true; else items = v.items.field; }
            // A list setting (`values`) is copied, so the loaded models never alias the caller's data.
            else if (checkSetting(type, v, key)) settings[key] = Array.isArray(written[key]) ? [...written[key]] : written[key];
        }
        // A written setting counts as present even when its value was refused, so it isn't also reported missing.
        const has = (key) => Object.hasOwn(written, key) || (settings !== null && Object.hasOwn(base.settings, key));
        if (base.kind === "array" && items === null && !has("items")) report(pathOf(v), "missing_setting", { setting: "items" });
        if (type?.name === "enum" && !has("values")) report(pathOf(v), "missing_setting", { setting: "values" });
        if (allowed.includes("scale") && has("scale") && !has("precision")) report(pathOf(v, "scale"), "missing_setting", { setting: "precision" });
        if (failed || problems.length > before) { v.failed = true; return; }
        v.field = type ? { kind: "type", type: base.type, settings, nullable }
            : base.kind === "array" ? { kind: "array", items, nullable }
            : { kind: "model", model: base.model, nullable };
        // Once per written `values`: copies share the array.
        if (settings?.values && !valueSets.has(settings.values)) valueSets.set(settings.values, new Set(settings.values));
        // The model this field nests, through any `items` (an edge of the nesting graph below), and how many
        // `items` levels lie on the way: each counts toward the depth limit like a model.
        const from = ref.kind === "model" ? null
            : base.kind === "array" ? (items === base.items ? ref.target : v.items)
            : ref.kind === "field" ? ref.target : null;
        v.leaf = ref.kind === "model" ? ref.target : from ? from.leaf : null;
        v.arrays = !from ? 0 : from === v.items ? 1 + from.arrays : from.arrays;
    }

    /** Checks the value v's `key` holds against its `$meta.params` rule; reports and returns false when refused. */
    function checkSetting(type, v, key) {
        const rule = cat.rules[key];
        const value = v.raw[key];
        let ok;
        if (rule.kind === "boolean") ok = typeof value === "boolean";
        else if (rule.kind === "integer") {
            ok = typeof value === "number" && Number.isInteger(value)
                && (rule.minimum === null || value >= rule.minimum) && (rule.maximum === null || value <= rule.maximum);
        } else if (rule.kind === "array") {
            ok = Array.isArray(value) && (rule.minItems === null || value.length >= rule.minItems);
            // Entries must be strings, unique, and already clean: the type's validate returns each unchanged.
            if (ok) {
                const seen = new Set();
                value.forEach((entry, i) => {
                    const r = typeof entry === "string" ? validate(type, entry) : null;
                    if (r?.ok && r.value === entry && !seen.has(entry)) seen.add(entry);
                    else { report(pathOf(v, key, i), "bad_setting"); ok = false; }
                });
                return ok;
            }
        } else throw new Error(`Setting "${key}" has unknown kind "${rule.kind}"`);
        if (!ok) report(pathOf(v, key), "bad_setting");
        return ok;
    }

    // 4. Nesting depth: the longest chain of levels, where each model and each `items` is one level (acyclic now:
    // fields on cycles failed above). Post-order with an explicit stack. A model of plain fields has depth 1;
    // a field adds its `items` levels plus the depth of the model it nests.
    const depth = new Map();
    const fieldDepth = (def) => def.arrays + (def.leaf ? depth.get(def.leaf) : 0);
    for (const start of models.values()) {
        if (depth.has(start)) continue;
        const calls = [{ model: start, i: 0, d: 1 }];
        const open = new Set([start]);
        while (calls.length) {
            const frame = calls.at(-1);
            if (frame.i < frame.model.list.length) {
                const def = frame.model.list[frame.i];
                const { leaf } = def;
                if (leaf && !depth.has(leaf)) {
                    // Visit the nested model first, then come back to this field.
                    if (open.has(leaf)) throw new Error(`Model cycle through "${leaf.name}" survived resolution`);
                    open.add(leaf);
                    calls.push({ model: leaf, i: 0, d: 1 });
                    continue;
                }
                frame.i++;
                if (!def.failed) frame.d = Math.max(frame.d, 1 + fieldDepth(def));
                continue;
            }
            calls.pop();
            open.delete(frame.model);
            depth.set(frame.model, frame.d);
        }
    }
    // Reported once per too-deep chain: at the outermost too-deep model, on each field that makes it too deep.
    const deep = [...models.values()].filter((m) => depth.get(m) > MAX_DEPTH);
    const inner = new Set();
    for (const m of deep) for (const def of m.list) if (def.leaf && depth.get(def.leaf) > MAX_DEPTH) inner.add(def.leaf);
    for (const m of deep) {
        if (inner.has(m)) continue;
        for (const def of m.list) if (!def.failed && 1 + fieldDepth(def) > MAX_DEPTH) report(def.segments, "too_deep", { max: MAX_DEPTH });
    }

    if (problems.length) return { ok: false, problems: sortProblems(problems) };
    const byName = new Map();
    const get = (name) => byName.get(name) ?? null;
    // What validateModel needs besides the model: the types, the templates and the other models. Kept off the
    // visible shape.
    const context = { types, $meta, get };
    for (const m of models.values()) {
        const model = { name: m.name, fields: new Map([...m.fields].map(([f, def]) => [f, def.field])) };
        Object.defineProperty(model, "context", { value: context });
        // [name, field] in declared order, built once here rather than per payload object.
        Object.defineProperty(model, "entries", { value: [...model.fields] });
        byName.set(m.name, model);
    }
    const all = [...byName.keys()].sort(compareText);
    return { ok: true, models: { all, get } };
}

/**
 * Rejects exactly what Postgres numeric(p, s) refuses, in one pass over the cleaned text `t`
 * (`-?[0-9]+(\.[0-9]+)?`): R = round(|value| * 10^s), half away from zero, must have at most p digits.
 */
export function fitsNumeric(t, p, s) {
    const start = t[0] === "-" ? 1 : 0;
    const dot = t.indexOf(".", start);
    const intLen = (dot < 0 ? t.length : dot) - start;
    const n = t.length - start - (dot < 0 ? 0 : 1); // digits, the point left out
    const digit = (i) => t.charCodeAt(start + i + (dot >= 0 && i >= intLen ? 1 : 0)) - 48;
    const k = intLen + s; // digits of the value R keeps
    if (k < 0) return true; // rounds to 0
    let z = 0; // the first nonzero digit
    while (z < n && digit(z) === 0) z++;
    const kept = Math.min(k, n);
    const width = z < kept ? k - z : 0; // digits of R before any carry (padding zeros count)
    const carry = k < n && digit(k) >= 5;
    let nines = k <= n; // padding zeros aren't 9s
    for (let i = z; nines && i < kept; i++) if (digit(i) !== 9) nines = false;
    return width + (carry && nines ? 1 : 0) <= p;
}

/**
 * Validates a parsed JSON payload against a model from loadModels. Returns { ok: true, value } with the cleaned
 * payload (declared keys only, normalized values, a missing nullable key as null), or { ok: false, problems },
 * every problem, sorted.
 */
export function validateModel(model, payload) {
    return run(model, payload, false);
}

/** Whether the payload is valid: validateModel's `ok`, stopping at the first problem. */
export function isValidModel(model, payload) {
    return run(model, payload, true).ok;
}

/**
 * One loop over an explicit stack of pending values: each value is visited once. (Load bounds the depth at
 * MAX_DEPTH, so an engine may recurse instead.) A value's output slot is made before its children are visited,
 * which fill it in.
 */
function run(model, payload, first) {
    const { types, $meta, get } = model.context;
    const problems = [];
    // A location is a link to its parent, so a deep value costs O(1); the segments are built only for a problem.
    const segmentsOf = (at) => {
        const s = [];
        for (; at; at = at.up) s.push(at.seg);
        return s.reverse();
    };
    const report = (at, code, params = {}, message) => problems.push(problem(segmentsOf(at), code, params, $meta, message));
    if (!isObject(payload)) {
        report(null, "not_object");
        return { ok: false, problems };
    }
    const holder = [undefined];
    const pending = [{ field: { kind: "model", model: model.name, nullable: false }, value: payload, at: null, out: holder, key: 0 }];
    // A key is set as an own property, so even a key "__proto__" couldn't change the output's prototype.
    const put = (out, key, value) => {
        if (typeof key === "number") out[key] = value;
        else Object.defineProperty(out, key, { value, writable: true, enumerable: true, configurable: true });
    };
    while (pending.length) {
        if (first && problems.length) break;
        const { field, value, at, out, key } = pending.pop();
        if (value === null || value === undefined) {
            if (field.nullable) put(out, key, null);
            else report(at, "required");
            continue;
        }
        if (field.kind === "model") {
            if (!isObject(value)) { report(at, "not_object"); continue; }
            const { fields, entries } = get(field.model);
            const obj = {};
            put(out, key, obj);
            for (const k of Object.keys(value)) if (!fields.has(k)) report({ up: at, seg: k }, "unknown_field");
            // Pushed in reverse, so fields are visited in declared order.
            for (let i = entries.length - 1; i >= 0; i--) {
                const [name, f] = entries[i];
                pending.push({ field: f, value: Object.hasOwn(value, name) ? value[name] : undefined, at: { up: at, seg: name }, out: obj, key: name });
            }
        } else if (field.kind === "array") {
            if (!Array.isArray(value)) { report(at, "not_list"); continue; }
            const list = new Array(value.length);
            put(out, key, list);
            for (let i = value.length - 1; i >= 0; i--) pending.push({ field: field.items, value: value[i], at: { up: at, seg: i }, out: list, key: i });
        } else {
            const type = types[field.type];
            const r = validate(type, value);
            if (!r.ok) { report(at, "invalid", { type: type.name }, type.error); continue; }
            const { length, values, precision, scale = 0 } = field.settings;
            if (length !== undefined && codePoints(r.value) > length) report(at, "too_long", { max: length });
            if (values !== undefined && !valueSets.get(values).has(r.value)) report(at, "not_allowed", { values: [...values] });
            if (precision !== undefined && !fitsNumeric(r.value, precision, scale)) report(at, "too_many_digits", { precision, scale });
            put(out, key, r.value);
        }
    }
    return problems.length ? { ok: false, problems: sortProblems(problems) } : { ok: true, value: holder[0] };
}
