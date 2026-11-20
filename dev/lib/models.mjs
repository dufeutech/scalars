// Dev-only reference loader for models files, as docs/superpowers/specs/2026-11-20-models-design.md describes them.
// Every language engine copies this behaviour; the shared cases are in dev/langs/cases.json under "models".
// Load is O(file) and iterative: no recursion is driven by the input, so long reference chains can't overflow.
import { modelOf, paramRules } from "../codegen/model.mjs";
import { validate } from "./reference.mjs";

const NAME = /^[a-z][a-z0-9_]*$/;
const REF = /^(?:([a-z][a-z0-9_]*):)?([a-z][a-z0-9_]*)(?:\.([a-z][a-z0-9_]*))?$/;
/** Model nesting deeper than this is refused at load (it bounds validation's recursion). */
export const MAX_DEPTH = 64;
/** Settings refused on number-kind types: float text differs by language, so digit counts can't agree. */
const DIGIT_SETTINGS = ["precision", "scale"];

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const escape = (s) => String(s).replaceAll("~", "~0").replaceAll("/", "~1");

/** A problem at `segments` (keys and list indices); the message is the code's `$meta.errors` template, filled in. */
export function problem(segments, code, params, $meta) {
    if (!Object.hasOwn($meta.errors, code)) throw new Error(`No template for code "${code}"`);
    const message = $meta.errors[code].replace(/\{([a-z_]+)\}/g, (_, name) => {
        if (!Object.hasOwn(params, name)) throw new Error(`Code "${code}" needs param "${name}"`);
        const v = params[name];
        return Array.isArray(v) ? v.join(", ") : String(v);
    });
    const p = { pointer: segments.map((s) => "/" + escape(s)).join(""), code, params, message };
    // Sorting needs the decoded segments (a key "10" and an index 10 differ); kept off the visible shape.
    Object.defineProperty(p, "segments", { value: [...segments] });
    return p;
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

/** A new array of problems, sorted by location (then by code, for two at one location). */
export const sortProblems = (problems) => [...problems].sort(compareProblems);

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
    const newDef = (segments, raw, domain, up = null) => ({ segments, up, raw, domain, ref: null, items: null, field: null, leaf: null, failed: false });
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
            if (!NAME.test(m) || Object.hasOwn(types, m)) { report([d, m], "bad_name"); continue; }
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
            else if (checkSetting(type, v, key)) settings[key] = written[key];
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
        // The model this field nests, through any `items`: an edge of the nesting graph below.
        v.leaf = ref.kind === "model" ? ref.target
            : base.kind === "array" ? (items === base.items ? ref.target.leaf : v.items.leaf)
            : ref.kind === "field" ? ref.target.leaf : null;
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

    // 4. Nesting depth: the longest path over models (acyclic now: fields on cycles failed above), post-order
    // with an explicit stack. A model with no model-typed fields has depth 1.
    const depth = new Map();
    for (const start of models.values()) {
        if (depth.has(start)) continue;
        const calls = [{ model: start, i: 0, d: 1 }];
        const open = new Set([start]);
        while (calls.length) {
            const frame = calls.at(-1);
            if (frame.i < frame.model.list.length) {
                const leaf = frame.model.list[frame.i++].leaf;
                if (!leaf) continue;
                if (depth.has(leaf)) frame.d = Math.max(frame.d, depth.get(leaf) + 1);
                else if (open.has(leaf)) throw new Error(`Model cycle through "${leaf.name}" survived resolution`);
                else { open.add(leaf); calls.push({ model: leaf, i: 0, d: 1 }); }
                continue;
            }
            calls.pop();
            open.delete(frame.model);
            depth.set(frame.model, frame.d);
            if (calls.length) calls.at(-1).d = Math.max(calls.at(-1).d, frame.d + 1);
        }
    }
    // Reported once per too-deep chain: at the outermost too-deep model, on each field that makes it too deep.
    const deep = [...models.values()].filter((m) => depth.get(m) > MAX_DEPTH);
    const inner = new Set();
    for (const m of deep) for (const def of m.list) if (def.leaf && depth.get(def.leaf) > MAX_DEPTH) inner.add(def.leaf);
    for (const m of deep) {
        if (inner.has(m)) continue;
        for (const def of m.list) if (def.leaf && depth.get(def.leaf) + 1 > MAX_DEPTH) report(def.segments, "too_deep", { max: MAX_DEPTH });
    }

    if (problems.length) return { ok: false, problems: sortProblems(problems) };
    const byName = new Map();
    for (const m of models.values()) byName.set(m.name, { name: m.name, fields: new Map([...m.fields].map(([f, def]) => [f, def.field])) });
    const all = [...byName.keys()].sort(compareText);
    return { ok: true, models: { all, get: (name) => byName.get(name) ?? null } };
}
