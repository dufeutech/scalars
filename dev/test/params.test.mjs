// Type parameters live in the core, so every target and language reads them from one place.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "../build.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { scalars } = build(root);
const { types, $meta } = scalars;

test("params are defined once in $meta", () => {
    assert.deepEqual(Object.keys($meta.params).sort(), ["fractional_seconds", "length", "nullable", "precision", "scale", "values"]);
    for (const [name, def] of Object.entries($meta.params)) {
        assert.ok(def.type && def.description, `${name} has type and description`);
        assert.ok(!("sql" in def), `${name} carries no Postgres spelling`);
    }
});

test("each type lists only names that $meta defines", () => {
    for (const t of Object.values(types)) {
        for (const p of t.params ?? []) assert.ok($meta.params[p], `${t.name}.params names unknown "${p}"`);
        for (const a of t.postgres.attr ?? []) assert.ok($meta.postgres_attrs[a], `${t.name}.postgres.attr names unknown "${a}"`);
        assert.ok(!(t.params ?? []).includes("nullable"), `${t.name}: nullable applies to every type and is not listed`);
    }
});

test("params land on the right types", () => {
    const by = {};
    for (const t of Object.values(types)) if (t.params) by[t.name] = t.params;
    assert.deepEqual(by, {
        string: ["length"],
        decimal: ["precision", "scale"], decimal128: ["precision", "scale"], sf_decimal: ["precision", "scale"], uint64: ["precision", "scale"],
        time_local: ["fractional_seconds"], time: ["fractional_seconds"], date_time: ["fractional_seconds"],
        date_time_local: ["fractional_seconds"], http_date: ["fractional_seconds"], duration: ["fractional_seconds"],
        enum: ["values"],
    });
});

test("only Postgres-only attrs stay under postgres", () => {
    assert.deepEqual(Object.keys($meta.postgres_attrs).sort(), ["collation", "fields", "name"]);
    assert.equal($meta.postgres_attrs.collation.sql, 'COLLATE "und-x-icu"');
    const withAttr = Object.fromEntries(Object.values(types).filter((t) => t.postgres.attr).map((t) => [t.name, t.postgres.attr]));
    assert.deepEqual(withAttr, { enum: ["name"], duration: ["fields"] });
});

test("enum values reach HTML without reading postgres", () => {
    assert.equal(types.enum.html.element, "select");
    assert.equal(types.enum.html.options, undefined);
    assert.ok(!JSON.stringify(scalars).includes("postgres.attr"), "no target points into another target");
});
