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
    const same = [t.name, t.label, t.hint, t.error, t.details, t.level, t.primitive, JSON.stringify(t.aliases)]
        .join("\u0000") === [name, spec.label, spec.hint, spec.error, spec.details, spec.level, spec.primitive, JSON.stringify(spec.aliases ?? [])].join("\u0000");
    if (!same) fails.push(`${name} metadata differs from dist`);
    for (const v of spec.examples.valid) if (!t.isValid(v)) fails.push(`${name} rejects valid ${show(v)}`);
    for (const v of spec.examples.invalid ?? []) {
        // Normalizing may repair an invalid example ("usa" -> "USA"), so only those may pass.
        if (t.isValid(v) && !(typeof v === "string" && t.normalize(v) !== v)) fails.push(`${name} accepts invalid ${show(v)}`);
    }
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

console.log(fails.length ? fails.join("\n") : `ts: ok, ${Object.keys(types).length} types, slowest hostile ${slowest.type} ${slowest.ms.toFixed(1)} ms`);
process.exit(fails.length ? 1 : 0);
