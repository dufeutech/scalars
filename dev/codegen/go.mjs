// Emits dist/go/scalars.go (the hand-written engine.go followed by one generated record per type) and its go.mod.
// Everything is written already gofmt-clean, and the table is plain composite literals, so Go builds it statically.
import { fail, header, int64, noLoneSurrogate, readEngine } from "./common.mjs";
import { identifiers, metaFields, paramRules, styled } from "./model.mjs";

/** Names the engine exports, so no type may take them. */
export const RESERVED_GO = ["Meta", "ScalarError", "TextScalar", "IntScalar", "NumberScalar", "BoolScalar", "ShapeScalar", "Get", "All", "Lookup"];

const TEXT_VERSION = "v0.21.0"; // golang.org/x/text, the version the runner tests with
const ENGINE = readEngine("engine.go");
const STRUCT = {
    text: "TextScalar",
    integer: "IntScalar",
    number: "NumberScalar",
    boolean: "BoolScalar",
    object: "ShapeScalar[map[string]any]",
    array: "ShapeScalar[[]any]",
    any: "ShapeScalar[any]",
};

/** The engine's name for a check or step: `check` or `step` plus the name in PascalCase. It must exist in engine.go. */
function engineName(kind, name, owner) {
    const id = `${kind}${styled("go", name)}`;
    return new RegExp(`\\b${id}\\b`).test(ENGINE) ? id : fail(`${owner}: unknown ${kind} "${name}" (engine.go has no ${id})`);
}

/** A Go interpreted string literal. JSON escapes are valid Go escapes; Go forbids a BOM in source and lone surrogates. */
function str(s) {
    noLoneSurrogate(s);
    return JSON.stringify(s).replaceAll("﻿", "\\ufeff");
}

/** A pattern as a raw string when it can be one: raw strings can't hold a backtick, and drop carriage returns. */
const pattern = (p) => (/[`\r﻿]/.test(noLoneSurrogate(p)) ? str(p) : `\`${p}\``);

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const hasObject = (v) => isObject(v) || (Array.isArray(v) && v.some(hasObject));

/** A Go literal for a JSON value inside []any, as encoding/json would decode it: every number is a float64. */
function lit(v) {
    if (v === null) return "nil";
    if (typeof v === "boolean") return String(v);
    if (typeof v === "string") return str(v);
    if (typeof v === "number") {
        const s = String(v);
        return /^-?\d+$/.test(s) ? `${s}.0` : s;
    }
    if (Array.isArray(v)) return `[]any{${v.map(lit).join(", ")}}`;
    throw new Error(`No static Go literal for ${JSON.stringify(v)}`);
}

/** Examples without JSON objects: a map literal runs code at program start. */
const examples = (list) => `[]any{${(list ?? []).filter((v) => !hasObject(v)).map(lit).join(", ")}}`;

/** `key: value` lines as gofmt writes them: values aligned one space past the longest key. */
function fields(pairs, indent) {
    const width = Math.max(...pairs.map(([k]) => k.length)) + 2;
    return pairs.map(([k, v]) => `${indent}${`${k}:`.padEnd(width)}${v},`).join("\n");
}

/** The fields of the kind struct after Meta. */
function rules(m) {
    switch (m.kind) {
        case "text":
            return [
                ["steps", `[]step{${m.steps.map((s) => engineName("step", s, m.name)).join(", ")}}`],
                ["pattern", m.pattern === null ? `""` : pattern(m.pattern)],
                ["minLen", String(m.minLen)],
                ["maxLen", m.maxLen === null ? "noMax" : String(m.maxLen)],
                ...(m.check === null ? [] : [["rule", engineName("check", m.check, m.name)]]),
            ];
        case "integer":
            return [["minimum", int64(m.minimum, m.name, "math.MinInt64")], ["maximum", int64(m.maximum, m.name, "math.MaxInt64")]];
        case "number":
            return [["minimum", m.minimum === null ? "-math.MaxFloat64" : String(m.minimum)], ["maximum", m.maximum === null ? "math.MaxFloat64" : String(m.maximum)]];
        default:
            return [];
    }
}

const oneLine = (s) => s.replace(/\s+/g, " ").trim();

/** The doc comment: `Id is label: hint.`, then the details as a second paragraph. */
const doc = (m, id) => [`// ${id} is ${oneLine(m.label)}: ${oneLine(m.hint)}.`, ...(m.details ? ["//", `// ${oneLine(m.details)}`] : [])].join("\n");

const strings = (list) => `[]string{${list.map(str).join(", ")}}`;

/** The shared facts (metaFields) that Meta holds, in the order of its fields: [fact, Go field, Go value]. */
const META = [
    ["name", "Name", str], ["label", "Label", str], ["hint", "Hint", str], ["error", "Error", str],
    ["details", "Details", str], ["level", "Level", str], ["primitive", "Primitive", str],
    ["aliases", "Aliases", strings], ["params", "Params", strings],
    ["examples", "Valid", (e) => examples(e.valid)], ["examples", "Invalid", (e) => examples(e.invalid)],
    ["check", "Check", str],
];

function record(m, id) {
    const facts = new Map(metaFields(m));
    const meta = fields(META.filter(([k]) => facts.has(k)).map(([k, field, value]) => [field, value(facts.get(k))]), "\t\t");
    const more = rules(m);
    const tail = more.length ? `\n${fields(more, "\t")}` : "";
    return `${doc(m, id)}
var ${id} = &scalar${id}

var scalar${id} = ${STRUCT[m.kind]}{
\tMeta: Meta{
${meta}
\t},${tail}
}
`;
}

/** The two tables as arrays of struct literals: no map, so nothing runs at program start. */
function tables(meta) {
    const rules = Object.entries(paramRules(meta)).map(([name, r]) =>
        `\t{${str(name)}, ${str(r.kind)}, ${int64(r.minimum, name, "math.MinInt64")}, ${int64(r.maximum, name, "math.MaxInt64")}, ${r.minItems ?? 0}},\n`);
    const errors = Object.entries(meta.errors).map(([code, text]) => `\t{${str(code)}, ${str(text)}},\n`);
    return `// paramRules holds the limits of each setting in $meta.params.
var paramRules = [...]paramRule{
${rules.join("")}}

// errorTemplates holds the message template of each error code in $meta.errors.
var errorTemplates = [...]errorTemplate{
${errors.join("")}}
`;
}

export function emitGo(models, version, meta) {
    const ids = identifiers(models, "go", RESERVED_GO);
    const id = (m) => ids.get(m.name);
    const top = header({
        file: "scalars.go", source: "go.mjs", version,
        requires: `Requires Go >= 1.21 and golang.org/x/text (tested with ${TEXT_VERSION} on Go 1.26.3).`,
    });
    const table = models.map((m) => record(m, id(m))).join("\n");
    const lookup = models.map((m) => `\tcase ${str(m.name)}:\n\t\treturn ${id(m)}\n`).join("");
    const every = models.map((m) => `\t&scalar${id(m)}.Meta,\n`).join("");
    const source = `${top}${ENGINE}
${tables(meta)}
${table}
// All is every type, in catalogue order.
var All = []*Meta{
${every}}

// Lookup returns the typed scalar (*TextScalar, *IntScalar, ...) with exactly this name, or nil.
func Lookup(name string) any {
\tswitch name {
${lookup}\t}
\treturn nil
}
`;
    const mod = `module scalars\n\ngo 1.21\n\nrequire golang.org/x/text ${TEXT_VERSION}\n`;
    return { "go/scalars.go": source, "go/go.mod": mod };
}
