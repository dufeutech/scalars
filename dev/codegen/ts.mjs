// Emits dist/ts/scalars.ts: the hand-written engine (engine.ts) followed by one generated record per type.
import { header, readEngine } from "./common.mjs";
import { identifiers, metaFields, paramRules } from "./model.mjs";

/** Names the engine defines on the `scalars` object, so no type may take them. */
export const RESERVED_TS = ["get", "all", "__proto__"];

const ENGINE = readEngine("engine.ts");
const NATIVE = { text: "string", integer: "number", number: "number", boolean: "boolean", object: "Record<string, unknown>", array: "unknown[]", any: "unknown" };

/** A TS literal for a JSON value. JSON text is valid TS, so every backslash survives. */
const lit = (v) => JSON.stringify(v);

/** The doc comment: `label — hint. details`, kept on one line and unable to close itself. */
const doc = (m) => `/** ${[`${m.label} — ${m.hint}.`, m.details].join(" ").replaceAll("*/", "*\\/").replace(/\s+/g, " ")} */`;

/** A fact's TS value: JSON, except the examples, which are an object literal. */
const value = (k, v) => (k === "examples" ? `{ valid: ${lit(v.valid)}, invalid: ${lit(v.invalid)} }` : lit(v));

function record(m, id) {
    const body = metaFields(m).map(([k, v]) => `        ${k}: ${value(k, v)},`).join("\n");
    return `    ${doc(m)}\n    ${lit(id)}: new Scalar<${NATIVE[m.kind]}>({\n${body}\n    }),`;
}

export function emitTypeScript(models, version, meta) {
    const ids = identifiers(models, "ts", RESERVED_TS);
    const top = header({
        file: "scalars.ts", source: "ts.mjs", version,
        requires: "Requires TypeScript >= 5.6 or Node >= 22.18 (tested on Node 24). Erasable syntax only. No dependencies.",
    });
    const names = `export type Name = ${models.map((m) => lit(m.name)).join(" | ")};`;
    const table = models.map((m) => record(m, ids.get(m.name))).join("\n");
    const every = models.map((m) => `scalars[${lit(ids.get(m.name))}]`).join(", ");
    const tables = `/** The limits of each setting in $meta.params. */
const PARAM_RULES: Readonly<Record<string, ParamRule>> = ${lit(paramRules(meta))};

/** The message template of each error code in $meta.errors. */
const ERRORS: Readonly<Record<string, string>> = ${lit(meta.errors)};
`;
    const source = `${top}${ENGINE}
${tables}
${names}

/** Every type by name, plus \`get\` (name or alias) and \`all\`. */
export const scalars = {
${table}
    /** Find a type by name or alias; spacing, hyphens and case are forgiven. Nothing found gives undefined. */
    get(word: Name | (string & {})): Scalar<unknown> | undefined {
        return find(word, scalars.all);
    },
    /** Every type, in catalogue order. */
    get all(): readonly Scalar<unknown>[] {
        return every;
    },
} as const;

const every: readonly Scalar<unknown>[] = [${every}];

export default scalars;
`;
    return { "ts/scalars.ts": source };
}
