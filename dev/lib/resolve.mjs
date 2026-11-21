// Dev-only: resolves the source (src/scalar.yaml + src/targets/*.yaml) into flat types.
import fs from "node:fs";
import path from "node:path";
import { applyGenerated } from "./derive.mjs";
import { normalize } from "./reference.mjs";
import { readSource } from "./source.mjs";

/** The closed set every type maps to, read from the dist schema so it is written in one place. */
export const PRIMITIVES = new Set(JSON.parse(fs.readFileSync(new URL("../../schema/dist.schema.json", import.meta.url), "utf8"))
    .$defs.type.properties.primitive.enum);
export const TARGETS = ["html", "postgres"];
/** Every check name a type may give, read from the source schema so it is written in one place. */
export const CHECK_NAMES = new Set(JSON.parse(fs.readFileSync(new URL("../../schema/scalar.schema.json", import.meta.url), "utf8"))
    .$defs.check.oneOf.map((c) => c.const));

/** Core keys a child takes from its base unless it overrides them (null deletes). */
const INHERITED = ["type", "format", "pattern", "minLength", "maxLength", "minimum", "maximum", "contentEncoding", "normalize", "check", "enum"];
// Not inherited, so each type lists its own: `params`.
/** Source-only keys that never appear in resolved output. */
const SOURCE_ONLY = new Set(["base", "abstract", "anchor", "docs"]);
const RESERVED = new Set(["$schema", "version", "$defs"]);
/**
 * Patterns a text type taking `precision` may have. The models engines count digits assuming the value is
 * `-?[0-9]+(\.[0-9]+)?`, so the pattern must accept nothing else: that one, or a narrower form of it.
 */
const DIGIT_PATTERNS = new Set(["^-?[0-9]+(\\.[0-9]+)?$", "^-?[0-9]+$", "^[0-9]+(\\.[0-9]+)?$", "^[0-9]+$"]);

export function loadSources(dir) {
    return {
        core: readSource(path.join(dir, "scalar.yaml")),
        targets: Object.fromEntries(TARGETS.map((t) => [t, readSource(path.join(dir, "targets", `${t}.yaml`))])),
    };
}

const entries = (file) => Object.entries(file).filter(([k]) => !RESERVED.has(k));
const dropNulls = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null));

/** Shallow merge where null deletes; `attrs` merges one level deeper. */
function mergeBlock(parent, own) {
    const out = { ...parent };
    for (const [k, v] of Object.entries(own)) {
        if (k === "attrs" && v !== null && parent.attrs) out.attrs = dropNulls({ ...parent.attrs, ...v });
        else out[k] = v;
    }
    return dropNulls(out);
}

/**
 * A type's enum: text only, sorted with no repeats (so engines can binary-search it), and every value already
 * valid as is: it matches the pattern (an inherited list fails here when the child's pattern differs) and its
 * normalize leaves it unchanged.
 */
function checkList(name, t) {
    if (t.type !== "string") throw new Error(`Type "${name}": only text types may have an enum`);
    const re = t.pattern ? new RegExp(t.pattern, "u") : null;
    t.enum.forEach((v, i) => {
        if (i > 0 && !(t.enum[i - 1] < v)) throw new Error(`Type "${name}": enum must be sorted, with no repeats (at ${JSON.stringify(v)})`);
        if (re && !re.test(v)) throw new Error(`Type "${name}": enum value ${JSON.stringify(v)} does not match its pattern`);
        if (normalize(t, v) !== v) throw new Error(`Type "${name}": enum value ${JSON.stringify(v)} is changed by its normalize`);
    });
}

export function resolve({ core, targets }) {
    const defs = Object.fromEntries(entries(core));
    const docs = core.$defs?.docs ?? {};
    const params = core.$defs?.params ?? {};
    const pgAttrs = targets.postgres?.$defs?.attr ?? {};

    for (const [tname, file] of Object.entries(targets)) {
        for (const [k] of entries(file)) {
            if (!(k in defs)) throw new Error(`targets/${tname}.yaml has an entry for unknown type "${k}"`);
        }
    }

    const done = new Map();
    const inProgress = [];

    function walk(name, from) {
        if (done.has(name)) return done.get(name);
        const def = defs[name];
        if (!def) throw new Error(`Type "${from}" has unknown base "${name}"`);
        if (inProgress.includes(name)) throw new Error(`Base cycle: ${[...inProgress, name].join(" -> ")}`);
        inProgress.push(name);

        const parent = def.base ? walk(def.base, name) : null;
        const t = { name };
        if (parent) for (const k of INHERITED) if (k in parent.core) t[k] = parent.core[k];
        for (const [k, v] of Object.entries(def)) t[k] = v;

        const result = {
            core: dropNulls(t),
            def,
            parent,
            primitive: PRIMITIVES.has(name) ? name : parent?.primitive,
            targets: Object.fromEntries(TARGETS.map((tn) => {
                const own = targets[tn]?.[name] ?? {};
                return [tn, mergeBlock(parent?.targets[tn] ?? {}, own)];
            })),
        };
        inProgress.pop();
        done.set(name, result);
        return result;
    }

    const nearestCore = (r) => {
        for (let p = r.parent; p; p = p.parent) if (p.def.level === "core") return p.core.name;
        return undefined;
    };

    const out = {};
    for (const [name, def] of Object.entries(defs)) {
        const r = walk(name, name);
        if (def.abstract) continue;
        const t = { ...r.core, primitive: r.primitive };

        if (def.level === "core") delete t.alternative;
        else if (!t.alternative) {
            t.alternative = nearestCore(r);
            if (!t.alternative) throw new Error(`Type "${name}" is ${def.level} but has no core ancestor or alternative`);
        }

        if (def.docs !== undefined) {
            const url = docs[def.docs];
            if (!url) throw new Error(`Type "${name}" references unknown docs id "${def.docs}"`);
            t.docs_link = url + (def.anchor ?? "");
        }

        if (t.check !== undefined && !CHECK_NAMES.has(t.check)) throw new Error(`Type "${name}" names unknown check "${t.check}"`);
        if (t.enum !== undefined) checkList(name, t);
        for (const p of t.params ?? []) {
            if (!params[p]) throw new Error(`Type "${name}" names unknown param "${p}"`);
        }
        // Float text differs by language, so digit counts can't agree.
        if (t.type !== "string" && t.params?.some((p) => p === "precision" || p === "scale")) {
            throw new Error(`Type "${name}" is a number, so it can't take precision or scale`);
        }
        if (t.type === "string" && t.params?.includes("precision") && !DIGIT_PATTERNS.has(t.pattern)) {
            throw new Error(`Type "${name}" takes precision, so its pattern must be digits (-?[0-9]+(\\.[0-9]+)? or narrower), not ${t.pattern}`);
        }
        for (const a of r.targets.postgres?.attr ?? []) {
            if (!pgAttrs[a]) throw new Error(`Type "${name}" postgres attr names unknown attr "${a}"`);
        }

        for (const k of SOURCE_ONLY) delete t[k];
        // Copy: applyGenerated adds keys, and the cached blocks are what children inherit.
        for (const tn of TARGETS) t[tn] = structuredClone(r.targets[tn]);
        out[name] = applyGenerated(t);
    }
    return out;
}

/** JSON with object keys sorted at every level: equality that ignores key order. */
export function canonical(v) {
    return JSON.stringify(v, (_, x) => (x && typeof x === "object" && !Array.isArray(x)
        ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]]))
        : x));
}
