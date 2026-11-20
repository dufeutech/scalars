// The reference models loader passes the shared load cases every language runner checks (dev/langs/cases.json).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "../build.mjs";
import { fitsNumeric, isValidModel, loadModels, problem, sortProblems, validateModel } from "../lib/models.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { scalars } = build(root);
const cases = JSON.parse(fs.readFileSync(path.join(root, "dev/langs/cases.json"), "utf8"));
const caseNamed = (name) => cases.models.load.find((c) => c.name === name);

test("load cases", async (t) => {
    for (const c of cases.models.load) {
        await t.test(c.name, () => {
            const r = loadModels(c.data, scalars);
            assert.equal(r.ok, c.ok, JSON.stringify(r.problems ?? r.models?.all));
            if (c.ok) assert.deepEqual(r.models.all, c.all);
            else assert.deepEqual(r.problems, c.problems);
        });
    }
});

test("load case names are unique", () => {
    const names = cases.models.load.map((c) => c.name);
    assert.deepEqual(names, [...new Set(names)]);
});

test("get takes the exact full name only", () => {
    const { models } = loadModels(caseNamed("ok_spec_example").data, scalars);
    assert.ok(models.get("shop:order"));
    assert.equal(models.get("shop:order").name, "shop:order");
    assert.equal(models.get("order"), null);
    assert.equal(models.get("shop:Order"), null);
    assert.equal(models.get("constructor"), null);
});

test("fields resolve where they are written", () => {
    const { models } = loadModels(caseNamed("ok_spec_example").data, scalars);
    const order = models.get("shop:order").fields;
    assert.deepEqual(order.get("bill_to"), { kind: "model", model: "billing:address", nullable: false });
    assert.deepEqual(order.get("items"), { kind: "array", items: { kind: "model", model: "shop:line_item", nullable: false }, nullable: false });
    assert.deepEqual(order.get("status"), { kind: "type", type: "enum", settings: { values: ["draft", "sent", "paid"] }, nullable: false });
    const copied = loadModels(caseNamed("copied_ref_home_domain").data, scalars).models;
    assert.deepEqual(copied.get("shop:order").fields.get("x"), { kind: "model", model: "billing:address", nullable: false });
    const over = loadModels(caseNamed("override_setting").data, scalars).models;
    assert.deepEqual(over.get("shop:order").fields.get("n"), { kind: "type", type: "text", settings: {}, nullable: false });
    assert.equal(over.get("billing:invoice").fields.get("note").nullable, true);
});

test("a 5,000-long field-reference chain loads without recursion", () => {
    const user = {};
    for (let i = 0; i < 5000; i++) user[`f${i}`] = `user.f${i + 1}`;
    user.f5000 = "string";
    const r = loadModels({ app: { user } }, scalars);
    assert.equal(r.ok, true);
    assert.equal(r.models.get("app:user").fields.get("f0").type, "string");
});

test("a 20,000-deep items chain is refused at each field holding it, and a problem at its bottom has the full pointer", () => {
    const nest = (leaf) => { let def = leaf; for (let i = 0; i < 20000; i++) def = { type: "array", items: def }; return def; };
    const r = loadModels({ app: { a: { x: nest("string"), y: "a.x" } } }, scalars);
    assert.deepEqual(r.problems.map((p) => [p.pointer, p.code]), [["/app/a/x", "too_deep"], ["/app/a/y", "too_deep"]]);
    const bad = loadModels({ app: { a: { x: nest("nope") } } }, scalars);
    assert.deepEqual(bad.problems.map((p) => p.pointer), ["/app/a/x" + "/items".repeat(20000)]);
});

test("a 5,000-long model chain is refused once, at the outermost model", () => {
    const app = {};
    for (let i = 0; i < 5000; i++) app[`m${i}`] = { n: `m${i + 1}` };
    app.m5000 = { n: "string" };
    const r = loadModels({ app }, scalars);
    assert.deepEqual(r.problems.map((p) => p.pointer), ["/app/m0/n"]);
});

test("problem renders the pointer and the message", () => {
    const p = problem(["a/b~c", 2], "alias", { canonical: "decimal" }, scalars.$meta);
    assert.deepEqual(p, { pointer: "/a~1b~0c/2", code: "alias", params: { canonical: "decimal" }, message: 'This is an alias; write "decimal".' });
    assert.equal(problem([], "not_object", {}, scalars.$meta).pointer, "");
    assert.equal(problem(["x"], "not_allowed", { values: ["a", "b"] }, scalars.$meta).message, "Must be one of: a, b.");
    assert.equal(problem(["x"], "too_long", { max: 10 }, scalars.$meta).message, "At most 10 characters.");
});

test("problem takes the message for a code without a template, and only then", () => {
    const p = problem(["n"], "invalid", { type: "int32" }, scalars.$meta, "Use a whole number.");
    assert.deepEqual(p, { pointer: "/n", code: "invalid", params: { type: "int32" }, message: "Use a whole number." });
    assert.throws(() => problem(["n"], "invalid", { type: "int32" }, scalars.$meta), /needs a message/);
    assert.equal(problem(["n"], "required", {}, scalars.$meta, "ignored").message, "Required.");
    assert.throws(() => problem(["n"], "too_long", {}, scalars.$meta), /needs param "max"/);
});

test("sortProblems refuses problems not built with problem()", () => {
    const fake = { pointer: "/a", code: "required", params: {}, message: "Required." };
    assert.throws(() => sortProblems([fake, problem(["b"], "required", {}, scalars.$meta)]), /problem\(\)/);
});

test("sortProblems orders by decoded segments", () => {
    const at = (...segments) => problem(segments, "required", {}, scalars.$meta);
    const sorted = sortProblems([
        at("😀"), at("￿"), at("a", 10), at("a", 9), at("a"), at("b~"), at("b/"), at("10"), at("9"),
    ]).map((p) => p.pointer);
    assert.deepEqual(sorted, ["/10", "/9", "/a", "/a/9", "/a/10", "/b~1", "/b~0", "/￿", "/😀"]);
});

const modelOfCase = (c) => {
    const r = loadModels(caseNamed(c.load).data, scalars);
    assert.equal(r.ok, true, `${c.name}: load case "${c.load}" must load`);
    const m = r.models.get(c.model);
    assert.ok(m, `${c.name}: no model "${c.model}"`);
    return m;
};

test("validate cases", async (t) => {
    for (const c of cases.models.validate) {
        await t.test(c.name, () => {
            const m = modelOfCase(c);
            const r = validateModel(m, c.in);
            assert.equal(r.ok, c.ok, JSON.stringify(r.problems ?? r.value));
            if (c.ok) assert.deepEqual(r.value, c.out);
            else assert.deepEqual(r.problems, c.problems);
            assert.equal(isValidModel(m, c.in), c.ok, "is_valid agrees with ok");
        });
    }
});

test("validate case names are unique", () => {
    const names = cases.models.validate.map((c) => c.name);
    assert.deepEqual(names, [...new Set(names)]);
});

test("a payload __proto__ key never reaches the output, and a field named constructor is an own key", () => {
    const m = modelOfCase({ name: "proto", load: "proto_model", model: "app:p" });
    const r = validateModel(m, JSON.parse('{"constructor":"a"}'));
    assert.equal(Object.getPrototypeOf(r.value), Object.prototype);
    assert.ok(Object.hasOwn(r.value, "constructor"));
    const bad = validateModel(m, JSON.parse('{"constructor":"a","__proto__":{"polluted":true}}'));
    assert.deepEqual(bad.problems.map((p) => p.pointer), ["/__proto__"]);
    assert.equal({}.polluted, undefined);
});

/** The hostile model payloads, built as every runner builds them from a case's kind and count. */
const ADDRESS = { street: "a", country: "US" };
const HOSTILE = {
    wide_list: (n) => ({ bill_to: ADDRESS, items: Array.from({ length: n }, () => ({ sku: "0614141000036", qty: 1 })), status: "draft" }),
    many_unknown: (n) => { const p = { ...ADDRESS }; for (let i = 0; i < n; i++) p[`k${i}`] = 1; return p; },
    long_decimal: (n) => ({ to: ADDRESS, status: "draft", total: "1" + "0".repeat(n) }),
    ref_chain: (n) => { const p = {}; for (let i = 0; i < n; i++) p[`f${i}`] = "a"; return p; },
};
/** Hostile kinds without a load case build their models file from the count. */
const HOSTILE_MODELS = {
    ref_chain: (n) => { const c = {}; for (let i = 0; i < n - 1; i++) c[`f${i}`] = `c.f${i + 1}`; c[`f${n - 1}`] = "string"; return { app: { c } }; },
};

test("hostile model cases", async (t) => {
    assert.deepEqual(cases.models.hostile.map((c) => c.kind).sort(), Object.keys(HOSTILE).sort());
    for (const c of cases.models.hostile) {
        await t.test(c.kind, () => {
            const data = c.load ? caseNamed(c.load).data : HOSTILE_MODELS[c.kind](c.count);
            const payload = HOSTILE[c.kind](c.count);
            const start = performance.now(); // load and validate
            const loaded = loadModels(data, scalars);
            assert.equal(loaded.ok, true);
            const r = validateModel(loaded.models.get(c.model), payload);
            const ms = performance.now() - start;
            assert.equal(r.ok, c.ok, c.kind);
            if (!c.ok) assert.equal(r.problems.length, c.problems);
            assert.ok(ms < 2000, `${c.kind} took ${Math.round(ms)} ms`);
        });
    }
});

/** numeric(p, s) by exact arithmetic: round half away from zero to s digits, then |R| < 10^p. */
function fitsByBigInt(text, p, s) {
    const neg = text[0] === "-";
    const [i, f = ""] = (neg ? text.slice(1) : text).split(".");
    let digits = BigInt(i + f); // value = digits / 10^f.length
    const shift = s - f.length; // R = round(digits * 10^shift)
    let r;
    if (shift >= 0) r = digits * 10n ** BigInt(shift);
    else {
        const d = 10n ** BigInt(-shift);
        r = digits / d;
        if ((digits % d) * 2n >= d) r += 1n;
    }
    return r < 10n ** BigInt(p);
}

test("fitsNumeric agrees with exact arithmetic", () => {
    let seed = 7;
    const rand = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    const pick = "0000059999123456789";
    for (let k = 0; k < 20000; k++) {
        let t = rand(3) === 0 ? "-" : "";
        const il = 1 + rand(6);
        for (let i = 0; i < il; i++) t += pick[rand(pick.length)];
        if (rand(2)) { t += "."; const fl = 1 + rand(6); for (let i = 0; i < fl; i++) t += pick[rand(pick.length)]; }
        const p = 1 + rand(6);
        const s = rand(13) - 6;
        assert.equal(fitsNumeric(t, p, s), fitsByBigInt(t, p, s), `${t} numeric(${p}, ${s})`);
    }
});
