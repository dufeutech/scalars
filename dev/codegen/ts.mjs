// Emits dist/ts/scalars.ts: the hand-written engine (engine.ts) followed by one generated record per type.
import fs from "node:fs";
import { identifiers } from "./model.mjs";

/** Names the engine defines on the `scalars` object, so no type may take them. */
export const RESERVED_TS = ["get", "all"];

const ENGINE = fs.readFileSync(new URL("./engine.ts", import.meta.url), "utf8").replaceAll("\r\n", "\n");
const NATIVE = { text: "string", integer: "number", number: "number", boolean: "boolean", object: "Record<string, unknown>", array: "unknown[]", any: "unknown" };

/** A TS literal for a JSON value. JSON text is valid TS, so every backslash survives. */
const lit = (v) => JSON.stringify(v);

/** The doc comment: `label — hint. details`, kept on one line and unable to close itself. */
const doc = (m) => `/** ${[`${m.label} — ${m.hint}.`, m.details].join(" ").replaceAll("*/", "*\\/").replace(/\s+/g, " ")} */`;

function record(m, id) {
    const fields = [
        ["name", lit(m.name)], ["label", lit(m.label)], ["hint", lit(m.hint)], ["error", lit(m.error)],
        ["details", lit(m.details)], ["level", lit(m.level)], ["primitive", lit(m.primitive)],
        ["aliases", lit(m.aliases)],
        ["examples", `{ valid: ${lit(m.examples.valid)}, invalid: ${lit(m.examples.invalid ?? [])} }`],
        ["kind", lit(m.kind)],
    ];
    if (m.steps.length) fields.push(["steps", lit(m.steps)]);
    if (m.pattern !== null) fields.push(["pattern", lit(m.pattern)]);
    if (m.minLen) fields.push(["minLen", lit(m.minLen)]);
    if (m.maxLen !== null) fields.push(["maxLen", lit(m.maxLen)]);
    if (m.minimum !== null) fields.push(["minimum", lit(m.minimum)]);
    if (m.maximum !== null) fields.push(["maximum", lit(m.maximum)]);
    const body = fields.map(([k, v]) => `        ${k}: ${v},`).join("\n");
    return `    ${doc(m)}\n    ${lit(id)}: new Scalar<${NATIVE[m.kind]}>({\n${body}\n    }),`;
}

export function emitTypeScript(models, version) {
    const ids = identifiers(models, "ts", RESERVED_TS);
    const header = [
        `// scalars.ts, catalogue version ${version}.`,
        "// Generated from dist/scalars.json by dev/codegen/ts.mjs. Do not edit: run `npm run build` in dev/.",
        "// Requires TypeScript >= 5.6 or Node >= 22.18 (tested on Node 24). Erasable syntax only. No dependencies.",
        "",
    ].join("\n");
    const names = `export type Name = ${models.map((m) => lit(m.name)).join(" | ")};`;
    const table = models.map((m) => record(m, ids.get(m.name))).join("\n");
    const every = models.map((m) => `scalars[${lit(ids.get(m.name))}]`).join(", ");
    const source = `${header}${ENGINE}
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
