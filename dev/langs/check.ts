// Imports the generated dist/ts/scalars.ts and checks every example plus cases.json.
// Run: node check.ts <dist/scalars.json> <cases.json>
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [distPath, casesPath] = process.argv.slice(2);
const mod = await import(pathToFileURL(path.join(path.dirname(path.resolve(distPath)), "ts", "scalars.ts")).href).catch((e: Error) => {
    console.log(`ts: cannot import the generated scalars.ts: ${e.message}`);
    process.exit(1);
});
const { Scalar, ScalarError } = mod;
const scalars: any = mod.default;

const types: Record<string, any> = JSON.parse(fs.readFileSync(distPath, "utf8")).types;
const cases = JSON.parse(fs.readFileSync(casesPath, "utf8"));
const fails: string[] = [];
const show = (v: unknown) => (typeof v === "number" ? String(v) : JSON.stringify(v));

function get(name: string): any {
    const t = scalars.get(name);
    if (t === undefined) fails.push(`get(${show(name)}) found nothing`);
    return t;
}

const value = (c: any) => ("special" in c ? { NaN: NaN, Infinity: Infinity }[c.special as "NaN" | "Infinity"] : c.in);

// Nothing may be compiled or built at import.
for (const t of scalars.all) if (t.rx !== undefined) fails.push(`${t.name} compiled its regex at import`);
if ((Scalar as any).index !== undefined) fails.push("the lookup map was built at import");

if (scalars.all.length !== Object.keys(types).length) fails.push(`all has ${scalars.all.length} types, dist has ${Object.keys(types).length}`);

for (const [name, spec] of Object.entries(types)) {
    const t = get(name);
    if (t === undefined) continue;
    if (scalars[name] !== t) fails.push(`scalars.${name} is not the type get(${show(name)}) returns`);
    const same = [t.name, t.label, t.hint, t.error, t.details, t.level, t.primitive, JSON.stringify(t.aliases), JSON.stringify(t.params)]
        .join("\u0000") === [name, spec.label, spec.hint, spec.error, spec.details, spec.level, spec.primitive, JSON.stringify(spec.aliases ?? []), JSON.stringify(spec.params ?? [])].join("\u0000");
    if (!same || (t.check ?? null) !== (spec.check ?? null)) fails.push(`${name} metadata differs from dist`);
    for (const v of spec.examples.valid) if (!t.isValid(v)) fails.push(`${name} rejects valid ${show(v)}`);
    for (const v of spec.examples.invalid ?? []) {
        // Normalizing may repair an invalid example ("usa" -> "USA"), so only those may pass.
        if (t.isValid(v) && !(typeof v === "string" && t.normalize(v) !== v)) fails.push(`${name} accepts invalid ${show(v)}`);
    }
    for (const v of spec.examples.check_invalid ?? []) if (t.isValid(v)) fails.push(`${name} accepts check_invalid ${show(v)}`);
    for (const alias of spec.aliases ?? []) if (scalars.get(alias) !== t) fails.push(`get(${show(alias)}) is not ${name}`);
}

for (const c of cases.normalize) {
    // normalize is a method of the type, so borrow any text type's steps by building a probe.
    const probe = new Scalar({ name: "probe", label: "", hint: "", error: "", details: "", level: "", primitive: "string", aliases: [], examples: { valid: [], invalid: [] }, kind: "text", steps: c.steps });
    const got = probe.normalize(c.in);
    if (got !== c.out) fails.push(`normalize ${show(c.in)} ${c.steps} = ${show(got)}, want ${show(c.out)}`);
}

for (const c of cases.lookup) {
    const got = scalars.get(c.in)?.name ?? null;
    if (got !== c.out) fails.push(`lookup ${show(c.in)} = ${got}, want ${c.out}`);
}

for (const c of cases.match) {
    const t = get(c.type);
    if (t !== undefined && t.isValid(c.in) !== c.ok) fails.push(`${c.type} on ${show(c.in)}: want ${c.ok}`);
}

for (const c of cases.validate) {
    const t = get(c.type);
    if (t === undefined) continue;
    const v = value(c);
    let out: unknown;
    try {
        out = t.validate(v);
    } catch (e) {
        if (!(e instanceof ScalarError)) throw e;
        if (c.ok) fails.push(`${c.type} rejects ${show(v)}`);
        else if (e.message !== types[c.type].error || e.scalar !== t) fails.push(`${c.type} error ${show(e.message)} is not the type's error`);
        if (t.isValid(v)) fails.push(`${c.type}: validate raised but isValid said yes for ${show(v)}`);
        continue;
    }
    if (!c.ok) fails.push(`${c.type} accepts ${show(v)}`);
    else if ("out" in c && show(out) !== show(c.out)) fails.push(`${c.type} on ${show(v)} = ${show(out)}, want ${show(c.out)}`);
    else if (!t.isValid(v)) fails.push(`${c.type}: validate passed but isValid said no for ${show(v)}`);
}

const anyOut = scalars.any.validate([1]);
if (!Array.isArray(anyOut) || anyOut[0] !== 1) fails.push("any.validate([1]) did not return [1]");
if (scalars.object.isValid(new Date()) || scalars.object.isValid(new Map())) fails.push("object accepts a Date or a Map");
if (!scalars.object.isValid(Object.create(null)) || !scalars.object.isValid({})) fails.push("object rejects a plain object");
if (scalars.enum.validate("x") !== "x") fails.push('enum.validate("x") did not return "x"');
if (scalars.float64.validate(3) !== 3) fails.push("float64.validate(3) did not return 3");

// The loop used where String.prototype.isWellFormed is missing (Node < 20, Safari < 16.4) agrees with it.
const loop: (s: string) => boolean = (Scalar as any).wellFormedLoop;
for (const s of ["a\ud800b", "\udfff", "\ude00\ud83d", "x\udbff", "😀", "😀é", "", "abc"]) {
    if (loop(s) !== s.isWellFormed()) fails.push(`wellFormedLoop(${show(s)}) is ${loop(s)}`);
}
// The check runs before remove_spaces, which would otherwise join the two halves of a pair.
const joiner = new Scalar({ name: "probe", label: "", hint: "", error: "", details: "", level: "", primitive: "string", aliases: [], examples: { valid: [], invalid: [] }, kind: "text", steps: ["trim", "remove_spaces"] });
if (joiner.isValid("\ud83d \ude00")) fails.push("remove_spaces joined a lone surrogate pair into valid text");

let slowest = { ms: 0, type: "" };
for (const c of cases.hostile) {
    const t = get(c.type);
    if (t === undefined) continue;
    const text = c.prefix + c.repeat.repeat(c.count) + c.suffix;
    const start = performance.now();
    const ok = t.isValid(text);
    const ms = performance.now() - start;
    if (ms > slowest.ms) slowest = { ms, type: c.type };
    if (ok !== c.ok) fails.push(`hostile ${c.type}: want ${c.ok}`);
    if (ms >= 2000) fails.push(`hostile ${c.type} took ${ms.toFixed(0)} ms`);
}

const { Models, ModelError, ModelsError } = mod;
if (Models?.catalogue !== undefined) fails.push("the models catalogue was built at import");

/** JSON text with sorted keys, so two shapes compare exactly whatever their key order. */
function canon(v: unknown): string {
    if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
    if (typeof v === "object" && v !== null) {
        return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`).join(",")}}`;
    }
    return JSON.stringify(v);
}
const joined = (problems: readonly any[]) => problems.map((p) => `${p.pointer}: ${p.message}`).join("; ");

/** Loads a models file: the Models, or the ModelsError it threw. Anything else thrown is a bug and propagates. */
function load(data: unknown): { models?: any; error?: any } {
    try {
        return { models: scalars.models(data) };
    } catch (e) {
        if (!(e instanceof ModelsError)) throw e;
        return { error: e };
    }
}

const loadCases: Record<string, any> = Object.fromEntries(cases.models.load.map((c: any) => [c.name, c]));
for (const c of cases.models.load) {
    const { models, error } = load(c.data);
    if (error) {
        if (c.ok) fails.push(`models.load ${c.name}: refused: ${error.message}`);
        else if (canon(error.problems) !== canon(c.problems)) fails.push(`models.load ${c.name}: problems ${canon(error.problems)}, want ${canon(c.problems)}`);
        else if (!(error instanceof Error) || !Array.isArray(error.problems)) fails.push(`models.load ${c.name}: ModelsError is not an Error with a list of problems`);
        else if (error.message !== joined(error.problems)) fails.push(`models.load ${c.name}: ModelsError message is ${show(error.message)}`);
        continue;
    }
    if (!c.ok) fails.push(`models.load ${c.name}: loaded, want problems ${canon(c.problems)}`);
    else if (canon(models.all) !== canon(c.all)) fails.push(`models.load ${c.name}: all ${canon(models.all)}, want ${canon(c.all)}`);
}

function modelOf(c: any): any {
    const { models, error } = load(loadCases[c.load].data);
    if (error) {
        fails.push(`${c.name}: load case ${show(c.load)} must load: ${error.message}`);
        return undefined;
    }
    const m = models.get(c.model);
    if (m === undefined) fails.push(`${c.name}: no model ${show(c.model)}`);
    else if (m.name !== c.model) fails.push(`${c.name}: model name ${show(m.name)}`);
    return m;
}

for (const c of cases.models.validate) {
    const m = modelOf(c);
    if (m === undefined) continue;
    try {
        const out = m.validate(c.in);
        if (!c.ok) fails.push(`models.validate ${c.name}: passed, want problems ${canon(c.problems)}`);
        else if (canon(out) !== canon(c.out)) fails.push(`models.validate ${c.name}: out ${canon(out)}, want ${canon(c.out)}`);
    } catch (e: any) {
        if (!(e instanceof ModelError)) throw e;
        if (c.ok) fails.push(`models.validate ${c.name}: refused: ${e.message}`);
        else if (canon(e.problems) !== canon(c.problems)) fails.push(`models.validate ${c.name}: problems ${canon(e.problems)}, want ${canon(c.problems)}`);
        else if (!(e instanceof Error) || e.message !== joined(e.problems)) fails.push(`models.validate ${c.name}: ModelError is not an Error joining its problems`);
    }
    if (m.isValid(c.in) !== c.ok) fails.push(`models.validate ${c.name}: isValid disagrees with ok`);
}
// A field named like an Object.prototype member is looked up as an own key: missing, it's required, not inherited.
const protoModel = scalars.models({ app: { p: { constructor: "string" } } }).get("app:p");
try {
    protoModel.validate({});
    fails.push("models: a missing constructor field passed");
} catch (e: any) {
    if (!(e instanceof ModelError) || canon(e.problems.map((p: any) => [p.pointer, p.code])) !== canon([["/constructor", "required"]])) {
        fails.push(`models: a missing constructor field gave ${e instanceof ModelError ? canon(e.problems) : e}`);
    }
}
if (({} as any).polluted !== undefined || Object.prototype.hasOwnProperty.call(Object.prototype, "polluted")) fails.push("a payload changed Object.prototype");

// get takes the exact full name only, and the loaded settings never alias the caller's data.
const specModels = scalars.models(loadCases.ok_spec_example.data);
for (const name of ["order", "shop:Order", "constructor", "__proto__", "toString", 3, null]) {
    if (specModels.get(name) !== undefined) fails.push(`models.get(${show(name)}) found a model`);
}
const owned = { app: { a: { s: { type: "enum", values: ["x", "y"] } } } };
const ownedModel = scalars.models(owned).get("app:a");
owned.app.a.s.values[0] = "w";
owned.app.a.s.values.push("z");
if (!ownedModel.isValid({ s: "x" }) || ownedModel.isValid({ s: "z" })) fails.push("loaded settings alias the caller's values");

const ADDRESS = { street: "a", country: "US" };
const HOSTILE: Record<string, (n: number) => unknown> = {
    wide_list: (n) => ({ bill_to: { ...ADDRESS }, items: Array.from({ length: n }, () => ({ sku: "0614141000036", qty: 1 })), status: "draft" }),
    many_unknown: (n) => ({ ...ADDRESS, ...Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${i}`, 1])) }),
    long_decimal: (n) => ({ to: { ...ADDRESS }, status: "draft", total: "1" + "0".repeat(n) }),
    ref_chain: (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`f${i}`, "a"])),
};
const HOSTILE_MODELS: Record<string, (n: number) => unknown> = {
    ref_chain: (n) => ({ app: { c: { ...Object.fromEntries(Array.from({ length: n - 1 }, (_, i) => [`f${i}`, `c.f${i + 1}`])), [`f${n - 1}`]: "string" } } }),
};
let modelsSlowest = { ms: 0, kind: "" };
for (const c of cases.models.hostile) {
    if (!Object.hasOwn(HOSTILE, c.kind)) {
        fails.push(`models.hostile: unknown kind ${show(c.kind)}`);
        continue;
    }
    const data = "load" in c ? loadCases[c.load].data : HOSTILE_MODELS[c.kind](c.count);
    const payload = HOSTILE[c.kind](c.count);
    const start = performance.now(); // load and validate
    const { models, error } = load(data);
    if (error) {
        fails.push(`models.hostile ${c.kind}: refused at load: ${error.message.slice(0, 200)}`);
        continue;
    }
    const m = models.get(c.model);
    if (m === undefined) {
        fails.push(`models.hostile ${c.kind}: no model ${show(c.model)}`);
        continue;
    }
    let problems: any[] | undefined;
    try {
        m.validate(payload);
    } catch (e) {
        if (!(e instanceof ModelError)) throw e;
        problems = e.problems;
    }
    const ms = performance.now() - start;
    if (ms > modelsSlowest.ms) modelsSlowest = { ms, kind: c.kind };
    if ((problems === undefined) !== c.ok) fails.push(`models.hostile ${c.kind}: want ok ${c.ok}`);
    else if (problems !== undefined && (problems.length !== c.problem_count || problems[0].code !== c.code || problems[0].pointer !== c.pointer)) {
        fails.push(`models.hostile ${c.kind}: ${problems.length} problems, first ${problems[0].code} at ${show(problems[0].pointer)}`);
    }
    if (ms >= 2000) fails.push(`models.hostile ${c.kind} took ${ms.toFixed(0)} ms`);
}

console.log(fails.length ? fails.join("\n") : `ts: ok, ${Object.keys(types).length} types, slowest hostile ${slowest.type} ${slowest.ms.toFixed(1)} ms, slowest models hostile ${modelsSlowest.kind} ${modelsSlowest.ms.toFixed(1)} ms`);
process.exit(fails.length ? 1 : 0);
