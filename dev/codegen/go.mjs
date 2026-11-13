// Emits dist/go/scalars.go (the hand-written engine.go followed by one generated record per type) and its go.mod.
// Everything is written already gofmt-clean, and the table is plain composite literals, so Go builds it statically.
import fs from "node:fs";
import { identifiers } from "./model.mjs";

/** Names the engine exports, so no type may take them. */
export const RESERVED_GO = ["Meta", "ScalarError", "TextScalar", "IntScalar", "NumberScalar", "BoolScalar", "ShapeScalar", "Get", "All", "Lookup"];

const TEXT_VERSION = "v0.21.0"; // golang.org/x/text, the version the runner tests with
const ENGINE = fs.readFileSync(new URL("./engine.go", import.meta.url), "utf8").replaceAll("\r\n", "\n");
const STRUCT = {
    text: "TextScalar",
    integer: "IntScalar",
    number: "NumberScalar",
    boolean: "BoolScalar",
    object: "ShapeScalar[map[string]any]",
    array: "ShapeScalar[[]any]",
    any: "ShapeScalar[any]",
};
const STEP = { trim: "stepTrim", lowercase: "stepLowercase", uppercase: "stepUppercase", remove_spaces: "stepRemoveSpaces", remove_hyphens: "stepRemoveHyphens" };

/** A Go interpreted string literal. JSON escapes are valid Go escapes; Go forbids a BOM in source and lone surrogates. */
function str(s) {
    noLoneSurrogate(s);
    return JSON.stringify(s).replaceAll("﻿", "\\ufeff");
}

/** Fails the build on a lone surrogate, which no Go literal can hold (it would become U+FFFD). */
function noLoneSurrogate(s) {
    if (/[\ud800-\udfff]/u.test(s.replace(/[\ud800-\udbff][\udc00-\udfff]/g, ""))) throw new Error(`Lone surrogate in ${JSON.stringify(s)}`);
    return s;
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

function int64(n, name, fallback) {
    if (n === null) return fallback;
    if (!Number.isInteger(n) || Math.abs(n) >= 2 ** 63) throw new Error(`${name}: bound ${n} is not an int64`);
    return String(n);
}

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
                ["steps", `[]step{${m.steps.map((s) => STEP[s] ?? fail(`${m.name}: unknown normalize step "${s}"`)).join(", ")}}`],
                ["pattern", m.pattern === null ? `""` : pattern(m.pattern)],
                ["minLen", String(m.minLen)],
                ["maxLen", m.maxLen === null ? "noMax" : String(m.maxLen)],
            ];
        case "integer":
            return [["minimum", int64(m.minimum, m.name, "math.MinInt64")], ["maximum", int64(m.maximum, m.name, "math.MaxInt64")]];
        case "number":
            return [["minimum", m.minimum === null ? "-math.MaxFloat64" : String(m.minimum)], ["maximum", m.maximum === null ? "math.MaxFloat64" : String(m.maximum)]];
        default:
            return [];
    }
}

function fail(message) {
    throw new Error(message);
}

const oneLine = (s) => s.replace(/\s+/g, " ").trim();

/** The doc comment: `Id is label: hint.`, then the details as a second paragraph. */
const doc = (m, id) => [`// ${id} is ${oneLine(m.label)}: ${oneLine(m.hint)}.`, ...(m.details ? ["//", `// ${oneLine(m.details)}`] : [])].join("\n");

function record(m, id) {
    const meta = fields([
        ["Name", str(m.name)], ["Label", str(m.label)], ["Hint", str(m.hint)], ["Error", str(m.error)],
        ["Details", str(m.details)], ["Level", str(m.level)], ["Primitive", str(m.primitive)],
        ["Aliases", `[]string{${m.aliases.map(str).join(", ")}}`],
        ["Valid", examples(m.examples.valid)], ["Invalid", examples(m.examples.invalid)],
    ], "\t\t");
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

export function emitGo(models, version) {
    const ids = identifiers(models, "go", RESERVED_GO);
    const id = (m) => ids.get(m.name);
    const header = [
        "// Code generated from dist/scalars.json by dev/codegen/go.mjs. DO NOT EDIT.",
        `// scalars.go, catalogue version ${version}. Run \`npm run build\` in dev/ to regenerate.`,
        `// Requires Go >= 1.21 and golang.org/x/text (tested with ${TEXT_VERSION} on Go 1.26.3).`,
        "",
        "",
    ].join("\n");
    const table = models.map((m) => record(m, id(m))).join("\n");
    const lookup = models.map((m) => `\tcase ${str(m.name)}:\n\t\treturn ${id(m)}\n`).join("");
    const every = models.map((m) => `\t&scalar${id(m)}.Meta,\n`).join("");
    const source = `${header}${ENGINE}
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
