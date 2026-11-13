// Dev-only: resolves the source JSON (scalar.json + targets/*.json) into flat types.
import fs from "node:fs";
import path from "node:path";
import { applyGenerated } from "./derive.mjs";

export const PRIMITIVES = new Set([
    "string", "text", "boolean", "int32", "int64", "float64", "decimal", "object", "array",
    "any", "date", "time_local", "date_time", "date_time_local", "duration", "binary",
]);
export const TARGETS = ["html", "postgres"];

/** Core keys a child takes from its base unless it overrides them (null deletes). */
const INHERITED = ["type", "format", "pattern", "minimum", "maximum", "contentEncoding", "normalize"];
/** Source-only keys that never appear in resolved output. */
const SOURCE_ONLY = new Set(["base", "abstract", "anchor", "docs"]);
const RESERVED = new Set(["$schema", "version", "$defs"]);

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

export function loadSources(dir) {
    return {
        core: readJson(path.join(dir, "scalar.json")),
        targets: Object.fromEntries(TARGETS.map((t) => [t, readJson(path.join(dir, "targets", `${t}.json`))])),
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

export function resolve({ core, targets }) {
    const defs = Object.fromEntries(entries(core));
    const docs = core.$defs?.docs ?? {};

    for (const [tname, file] of Object.entries(targets)) {
        for (const [k] of entries(file)) {
            if (!(k in defs)) throw new Error(`targets/${tname}.json has an entry for unknown type "${k}"`);
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

        for (const k of SOURCE_ONLY) delete t[k];
        for (const tn of TARGETS) t[tn] = r.targets[tn];
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
