import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "../build.mjs";
import { toModel, identifiers } from "../codegen/model.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { scalars } = build(root);

test("model: email", () => {
    const m = toModel(scalars).find((t) => t.name === "email");
    assert.deepEqual([m.kind, m.steps, m.minLen, m.maxLen], ["text", ["trim"], 5, null]);
});

test("model: lengths come from schema and pattern", () => {
    const by = Object.fromEntries(toModel(scalars).map((t) => [t.name, t]));
    assert.deepEqual([by.uuid.minLen, by.uuid.maxLen], [36, 36]);
    assert.deepEqual([by.hostname.minLen, by.hostname.maxLen], [1, 253]);
    assert.deepEqual([by.char.minLen, by.char.maxLen], [1, 1]);
    assert.deepEqual([by.int32.kind, by.int32.minimum, by.int32.maximum], ["integer", -2147483648, 2147483647]);
    assert.equal(by.any.kind, "any");
});

test("identifiers", () => {
    const go = identifiers(toModel(scalars), "go", []);
    assert.equal(go.get("uuid_v7"), "UuidV7");
    assert.equal(identifiers(toModel(scalars), "rust", []).get("uuid_v7"), "UUID_V7");
    for (const lang of ["ts", "python"]) assert.equal(identifiers(toModel(scalars), lang, []).get("uuid_v7"), "uuid_v7");
    assert.throws(() => identifiers(toModel(scalars), "go", ["Email"]), /Identifier "Email" is used by/);
});
