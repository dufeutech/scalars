// Emits dist/python/scalars.py: the hand-written engine (engine.py) followed by one generated record per type.
import fs from "node:fs";
import { identifiers } from "./model.mjs";

/** Python's keywords (keyword.kwlist), which can never name a module attribute. */
const KEYWORDS_PY = [
    "False", "None", "True", "and", "as", "assert", "async", "await", "break", "class", "continue", "def", "del",
    "elif", "else", "except", "finally", "for", "from", "global", "if", "import", "in", "is", "lambda", "nonlocal",
    "not", "or", "pass", "raise", "return", "try", "while", "with", "yield",
];

/**
 * Names no type may take: the engine's own names, the builtins its annotations name (the engine calls every
 * builtin as `_b.x`, but a type checker reads annotations against the module), and Python's keywords.
 */
export const RESERVED_PY = [
    "Scalar", "ScalarError", "Name", "get", "all", "Final", "Generic", "Literal", "TypeVar", "T",
    "str", "int", "float", "bool", "dict", "list", "tuple",
    ...KEYWORDS_PY,
];

const ENGINE = fs.readFileSync(new URL("./engine.py", import.meta.url), "utf8").replaceAll("\r\n", "\n");
const NATIVE = { text: "str", integer: "int", number: "float", boolean: "bool", object: "dict[str, _Any]", array: "list[_Any]", any: "_Any" };

/** A Python literal for a JSON value. JSON strings are valid Python strings, so every backslash survives. */
function lit(v) {
    if (v === null) return "None";
    if (v === true) return "True";
    if (v === false) return "False";
    if (Array.isArray(v)) return `[${v.map(lit).join(", ")}]`;
    if (typeof v === "object") return `{${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${lit(x)}`).join(", ")}}`;
    return JSON.stringify(v);
}
const tuple = (list) => `(${list.map(lit).join(", ")}${list.length === 1 ? "," : ""})`;

/** A docstring body: backslashes and quotes escaped so it stays inside a triple-quoted string. */
const docstring = (m) => `"""${[m.label, m.hint, m.details].join("\n\n").replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"""`;

function record(m, id) {
    const fields = [
        ["name", lit(m.name)], ["label", lit(m.label)], ["hint", lit(m.hint)], ["error", lit(m.error)],
        ["details", lit(m.details)], ["level", lit(m.level)], ["primitive", lit(m.primitive)],
        ["aliases", tuple(m.aliases)],
        ["examples", `{"valid": ${tuple(m.examples.valid)}, "invalid": ${tuple(m.examples.invalid ?? [])}}`],
        ["kind", lit(m.kind)],
    ];
    if (m.steps.length) fields.push(["steps", tuple(m.steps)]);
    if (m.pattern !== null) fields.push(["pattern", lit(m.pattern)]);
    if (m.minLen) fields.push(["min_len", lit(m.minLen)]);
    if (m.maxLen !== null) fields.push(["max_len", lit(m.maxLen)]);
    if (m.minimum !== null) fields.push(["minimum", lit(m.minimum)]);
    if (m.maximum !== null) fields.push(["maximum", lit(m.maximum)]);
    const body = fields.map(([k, v]) => `    ${k}=${v},`).join("\n");
    return `${id}: Final[Scalar[${NATIVE[m.kind]}]] = Scalar(\n${body}\n)\n${docstring(m)}\n`;
}

export function emitPython(models, version) {
    const ids = identifiers(models, "python", RESERVED_PY);
    const header = [
        `# scalars.py, catalogue version ${version}.`,
        "# Generated from dist/scalars.json by dev/codegen/python.mjs. Do not edit: run `npm run build` in dev/.",
        "# Requires Python >= 3.10 (tested on 3.14). No dependencies.",
        "",
    ].join("\n");
    const table = models.map((m) => record(m, ids.get(m.name))).join("\n");
    const names = `Name = Literal[${models.map((m) => lit(m.name)).join(", ")}]`;
    const every = `all: Final[tuple[Scalar[_Any], ...]] = (${models.map((m) => ids.get(m.name)).join(", ")},)`;
    return { "python/scalars.py": `${header}${ENGINE}\n\n${table}\n${names}\n\n${every}\n` };
}
