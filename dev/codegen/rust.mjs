// Emits dist/rust/scalars.rs: the hand-written engine.rs followed by one generated static per type.
// Everything is written rustfmt-clean, and every static is a plain constant expression, so nothing runs at load.
import { header, int64, noLoneSurrogate, readEngine } from "./common.mjs";
import { engineNames, identifiers, metaFields, paramRules } from "./model.mjs";

/** Upper-case names the engine defines and the statics it uses, so no type may take them. */
export const RESERVED_RUST = ["META", "ALL", "INDEX", "WS", "Kind", "lookup"];

const REGEX_VERSION = "1.13.1"; // the regex crate, the version the runner tests with
const RUST_VERSION = "1.97.0";
const ENGINE = readEngine("engine.rs");
const SHAPES = new Set(["object", "array", "any"]);

/** Each used check and step name mapped to its engine.rs enum variant (PascalCase), which must exist. */
function engineIds(models, meta) {
    const defined = (id) => new RegExp(`^\\s+${id},( //.*)?$`, "m").test(ENGINE);
    return {
        check: engineNames("check", [...Object.keys(meta.checks ?? {}), ...models.map((m) => m.check).filter(Boolean)], "", defined, "engine.rs"),
        step: engineNames("step", models.flatMap((m) => m.steps), "", defined, "engine.rs"),
    };
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

/** An f64 literal: Rust needs a dot or an exponent to read a float. */
function f64(n, fallback) {
    if (n === null) return fallback;
    const s = String(n);
    return /[.e]/.test(s) ? s : `${s}.0`;
}

/** The kind struct and its fields after `meta`. */
function rules(m, ids) {
    switch (m.kind) {
        case "text":
            return ["Text", [
                ["steps", `&[${m.steps.map((s) => `Step::${ids.step.get(s)}`).join(", ")}]`],
                ["pattern", m.pattern === null ? "None" : some(pattern(m.pattern))],
                ["min_len", String(m.minLen)],
                ["max_len", m.maxLen === null ? "usize::MAX" : String(m.maxLen)],
                ["rule", m.check === null ? "None" : `Some(Check::${ids.check.get(m.check)})`],
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

/** The shared facts (metaFields) that Meta holds, in the order of its fields: [field, how to write the fact]. Params and check are always written. */
const META = [
    ["name", str], ["label", str], ["hint", str], ["error", str], ["details", str], ["level", str], ["primitive", str],
    ["aliases", (v, indent) => list(v, "aliases", indent)],
    ["params", (v, indent) => list(v ?? [], "params", indent)],
    ["check", (v) => (v === undefined ? "None" : `Some(${str(v)})`)],
];

function record(m, id, ids) {
    const [struct, more] = rules(m, ids);
    const inner = more === null ? "    " : "        ";
    const facts = new Map(metaFields(m));
    const meta = fields(META.map(([k, value]) => [k, value(facts.get(k), inner)]), inner);
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
    const engine = engineIds(models, meta);
    const top = header({
        file: "scalars.rs", source: "rust.mjs", version,
        requires: `Requires Rust >= 1.80 (edition 2021) and the regex crate (tested with regex ${REGEX_VERSION} on Rust ${RUST_VERSION}).`,
    });
    const table = models.map((m) => record(m, id(m), engine)).join("\n");
    const every = models.map((m) => `    &${id(m)}${SHAPES.has(m.kind) ? "" : ".meta"},\n`).join("");
    const variant = (m) => (SHAPES.has(m.kind) ? "Shape" : rules(m, engine)[0]);
    const lookup = models.map((m) => `        ${str(m.name)} => Kind::${variant(m)}(&${id(m)}),\n`).join("");
    const source = `${top}${ENGINE}
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
