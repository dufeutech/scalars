import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyGenerated, htmlPattern, pgCheck, sqlString, toJsonSchema } from "../lib/derive.mjs";
import { loadSources, resolve } from "../lib/resolve.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const mini = () => resolve(loadSources(path.join(here, "fixtures/mini")));

test("v-flag safe", () => {
    const patterns = [
        "^[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+(;.*)?$",
        "^10\\.\\d{4,9}/[-._;()/:A-Za-z0-9]+$",
        "^[A-Za-z*][A-Za-z0-9:/!#$%&'*+\\-.^_`|~]*$",
        "^(/([^~/]|~[01])*)*$",
        "^(?=.{1,253}$)[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$",
    ];
    const inputs = ["text/html", "a-b", "a|b", "10.1234/x(y)", "/a~1b", "", "#x", "a*b", "-a", "a-", "x/y;q=1"];
    for (const p of patterns) {
        let re;
        assert.doesNotThrow(() => { re = new RegExp("^(?:" + htmlPattern(p) + ")$", "v"); }, p);
        const js = new RegExp(p, "u");
        for (const s of inputs) assert.equal(re.test(s), js.test(s), `${p} on ${JSON.stringify(s)}`);
    }
});

test("html pattern keeps negated classes and ranges", () => {
    const v = (p) => new RegExp("^(?:" + htmlPattern(p) + ")$", "v");
    assert.ok(v("^[^~/]$").test("a") && !v("^[^~/]$").test("/") && !v("^[^~/]$").test("~"));
    assert.ok(v("^[a-z0-9-]$").test("-") && v("^[a-z0-9-]$").test("q") && !v("^[a-z0-9-]$").test("A"));
    assert.ok(!htmlPattern("^abc$").startsWith("^") && !htmlPattern("^abc$").endsWith("$"));
});

test("a pattern that is not linear fails the build", () => {
    assert.throws(() => applyGenerated({ name: "x", pattern: "^(a+)+$" }), /^Error: Type "x" pattern is not linear: /);
});

test("quote escaped", () => {
    assert.equal(sqlString("a'b"), "'a''b'");
});

test("regex check for text columns", () => {
    const t = { pattern: "^[a-z]+$", postgres: { type: "text" } };
    assert.equal(pgCheck(t), "CHECK ({column} ~ '^[a-z]+$')");
    assert.equal(pgCheck({ pattern: "^x$", postgres: { type: "uuid" } }), null, "native types validate themselves");
});

test("range check only when narrower", () => {
    const int8 = { type: "integer", minimum: -128, maximum: 127, postgres: { type: "smallint" } };
    const int32 = { type: "integer", minimum: -2147483648, maximum: 2147483647, postgres: { type: "integer" } };
    assert.equal(pgCheck(int8), "CHECK ({column} BETWEEN -128 AND 127)");
    assert.equal(pgCheck(int32), null);
});

test("a hand-written check replaces the generated one", () => {
    const r = resolve((() => {
        const s = loadSources(path.join(here, "fixtures/mini"));
        s.targets.postgres.slug = { check: "CHECK (length({column}) < 9)" };
        return s;
    })());
    assert.equal(r.slug.postgres.check, "CHECK (length({column}) < 9)");
});

test("override drives check and html pattern", () => {
    const r = mini();
    assert.ok(r.slug.postgres.check.includes(r.slug.pattern.replaceAll("'", "''")));
    assert.equal(r.uuid.postgres.check, undefined, "uuid column validates itself");
    assert.equal(r.uuid_v7.html.attrs.pattern, htmlPattern(r.uuid_v7.pattern));
    assert.notEqual(r.uuid_v7.html.attrs.pattern, r.uuid.html.attrs.pattern);
});

test("html pattern only on text-like inputs", () => {
    const r = mini();
    assert.ok(r.slug.html.attrs.pattern);
    const s = loadSources(path.join(here, "fixtures/mini"));
    s.targets.html.slug = { attrs: { type: "color" } };
    assert.equal(resolve(s).slug.html.attrs.pattern, undefined);
});

test("json schema strips extras", () => {
    const js = toJsonSchema({ ...mini().slug, label: "Slug", hint: "a-b", examples: { valid: ["a-b"], invalid: ["A"] }, normalize: ["trim"] });
    for (const k of ["level", "html", "postgres", "normalize", "name", "primitive"]) assert.ok(!(k in js), k);
    assert.equal(js.type, "string");
    assert.equal(js.pattern, mini().slug.pattern);
    assert.equal(js.title, "Slug");
    assert.equal(js.description, "a-b");
    assert.deepEqual(js.examples, ["a-b"]);
});
