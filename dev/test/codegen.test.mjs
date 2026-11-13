import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build, serialize } from "../build.mjs";
import { emitGo, RESERVED_GO } from "../codegen/go.mjs";
import { emitRust, RESERVED_RUST } from "../codegen/rust.mjs";
import { RESERVED_PY } from "../codegen/python.mjs";
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

test("model: catalogue order", () => {
    const names = toModel(scalars).map((t) => t.name);
    assert.deepEqual(names, Object.keys(JSON.parse(serialize(scalars)).types));
});

test("go: patterns, reserved names, static table", () => {
    const go = emitGo(toModel(scalars), scalars.version)["go/scalars.go"];
    assert.match(go, /^\/\/ Code generated .* DO NOT EDIT\.$/m);
    const token = scalars.types.sf_token.schema.pattern;
    assert.ok(token.includes("`") && go.includes(`\tpattern: ${JSON.stringify(token)},\n`), "sf_token's backtick forces an interpreted string");
    assert.ok(go.includes(`\tpattern: \`${scalars.types.email.schema.pattern}\`,\n`), "other patterns are raw strings");
    assert.ok(go.includes("\tsteps:   []step{stepTrim, stepLowercase},\n"), "steps are constants");
    assert.ok(!go.includes("map[string]any{"), "no map literal in the table");
    const snake = (id) => id.replace(/[A-Z]/g, (c, i) => (i ? "_" : "") + c.toLowerCase()); // "ScalarError" -> "scalar_error"
    for (const id of RESERVED_GO) assert.throws(() => identifiers([{ name: snake(id) }], "go", RESERVED_GO), /reserved/);
});

test("rust: patterns, reserved names, static table", () => {
    const rs = emitRust(toModel(scalars), scalars.version)["rust/scalars.rs"];
    assert.match(rs, /^\/\/ Code generated .* DO NOT EDIT\.$/m);
    assert.ok(rs.includes(`    pattern: Some(r"${scalars.types.email.schema.pattern}"),\n`), "patterns are raw strings");
    assert.ok(rs.includes("    steps: &[Step::Trim, Step::Lowercase],\n"), "steps are variants");
    assert.ok(rs.includes("    re: OnceLock::new(),\n"), "the regex waits for first use");
    const probe = { name: "probe", label: "L", hint: "H", error: "E", details: "", level: "core", primitive: "string", aliases: [], kind: "text", steps: [], minLen: 0, maxLen: null };
    const quoted = emitRust([{ ...probe, pattern: 'a"#b\\"c' }], "0")["rust/scalars.rs"];
    assert.ok(quoted.includes(`pattern: Some(r##"a"#b\\"c"##),`), "a pattern holding \"# takes more hashes");
    const label = emitRust([{ ...probe, pattern: null, label: "a\r\u0007\"\\" }], "0")["rust/scalars.rs"];
    assert.ok(label.includes(`label: "a\\r\\u{7}\\"\\\\",`), "string literals escape what Rust can't hold");
    const upper = RESERVED_RUST.filter((id) => id === id.toUpperCase()); // only these can meet a SCREAMING_SNAKE type
    for (const id of upper) assert.throws(() => identifiers([{ name: id.toLowerCase() }], "rust", RESERVED_RUST), /reserved/);
});

test("python: keywords and annotation builtins are reserved", () => {
    for (const name of ["class", "import", "lambda", "str", "int", "dict"]) {
        assert.throws(() => identifiers([{ name }], "python", RESERVED_PY), /reserved/, name);
    }
});

test("go and rust: a lone surrogate in a raw-string pattern fails the build", () => {
    const probe = { name: "probe", label: "L", hint: "H", error: "E", details: "", level: "core", primitive: "string", aliases: [],
        examples: { valid: [], invalid: [] }, kind: "text", steps: [], minLen: 0, maxLen: null, minimum: null, maximum: null };
    const bad = [{ ...probe, pattern: `^a${String.fromCharCode(0xd800)}$` }];
    assert.throws(() => emitGo(bad, "0"), /Lone surrogate/);
    assert.throws(() => emitRust(bad, "0"), /Lone surrogate/);
    const good = [{ ...probe, pattern: "^a\u{1F600}$" }];
    assert.doesNotThrow(() => emitGo(good, "0"));
    assert.doesNotThrow(() => emitRust(good, "0"));
});
