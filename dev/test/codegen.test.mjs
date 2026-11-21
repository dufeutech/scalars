import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build, serialize } from "../build.mjs";
import { emitGo, goPattern, RESERVED_GO } from "../codegen/go.mjs";
import { emitRust, RESERVED_RUST } from "../codegen/rust.mjs";
import { RESERVED_PY } from "../codegen/python.mjs";
import { toModel, modelOf, paramRules, identifiers, metaFields, pascal, styled } from "../codegen/model.mjs";
import * as common from "../codegen/common.mjs";
import { emitPython } from "../codegen/python.mjs";

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

/**
 * Package-level Go vars initialised with a map literal or make(...), code that would run at program start: a single
 * `var x = map...` or `var x map[K]V = map...`, or a `name ... = map...` line inside a `var ( ... )` block.
 */
function packageMaps(go) {
    const found = [];
    const builds = /=\s*(?:map\[|make\()/;
    let inBlock = false;
    for (const line of go.split("\n")) {
        if (inBlock) {
            if (line === ")") inBlock = false;
            else if (/^\t\w+\b/.test(line) && builds.test(line)) found.push(line);
        } else if (line === "var (") inBlock = true;
        else if (/^var \w+\b/.test(line) && builds.test(line)) found.push(line);
    }
    return found;
}

test("go: the package-level map guard sees every form", () => {
    for (const plant of ["var x = map[string]int{}", "var x map[string]int = map[string]int{}", "var (\n\ty = 1\n\tx = map[string]int{}\n)",
        "var (\n\tx map[string]int = make(map[string]int)\n)"]) {
        assert.equal(packageMaps(`package p\n\n${plant}\n`).length, 1, plant);
    }
    assert.deepEqual(packageMaps("package p\n\nvar (\n\tx map[string]int\n)\n\nfunc f() {\n\tm := map[string]int{}\n\t_ = m\n}\n"), []);
});

test("go: patterns, reserved names, static table", () => {
    const go = emitGo(toModel(scalars), scalars.version, scalars.$meta)["go/scalars.go"];
    assert.match(go, /^\/\/ Code generated .* DO NOT EDIT\.$/m);
    assert.equal(goPattern("^a`b$"), JSON.stringify("^a`b$"), "a backtick forces an interpreted string");
    assert.equal(goPattern("^ab$"), "`^ab$`", "other patterns are raw strings");
    assert.ok(go.includes(`\tpattern: \`${scalars.types.email.schema.pattern}\`,\n`), "other patterns are raw strings");
    assert.ok(go.includes("\tsteps:   []step{stepTrim, stepLowercase},\n"), "steps are constants");
    // The engine builds maps inside functions; the generated tables after it, and every package-level var, don't.
    const tables = go.indexOf("\nvar paramRules");
    assert.ok(tables >= 0, "the generated tables start at var paramRules");
    assert.ok(!go.slice(tables).includes("map[string]any{"), "no map literal in the table");
    assert.deepEqual(packageMaps(go), [], "no package-level map built at program start");
    assert.ok(go.includes(`\tlist:    []string{"AD", "AE", `), "a list is a sorted slice literal, searched by binary search");
    const snake = (id) => id.replace(/[A-Z]/g, (c, i) => (i ? "_" : "") + c.toLowerCase()); // "ScalarError" -> "scalar_error"
    for (const id of RESERVED_GO) assert.throws(() => identifiers([{ name: snake(id) }], "go", RESERVED_GO), /reserved/);
});

test("rust: patterns, reserved names, static table", () => {
    const rs = emitRust(toModel(scalars), scalars.version, scalars.$meta)["rust/scalars.rs"];
    assert.match(rs, /^\/\/ Code generated .* DO NOT EDIT\.$/m);
    assert.ok(rs.includes(`    pattern: Some(r"${scalars.types.email.schema.pattern}"),\n`), "patterns are raw strings");
    assert.ok(rs.includes("    steps: &[Step::Trim, Step::Lowercase],\n"), "steps are variants");
    assert.ok(rs.includes("    re: OnceLock::new(),\n"), "the regex waits for first use");
    const probe = { name: "probe", label: "L", hint: "H", error: "E", details: "", level: "core", primitive: "string", aliases: [], params: [], kind: "text", steps: [], check: null, minLen: 0, maxLen: null };
    const quoted = emitRust([{ ...probe, pattern: 'a"#b\\"c' }], "0", scalars.$meta)["rust/scalars.rs"];
    assert.ok(quoted.includes(`pattern: Some(r##"a"#b\\"c"##),`), "a pattern holding \"# takes more hashes");
    const label = emitRust([{ ...probe, pattern: null, label: "a\r\u0007\"\\" }], "0", scalars.$meta)["rust/scalars.rs"];
    assert.ok(label.includes(`label: "a\\r\\u{7}\\"\\\\",`), "string literals escape what Rust can't hold");
    const country = rs.slice(rs.indexOf("pub static COUNTRY: Text"), rs.indexOf("};\n", rs.indexOf("pub static COUNTRY: Text")));
    assert.ok(country.includes(`    list: &[\n        "AD",\n        "AE",\n`), "a list is a static slice, one code per line");
    assert.ok(rs.includes("    list: &[],\n"), "a text type without a list has an empty slice");
    const upper = RESERVED_RUST.filter((id) => id === id.toUpperCase()); // only these can meet a SCREAMING_SNAKE type
    for (const id of upper) assert.throws(() => identifiers([{ name: id.toLowerCase() }], "rust", RESERVED_RUST), /reserved/);
});

test("python: keywords and annotation builtins are reserved", () => {
    for (const name of ["class", "import", "lambda", "str", "int", "dict"]) {
        assert.throws(() => identifiers([{ name }], "python", RESERVED_PY), /reserved/, name);
    }
});

test("go and rust: a lone surrogate in a raw-string pattern fails the build", () => {
    const probe = { name: "probe", label: "L", hint: "H", error: "E", details: "", level: "core", primitive: "string", aliases: [], params: [],
        examples: { valid: [], invalid: [] }, kind: "text", steps: [], check: null, minLen: 0, maxLen: null, minimum: null, maximum: null };
    const bad = [{ ...probe, pattern: `^a${String.fromCharCode(0xd800)}$` }];
    assert.throws(() => emitGo(bad, "0", scalars.$meta), /Lone surrogate/);
    assert.throws(() => emitRust(bad, "0", scalars.$meta), /Lone surrogate/);
    const good = [{ ...probe, pattern: "^a\u{1F600}$" }];
    assert.doesNotThrow(() => emitGo(good, "0", scalars.$meta));
    assert.doesNotThrow(() => emitRust(good, "0", scalars.$meta));
});

test("go and rust: unknown or colliding check and step names fail the build", () => {
    const probe = { name: "probe", label: "L", hint: "H", error: "E", details: "", level: "core", primitive: "string", aliases: [], params: [],
        examples: { valid: [], invalid: [] }, kind: "text", steps: [], check: null, pattern: null, minLen: 0, maxLen: null, minimum: null, maximum: null };
    for (const [emit, file] of [[emitGo, "engine.go"], [emitRust, "engine.rs"]]) {
        const run = (extra) => emit([{ ...probe, ...extra }], "0", scalars.$meta);
        assert.throws(() => run({ check: "no_such_check" }), new RegExp(`Unknown check "no_such_check": ${file} has no`));
        assert.throws(() => run({ steps: ["no_such_step"] }), new RegExp(`Unknown step "no_such_step": ${file} has no`));
        assert.throws(() => run({ steps: ["a_b", "a__b"] }), /step names "a_b" and "a__b" both become the identifier/);
        assert.throws(() => run({ check: "x_y" }), /Unknown check/);
        assert.throws(() => emit([{ ...probe, check: "gs1_mod10" }, { ...probe, name: "p2", check: "gs1__mod10" }], "0", scalars.$meta), /check names .* both become/);
        assert.doesNotThrow(() => run({ check: "iso7064_mod11_2", steps: ["trim"] }));
    }
});

test("model: styled and pascal", () => {
    assert.equal(pascal("iso7064_mod11_2"), "Iso7064Mod112");
    assert.equal(styled("go", "gs1_mod10"), "Gs1Mod10");
    assert.throws(() => styled("xx", "a"), /Unknown language "xx"/);
});

test("model: types carry their params", () => {
    assert.deepEqual(modelOf(scalars.types.string).params, ["length"]);
    assert.deepEqual(modelOf(scalars.types.email).params, []);
});

test("paramRules: one rule per $meta.params key", () => {
    const rules = paramRules(scalars.$meta);
    assert.deepEqual(Object.keys(rules), Object.keys(scalars.$meta.params));
    assert.deepEqual(rules.scale, { kind: "integer", minimum: -1000, maximum: 1000, minItems: null, maxItemBytes: null });
    assert.equal(rules.values.minItems, 1);
    assert.equal(rules.values.maxItemBytes, 63);
    assert.deepEqual(rules.nullable, { kind: "boolean", minimum: null, maximum: null, minItems: null, maxItemBytes: null });
});

test("python: params and the two tables are emitted", () => {
    const py = emitPython(toModel(scalars), scalars.version, scalars.$meta)["python/scalars.py"];
    assert.ok(py.includes('params=("precision", "scale"),'), "decimal lists its params");
    assert.match(py, /^_PARAM_RULES: Final = \{/m);
    assert.match(py, /^_ERRORS: Final = \{/m);
    assert.ok(py.includes('"too_long": "At most {max} characters."'));
});

test("common: shared emitter helpers", () => {
    for (const name of ["fail", "header", "int64", "noLoneSurrogate", "readEngine"]) assert.equal(typeof common[name], "function", name);
    assert.throws(() => common.int64(2 ** 63, "x", "f"), /x/);
    assert.equal(common.int64(null, "x", "f"), "f");
    assert.equal(common.int64(-(2 ** 62), "x", "f"), String(-(2 ** 62)));
    assert.throws(() => common.noLoneSurrogate("\ud800"), /Lone surrogate/);
    assert.equal(common.noLoneSurrogate("a😀"), "a😀");
    assert.throws(() => common.fail("boom"), /boom/);
    assert.ok(!common.readEngine("engine.py").includes("\r"));
});

test("common: the engines' dev-only pointer comments stay out of dist", () => {
    const pointer = "emitted after this file";
    const raw = (file) => fs.readFileSync(path.join(root, "dev/codegen", file), "utf8").replaceAll("\r\n", "\n");
    const doubleBlanks = (text) => text.split("\n\n\n").length;
    for (const file of ["models.py", "models.ts", "models.go", "models.rs"]) {
        assert.ok(raw(file).includes(pointer), `${file} lost its pointer comment`);
        const engine = common.readEngine(file);
        assert.ok(!engine.includes(pointer), file);
        assert.equal(doubleBlanks(engine), doubleBlanks(raw(file)), `${file}: removing the comment left a double blank line`);
    }
    for (const [file, text] of Object.entries(build(root).code)) assert.ok(!text.includes(pointer), file);
});

test("model: metaFields lists the facts every record writes, in order", () => {
    const email = modelOf(scalars.types.email);
    assert.deepEqual(metaFields(email).map(([k]) => k), [
        "name", "label", "hint", "error", "details", "level", "primitive", "aliases", "examples", "kind",
        "steps", "pattern", "minLen",
    ]);
    // The optional facts, each written only when the type has it, always in the same order.
    const tail = (name) => metaFields(modelOf(scalars.types[name])).slice(10);
    assert.deepEqual(tail("gtin"), [
        ["steps", ["remove_spaces", "remove_hyphens"]], ["pattern", scalars.types.gtin.schema.pattern], ["check", "gs1_mod10"],
        ["minLen", 8], ["maxLen", 14],
    ]);
    assert.deepEqual(tail("int32"), [["minimum", -2147483648], ["maximum", 2147483647]]);
    assert.deepEqual(tail("decimal").map(([k]) => k), ["params", "pattern", "minLen"]);
    assert.deepEqual(tail("enum"), [["params", ["values"]]]);
});

test("common: lockedVersion reads what the runners pin, header knows each comment syntax", () => {
    assert.match(common.lockedVersion("rust/Cargo.lock", "regex"), /^[0-9]+\.[0-9]+\.[0-9]+$/);
    assert.match(common.lockedVersion("rust/Cargo.lock", "serde_json"), /^[0-9]+\.[0-9]+\.[0-9]+$/);
    assert.match(common.lockedVersion("go/go.mod", "golang.org/x/text"), /^v[0-9]+\.[0-9]+\.[0-9]+$/);
    assert.throws(() => common.lockedVersion("rust/Cargo.lock", "no_such_crate"), /pins no version of no_such_crate/);
    assert.throws(() => common.header({ file: "x.c", source: "s", version: "1", requires: "r" }), /no comment syntax for x\.c/);
    for (const file of ["a.py", "a.ts", "a.go", "a.rs"]) assert.ok(common.header({ file, source: "s", version: "1", requires: "r" }).includes("r\n"), file);
});

test("models constants are emitted once, from the reference", async () => {
    const { MAX_DEPTH, NAME, REF } = await import("../lib/models.mjs");
    const { code } = build(root);
    const has = (file, text) => assert.ok(code[file].includes(text), `${file} lacks ${text}`);
    has("ts/scalars.ts", `const MAX_DEPTH = ${MAX_DEPTH};`);
    has("ts/scalars.ts", `const NAME_PATTERN = ${JSON.stringify(NAME.source)};`);
    has("ts/scalars.ts", `const REF_PATTERN = ${JSON.stringify(REF.source)};`);
    has("python/scalars.py", `_MAX_DEPTH: Final = ${MAX_DEPTH} `);
    has("python/scalars.py", `_NAME_PATTERN: Final = ${JSON.stringify(NAME.source.slice(1, -1))}`);
    has("python/scalars.py", `_REF_PATTERN: Final = ${JSON.stringify(REF.source.slice(1, -1))}`);
    has("go/scalars.go", `const maxDepth = ${MAX_DEPTH}\n`);
    has("rust/scalars.rs", `const MAX_DEPTH: usize = ${MAX_DEPTH};`);
    // The hand-written engines define none of them, so they can't drift from the reference.
    for (const [file, defs] of [
        ["models.ts", [/const MAX_DEPTH\b/, /\[a-z\]\[a-z0-9_\]/]],
        ["models.py", [/^_MAX_DEPTH\b/m, /\[a-z\]\[a-z0-9_\]/]],
        ["models.go", [/const maxDepth\b/]],
        ["models.rs", [/const MAX_DEPTH\b/]],
    ]) {
        for (const re of defs) assert.doesNotMatch(common.readEngine(file), re, `${file} defines ${re}`);
    }
});

test("reasons are emitted from $meta.reasons, never spelled by an engine", () => {
    const names = Object.keys(scalars.$meta.reasons);
    const spelled = new RegExp(`["'](${names.join("|")})["']`);
    // engine.py's __slots__ name the public attribute `check`, which is not the reason: drop those tuples first.
    const source = (file) => common.readEngine(file).replace(/__slots__ = \([^)]*\)/g, "");
    for (const file of ["engine.ts", "engine.py", "engine.go", "engine.rs", "engine.sql", "models.ts", "models.py", "models.go", "models.rs"]) {
        assert.doesNotMatch(source(file), spelled, `${file} spells a reason`);
    }
    const { code } = build(root);
    const ts = code["ts/scalars.ts"];
    assert.match(ts, /^export const Reason = \{/m);
    for (const r of names) assert.ok(ts.includes(`    ${pascal(r)}: ${JSON.stringify(r)},\n`), `ts lacks Reason.${pascal(r)}`);
    const py = code["python/scalars.py"];
    assert.match(py, /^class Reason:/m);
    for (const r of names) assert.ok(py.includes(`    ${r.toUpperCase()}: Final = ${JSON.stringify(r)}\n`), `python lacks Reason.${r.toUpperCase()}`);
});

test("postgres: the emitter guards engine.sql's checks and quotes patterns", async () => {
    const { emitPostgres } = await import("../codegen/postgres.mjs");
    const models = toModel(scalars);
    const meta = scalars.$meta;
    assert.throws(() => emitPostgres(models, "0", { ...meta, checks: { ...meta.checks, x: "made up" } }), /engine\.sql has no scalars\.check_x/);
    const quoted = models.map((m) => (m.name === "slug" ? { ...m, pattern: "^a'b$" } : m));
    assert.ok(emitPostgres(quoted, "0", meta)["postgres/scalars.sql"].includes("v !~ '^a''b$'"));
    assert.ok(common.header({ file: "a.sql", source: "postgres.mjs", version: "0", requires: "r" }).startsWith("-- a.sql"));
});
