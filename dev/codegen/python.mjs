// Emits dist/python/scalars.py: the hand-written engine (engine.py, then models.py) followed by one generated record per type.
import { header, readEngine } from "./common.mjs";
import { identifiers, metaFields, paramRules } from "./model.mjs";

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
    "models", "Models", "Model", "ModelError", "ModelsError", "Problem",
    "str", "int", "float", "bool", "dict", "list", "tuple",
    ...KEYWORDS_PY,
];

/** The hand-written engine: the scalars, then the models (which read `_PARAM_RULES` and `_ERRORS`, emitted below). */
const ENGINE = `${readEngine("engine.py")}\n\n${readEngine("models.py")}`;
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

/** A record key in Python: snake_case. */
const snake = (k) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/** A fact's Python value: lists are tuples, and the examples are a dict of tuples. */
const value = (k, v) => (k === "examples" ? `{"valid": ${tuple(v.valid)}, "invalid": ${tuple(v.invalid)}}` : Array.isArray(v) ? tuple(v) : lit(v));

function record(m, id) {
    const body = metaFields(m).map(([k, v]) => `    ${snake(k)}=${value(k, v)},`).join("\n");
    return `${id}: Final[Scalar[${NATIVE[m.kind]}]] = Scalar(\n${body}\n)\n${docstring(m)}\n`;
}

export function emitPython(models, version, meta) {
    const ids = identifiers(models, "python", RESERVED_PY);
    const top = header({
        file: "scalars.py", source: "python.mjs", version,
        requires: "Requires Python >= 3.10 (tested on 3.14). No dependencies.",
    });
    const table = models.map((m) => record(m, ids.get(m.name))).join("\n");
    const names = `Name = Literal[${models.map((m) => lit(m.name)).join(", ")}]`;
    const every = `all: Final[tuple[Scalar[_Any], ...]] = (${models.map((m) => ids.get(m.name)).join(", ")},)`;
    // The limits of each setting in $meta.params, and the message template of each error code in $meta.errors.
    const tables = `_PARAM_RULES: Final = ${lit(paramRules(meta))}\n_ERRORS: Final = ${lit(meta.errors)}\n`;
    return { "python/scalars.py": `${top}${ENGINE}\n\n${tables}\n${table}\n${names}\n\n${every}\n` };
}
