// Dev-only: a random differential test of models. Generates models files and payloads from a seed, takes the
// expected answers from the reference (dev/lib/models.mjs), and runs every language runner on them.
// Run: npm run fuzz:models [-- seed [count]]   (count = models files; each loaded one gets several payloads)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ID_FIELD, LINK_KEYWORD, VALUE_KEY, loadModels, validateModel } from "../lib/models.mjs";
import { CASES, DIST, runAll } from "./runners.mjs";

const seed = Number(process.argv[2] ?? Date.now() % 2 ** 32) >>> 0;
const count = Number(process.argv[3] ?? 200);
const scalars = JSON.parse(fs.readFileSync(DIST, "utf8"));
const { types } = scalars;

/** mulberry32: a small seeded PRNG, so a failing seed can be rerun. */
let state = seed;
function random() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
}
const int = (lo, hi) => lo + Math.floor(random() * (hi - lo + 1));
const pick = (list) => list[Math.floor(random() * list.length)];
const chance = (p) => random() < p;

// Known non-bugs kept out: lone surrogates (the Go and Rust runners can't carry them), and integral numbers for
// float fields (Python prints 3.0 for 3; the values agree).
const isFloat = (t) => t.primitive === "float64";
const usable = (t, v) => (typeof v !== "string" || v.isWellFormed()) && !(isFloat(t) && Number.isInteger(v));
const examples = (t, kind) => (t.examples?.[kind] ?? []).filter((v) => usable(t, v));
const typeNames = Object.keys(types);
const aliasOf = new Map(Object.entries(types).flatMap(([n, t]) => (t.aliases ?? []).map((a) => [a, n])));
const typeOf = (word) => types[word] ?? types[aliasOf.get(word)];
const NAMES = ["name", "note", "total", "status", "tags", "owner", "items", "created", "code", "a", "b"];
const ENUM_POOL = ["draft", "sent", "paid", "", "Ünïcode", "a b", "x", "🙂"];

/** Settings for a field object of type `t`, within range. */
function settings(t) {
    const out = {};
    for (const p of t.params ?? []) {
        if (!chance(p === "values" ? 0.95 : 0.6)) continue;
        if (p === "length") out.length = int(1, 30);
        if (p === "values") out.values = [...new Set(Array.from({ length: int(1, 4) }, () => pick(ENUM_POOL)))];
        if (p === "fractional_seconds") out.fractional_seconds = int(0, 6);
        if (p === "precision") out.precision = int(1, 20);
        if (p === "scale" && out.precision !== undefined) out.scale = int(-2, out.precision);
    }
    return out;
}

/** A model reference written in `domain`: the bare name when it's at home, sometimes. */
const refTo = (domain, [d, m]) => (d === domain && chance(0.5) ? m : `${d}:${m}`);
/** A model's fields as written, without VALUE_KEY. */
const ownKeys = (fields) => Object.keys(fields).filter((k) => k !== VALUE_KEY);

/**
 * One written field: a type name, a model name, a field reference, a link, or an object with settings. References
 * point at models written earlier (`done`, [domain, model, fields, isValue]), so a file without a deliberate mistake
 * has no cycle; only a value is embedded. A link (never under `items`) points at any entity, `self` included (the
 * model being written, [domain, model, isValue]): links are no edges, so they can't make a cycle.
 */
function field(done, domain, self, depth = 0) {
    if (depth === 0 && chance(0.15)) {
        const entities = done.filter((x) => !x[3]).concat(self[2] ? [] : [self]);
        if (entities.length) {
            const f = { type: LINK_KEYWORD, to: refTo(domain, pick(entities)) };
            if (chance(0.25)) f.many = true;
            else if (chance(0.2)) f.one = true;
            if (chance(0.2)) f.nullable = true;
            return f;
        }
    }
    const r = random();
    const values = done.filter((x) => x[3]);
    if (r < 0.3) return pick(typeNames);
    if (r < 0.42 && values.length) return refTo(domain, pick(values));
    if (r < 0.5 && done.length) {
        const [d, m, fields] = pick(done);
        return `${d}:${m}.${pick(Object.keys(fields))}`;
    }
    const type = chance(0.15) && depth < 2 ? "array" : pick(typeNames);
    const f = { type, ...settings(types[type]) };
    if (type === "array") f.items = field(done, domain, self, depth + 1);
    if (chance(0.25)) f.nullable = true;
    return f;
}

/** A deliberate mistake, written into `data`. */
function mistake(data, file) {
    const [d, m] = pick(file.names);
    const fields = data[d][m];
    const key = pick(ownKeys(fields));
    const kinds = (value) => file.names.filter(([d2, m2]) => (data[d2][m2][VALUE_KEY] === true) === value);
    switch (int(0, 15)) {
        case 12: { const e = kinds(false); fields[key] = e.length ? refTo(d, pick(e)) : "no_such_model"; break; } // embeds an entity
        case 13: { const v = kinds(true); fields[key] = { type: LINK_KEYWORD, to: v.length ? refTo(d, pick(v)) : "email" }; break; } // links to a value
        case 14: fields[key] = { type: LINK_KEYWORD, to: refTo(d, pick(file.names)), many: true, one: true }; break;
        case 15: fields[ID_FIELD] = "string"; break;
        case 10: fields[key] = pick([...aliasOf.keys()]); break;
        case 11: { const [d2, m2] = pick(file.names); fields[key] = `${d2}:${m2}`; data[d2][m2].zz_back = `${d}:${m}`; break; }
        case 0: data.Bad_Domain = { m: { a: "text" } }; break;
        case 1: data[d]["9model"] = { a: "text" }; break;
        case 2: fields[key] = "no_such_type"; break;
        case 3: fields[key] = m; fields.zz_self = `${d}:${m}`; break; // a model that holds itself
        case 4: fields[key] = { type: "string", length: pick([0, -1, 10485761, 1.5]) }; break;
        case 5: fields[key] = { type: "string", length: pick(["5", true, null, [], {}]) }; break;
        case 6: fields[key] = { type: "enum", values: ["ok", "x".repeat(64)] }; break;
        case 7: fields[key] = { type: "decimal", scale: 2 }; break;
        case 8: fields[key] = { type: "int32", length: 3 }; break;
        default: fields[key] = { type: "enum", values: pick([[], "draft", [1], ["a", "a"]]) };
    }
}

/** A models file and the names of its models. */
function modelsFile() {
    const file = { names: [] };
    const domains = Array.from({ length: int(1, 3) }, (_, i) => `d${i}`);
    for (const d of domains) for (let i = int(1, 4); i > 0; i--) file.names.push([d, `m${i}`]);
    const data = {}, done = [];
    for (const [d, m] of file.names) {
        const isValue = chance(0.5);
        const fields = {};
        for (const name of NAMES.slice(0, int(1, 5))) fields[name] = field(done, d, [d, m, isValue]);
        (data[d] ??= {})[m] = isValue ? { [VALUE_KEY]: true, ...fields } : fields;
        done.push([d, m, fields, isValue]);
    }
    if (chance(0.2)) mistake(data, file);
    return data;
}

/** A value meant to pass `written` (a field as written in `data`); the reference decides whether it does. */
function value(data, domain, written, depth = 0) {
    if (depth > 3) return null;
    if (typeof written === "string") {
        const t = typeOf(written);
        if (t) return valueOf(t, {});
        const ref = /^(?:([a-z0-9_]+):)?([a-z0-9_]+)(?:\.([a-z0-9_]+))?$/.exec(written);
        if (!ref) return null;
        const [, d = domain, m, f] = ref;
        const fields = data[d]?.[m];
        if (!fields) return null;
        return f === undefined ? payload(data, d, fields, depth + 1) : value(data, d, fields[f], depth + 1);
    }
    if (written && typeof written === "object" && typeof written.type === "string") {
        if (written.nullable && chance(0.15)) return null;
        if (written.type === LINK_KEYWORD) return written.many ? ids() : id();
        if (written.type === "array") return Array.from({ length: int(0, 3) }, () => value(data, domain, written.items, depth + 1));
        const t = typeOf(written.type);
        if (t) return valueOf(t, written);
        return value(data, domain, written.type, depth + 1);
    }
    return null;
}

/** `n` digits, as a decimal string with `frac` of them after the point. */
function digits(n, frac) {
    const s = Array.from({ length: Math.max(n, 1) }, () => int(0, 9)).join("");
    const f = Math.min(Math.max(frac, 0), s.length - 1);
    return (chance(0.3) ? "-" : "") + (f > 0 ? `${s.slice(0, -f)}.${s.slice(-f)}` : s);
}

function valueOf(t, written) {
    if (Array.isArray(written.values) && written.values.length) return pick(written.values);
    // Boundaries: a string at or just over its length (counted in code points), digits at or just over precision.
    if (Number.isInteger(written.length) && chance(0.5)) {
        return Array.from({ length: written.length + int(-1, 1) }, () => pick(["a", "é", "🙂", " "])).join("");
    }
    if (Number.isInteger(written.precision) && chance(0.6)) {
        const scale = Number.isInteger(written.scale) ? written.scale : 0;
        const value = digits(written.precision + int(-1, 1), scale + int(-1, 1));
        if (!isFloat(t)) return value;
        return Number.isInteger(Number(value)) ? Number(value) + 0.5 : Number(value);
    }
    const valid = examples(t, "valid");
    if (isFloat(t) && chance(0.3)) return 1.5;
    return valid.length ? structuredClone(pick(valid)) : "x";
}

const hex = (n) => Array.from({ length: n }, () => "0123456789abcdef"[int(0, 15)]).join("");

/** A uuid v7, upper-case or space-padded sometimes; or, sometimes, a mistake (a v4 uuid, a number). */
function id() {
    if (chance(0.08)) return pick(["f81d4fae-7dec-11d0-a765-00a0c91e6bf6", 3]);
    let u = `${hex(8)}-${hex(4)}-7${hex(3)}-${pick(["8", "9", "a", "b"])}${hex(3)}-${hex(12)}`;
    if (chance(0.2)) u = u.toUpperCase();
    return chance(0.15) ? ` ${u} ` : u;
}

/** A `many` link's list: 0 to 4 ids, sometimes with a repeat (the same id, maybe spelled otherwise). */
function ids() {
    const list = Array.from({ length: int(0, 4) }, id);
    if (list.length && chance(0.15)) list.push(typeof list[0] === "string" ? list[0].toUpperCase() : list[0]);
    return list;
}

function payload(data, domain, fields, depth = 0) {
    const out = {};
    // An entity's implicit id is sometimes there: an id, or null.
    if (fields[VALUE_KEY] !== true && chance(0.3)) out[ID_FIELD] = chance(0.8) ? id() : null;
    for (const k of ownKeys(fields)) out[k] = value(data, domain, fields[k], depth);
    return out;
}

/** A payload with one random change that should often make it fail. */
function mutate(data, domain, fields, p) {
    const keys = ownKeys(fields);
    const key = pick(keys);
    const t = typeof fields[key] === "string" ? typeOf(fields[key]) : typeOf(fields[key]?.type ?? "");
    switch (int(0, 7)) {
        case 0: p[key] = pick([1.5, "x", true, {}, [], "  "]); break;
        case 1: { const bad = t ? examples(t, "invalid").concat(examples(t, "check_invalid"), examples(t, "list_invalid")) : []; p[key] = bad.length ? pick(bad) : 1.5; break; }
        case 2: delete p[key]; break;
        case 3: p.zz_extra = "x"; break;
        case 4: p[key] = null; break;
        case 5: p[key] = [p[key], [p[key]]]; break;
        case 6: p[key] = { inner: p[key] }; break;
        default: return pick([[], "x", null, 1.5]);
    }
    return p;
}

const cases = JSON.parse(fs.readFileSync(CASES, "utf8"));
const json = (v) => JSON.parse(JSON.stringify(v)); // the visible shape only
let loadCount = 0, validateCount = 0, okLoads = 0;
for (let i = 0; i < count; i++) {
    const data = modelsFile();
    const name = `fuzz_${seed}_${i}`;
    const loaded = loadModels(data, scalars);
    cases.models.load.push(loaded.ok
        ? { name, data, ok: true, all: [...loaded.models.all] }
        : { name, data, ok: false, problems: json(loaded.problems) });
    loadCount++;
    if (!loaded.ok) continue;
    okLoads++;
    for (const id of loaded.models.all) {
        const [d, m] = id.split(":");
        for (let j = 0; j < 4; j++) {
            let p = payload(data, d, data[d][m]);
            if (j > 0) p = mutate(data, d, data[d][m], p);
            const r = validateModel(loaded.models.get(id), p);
            cases.models.validate.push(r.ok
                ? { name: `${name}_${id}_${j}`, load: name, model: id, in: p, ok: true, out: json(r.value) }
                : { name: `${name}_${id}_${j}`, load: name, model: id, in: p, ok: false, problems: json(r.problems) });
            validateCount++;
        }
    }
}

const out = path.join(os.tmpdir(), `scalars-fuzz-${seed}.json`);
fs.writeFileSync(out, JSON.stringify(cases));
console.log(`seed ${seed}: ${loadCount} models files (${okLoads} load), ${validateCount} payloads, cases in ${out}`);
const failed = runAll(path.resolve(DIST), out, 40, { postgres: false, tests: false });
console.log(failed ? `seed ${seed}: ${failed} runner(s) disagree with the reference` : `seed ${seed}: all runners agree`);
process.exit(failed ? 1 : 0);
