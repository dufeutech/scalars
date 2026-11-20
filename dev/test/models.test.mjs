// The reference models loader passes the shared load cases every language runner checks (dev/langs/cases.json).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "../build.mjs";
import { loadModels, problem, sortProblems } from "../lib/models.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { scalars } = build(root);
const cases = JSON.parse(fs.readFileSync(path.join(root, "dev/langs/cases.json"), "utf8"));
const caseNamed = (name) => cases.models.load.find((c) => c.name === name);

test("load cases", () => {
    for (const c of cases.models.load) {
        const r = loadModels(c.data, scalars);
        assert.equal(r.ok, c.ok, `${c.name}: ${JSON.stringify(r.problems ?? r.models?.all)}`);
        if (c.ok) assert.deepEqual(r.models.all, c.all, c.name);
        else assert.deepEqual(r.problems, c.problems, c.name);
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

test("a 20,000-deep items chain loads, and a problem at its bottom has the full pointer", () => {
    const nest = (leaf) => { let def = leaf; for (let i = 0; i < 20000; i++) def = { type: "array", items: def }; return def; };
    const r = loadModels({ app: { a: { x: nest("string"), y: "a.x" } } }, scalars);
    assert.equal(r.ok, true);
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

test("sortProblems orders by decoded segments", () => {
    const at = (...segments) => problem(segments, "required", {}, scalars.$meta);
    const sorted = sortProblems([
        at("😀"), at("￿"), at("a", 10), at("a", 9), at("a"), at("b~"), at("b/"), at("10"), at("9"),
    ]).map((p) => p.pointer);
    assert.deepEqual(sorted, ["/10", "/9", "/a", "/a/9", "/a/10", "/b~1", "/b~0", "/￿", "/😀"]);
});
