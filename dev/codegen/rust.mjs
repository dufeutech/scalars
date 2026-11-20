// Emits dist/rust/scalars.rs: the hand-written engine.rs followed by one generated static per type.
// Everything is written rustfmt-clean, and every static is a plain constant expression, so nothing runs at load.
import fs from "node:fs";
import { identifiers, paramRules } from "./model.mjs";

/** Upper-case names the engine defines and the statics it uses, so no type may take them. */
export const RESERVED_RUST = ["META", "ALL", "INDEX", "WS", "Kind", "lookup"];

const REGEX_VERSION = "1.13.1"; // the regex crate, the version the runner tests with
const RUST_VERSION = "1.97.0";
const ENGINE = fs.readFileSync(new URL("./engine.rs", import.meta.url), "utf8").replaceAll("\r\n", "\n");
const CHECK = { gs1_mod10: "Gs1Mod10", iso7064_mod97_10: "Mod97", iban: "Iban", isbn: "Isbn", iso7064_mod11_2: "Mod11_2", int64_range: "Int64Range", uint64_range: "Uint64Range" };
const STEP = { trim: "Trim", lowercase: "Lowercase", uppercase: "Uppercase", remove_spaces: "RemoveSpaces", remove_hyphens: "RemoveHyphens" };
const SHAPES = new Set(["object", "array", "any"]);

function fail(message) {
    throw new Error(message);
}

/** Fails the build on a lone surrogate, which no Rust literal can hold (it would become U+FFFD). */
function noLoneSurrogate(s) {
    if (/[\ud800-\udfff]/u.test(s.replace(/[\ud800-\udbff][\udc00-\udfff]/g, ""))) fail(`Lone surrogate in ${JSON.stringify(s)}`);
    return s;
}

/** A Rust string literal. Control characters, carriage returns and the BOM are escaped; lone surrogates can't be. */
function str(s) {
    noLoneSurrogate(s);
    const esc = { "\\": "\\\\", '"': '\\"', "\n": "\\n", "\r": "\\r", "\t": "\\t" };
    const out = s.replace(/[\\"\u0000-\u001f\u007f﻿]/g, (c) => esc[c] ?? `\\u{${c.charCodeAt(0).toString(16)}}`);
    return `"${out}"`;
}

/** A pattern as a raw string, with as many `#` as it needs. Raw strings can't hold a carriage return or the BOM. */
function pattern(p) {
    noLoneSurrogate(p);
    if (/[\r﻿]/.test(p)) return str(p);
    let hashes = "";
    while (p.includes(`"${hashes}`)) hashes += "#";
    return `r${hashes}"${p}"${hashes}`;
}

/** `Some(p)` for the `pattern` field, with `p` on its own line when the field is too long for one, as rustfmt does. */
const some = (p) => (`    pattern: Some(${p}),`.length <= 100 ? `Some(${p})` : `Some(\n        ${p},\n    )`);

function int64(n, name, fallback) {
    if (n === null) return fallback;
    if (!Number.isInteger(n) || Math.abs(n) >= 2 ** 63) fail(`${name}: bound ${n} is not an i64`);
    return String(n);
}

/** An f64 literal: Rust needs a dot or an exponent to read a float. */
function f64(n, fallback) {
    if (n === null) return fallback;
    const s = String(n);
    return /[.e]/.test(s) ? s : `${s}.0`;
}

/** The kind struct and its fields after `meta`. */
function rules(m) {
    switch (m.kind) {
        case "text":
            return ["Text", [
                ["steps", `&[${m.steps.map((s) => `Step::${STEP[s] ?? fail(`${m.name}: unknown normalize step "${s}"`)}`).join(", ")}]`],
                ["pattern", m.pattern === null ? "None" : some(pattern(m.pattern))],
                ["min_len", String(m.minLen)],
                ["max_len", m.maxLen === null ? "usize::MAX" : String(m.maxLen)],
                ["rule", m.check === null ? "None" : `Some(Check::${CHECK[m.check] ?? fail(`${m.name}: unknown check "${m.check}"`)})`],
                ["re", "OnceLock::new()"],
            ]];
        case "integer":
            return ["Int", [["minimum", int64(m.minimum, m.name, "i64::MIN")], ["maximum", int64(m.maximum, m.name, "i64::MAX")]]];
        case "number":
            return ["Number", [["minimum", f64(m.minimum, "f64::MIN")], ["maximum", f64(m.maximum, "f64::MAX")]]];
        case "boolean":
            return ["Bool", []];
        default:
            return ["Meta", null];
    }
}

const oneLine = (s) => s.replace(/\s+/g, " ").trim();

/** The doc comment: `Label: hint.`, then the details as a second paragraph. */
const doc = (m) => [`/// ${oneLine(m.label)}: ${oneLine(m.hint)}.`, ...(m.details ? ["///", `/// ${oneLine(m.details)}`] : [])].join("\n");

/** `name: value,` lines; a list too long for one line goes one item per line, as rustfmt writes it. */
function fields(pairs, indent) {
    return pairs.map(([k, v]) => `${indent}${k}: ${v},`).join("\n");
}

function list(items, field, indent) {
    const one = `&[${items.map(str).join(", ")}]`;
    if (`${indent}${field}: ${one},`.length <= 100) return one;
    return `&[\n${items.map((a) => `${indent}    ${str(a)},\n`).join("")}${indent}]`;
}

function record(m, id) {
    const [struct, more] = rules(m);
    const inner = more === null ? "    " : "        ";
    const meta = fields([
        ["name", str(m.name)], ["label", str(m.label)], ["hint", str(m.hint)], ["error", str(m.error)],
        ["details", str(m.details)], ["level", str(m.level)], ["primitive", str(m.primitive)],
        ["aliases", list(m.aliases, "aliases", inner)],
        ["params", list(m.params, "params", inner)],
        ["check", m.check === null ? "None" : `Some(${str(m.check)})`],
    ], inner);
    const body = more === null ? meta : `    meta: Meta {\n${meta}\n    },${more.length ? `\n${fields(more, "    ")}` : ""}`;
    return `${doc(m)}\npub static ${id}: ${struct} = ${struct} {\n${body}\n};\n`;
}

/** The two tables as slices of constants, so nothing runs at load. */
function tables(meta) {
    const opt = (n) => (n === null ? "None" : `Some(${n})`);
    const rules = Object.entries(paramRules(meta)).map(([name, r]) =>
        `    ParamRule {\n        name: ${str(name)},\n        kind: ${str(r.kind)},\n        minimum: ${opt(r.minimum)},\n        maximum: ${opt(r.maximum)},\n        min_items: ${opt(r.minItems)},\n    },\n`);
    const errors = Object.entries(meta.errors).map(([code, text]) => {
        const one = `    (${str(code)}, ${str(text)})`; // rustfmt breaks a tuple wider than 60
        return one.length - 4 <= 60 ? `${one},\n` : `    (\n        ${str(code)},\n        ${str(text)},\n    ),\n`;
    });
    return `/// The limits of each setting in $meta.params.
#[allow(dead_code)]
static PARAM_RULES: &[ParamRule] = &[
${rules.join("")}];

/// The message template of each error code in $meta.errors.
#[allow(dead_code)]
static ERRORS: &[(&str, &str)] = &[
${errors.join("")}];
`;
}

export function emitRust(models, version, meta) {
    const ids = identifiers(models, "rust", RESERVED_RUST);
    const id = (m) => ids.get(m.name);
    const header = [
        "// Code generated from dist/scalars.json by dev/codegen/rust.mjs. DO NOT EDIT.",
        `// scalars.rs, catalogue version ${version}. Run \`npm run build\` in dev/ to regenerate.`,
        `// Requires Rust >= 1.80 (edition 2021) and the regex crate (tested with regex ${REGEX_VERSION} on Rust ${RUST_VERSION}).`,
        "",
        "",
    ].join("\n");
    const table = models.map((m) => record(m, id(m))).join("\n");
    const every = models.map((m) => `    &${id(m)}${SHAPES.has(m.kind) ? "" : ".meta"},\n`).join("");
    const variant = (m) => (SHAPES.has(m.kind) ? "Shape" : rules(m)[0]);
    const lookup = models.map((m) => `        ${str(m.name)} => Kind::${variant(m)}(&${id(m)}),\n`).join("");
    const source = `${header}${ENGINE}
${tables(meta)}
${table}
/// Every type, in catalogue order.
pub static ALL: &[&Meta] = &[
${every}];

/// The typed scalar with exactly this name, or None.
pub fn lookup(name: &str) -> Option<Kind> {
    Some(match name {
${lookup}        _ => return None,
    })
}
`;
    return { "rust/scalars.rs": source };
}
