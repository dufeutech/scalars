// Writes dist/postgres/scalars.sql: engine.sql's check helpers, then per type a reason function and an is_ function.
// The input is canonical (the app normalizes), so the text gates start at the length checks.
import { sqlString } from "../lib/derive.mjs";
import { fail, header, readEngine } from "./common.mjs";

const FILE = "postgres/scalars.sql";
/** JSON number text (RFC 8259), the only text a number function takes. */
const JSON_NUMBER = "^-?(0|[1-9][0-9]*)(\\.[0-9]+)?([eE][+-]?[0-9]+)?$";
const JSONB_KINDS = new Set(["object", "array", "any"]);
/** Types with no functions: enum needs a named Postgres enum per field. */
const SKIP = new Set(["enum"]);

/** `(models, version, $meta) => { "postgres/scalars.sql": text }`. */
export function emitPostgres(models, version, meta) {
    const engine = readEngine("engine.sql");
    for (const name of Object.keys(meta.checks)) {
        if (!engine.includes(`FUNCTION scalars.check_${name}(`)) fail(`Unknown check "${name}": engine.sql has no scalars.check_${name}`);
    }
    const reason = (r) => (Object.hasOwn(meta.reasons, r) ? sqlString(r) : fail(`No reason "${r}" in $meta.reasons`));
    const used = models.filter((m) => !SKIP.has(m.name));
    const text = header({
        file: "scalars.sql",
        source: "postgres.mjs",
        version,
        requires: "Postgres 16+, plain SQL and PL/pgSQL, no extensions. Install or upgrade: psql -f scalars.sql",
    }) + "\n" + engine + "\n" + used.map((m) => typeFunctions(m, reason)).join("\n")
        + "\n-- The column types. Postgres has no CREATE OR REPLACE DOMAIN: a re-run keeps each domain and replaces its\n"
        + "-- CHECK, NOT VALID, so new values meet the new rule and rows already stored are not rechecked.\n"
        + used.map(domain).join("");
    return { [FILE]: text };
}

/** `scalars.<name>` over the native column type, created unless it exists, its CHECK (`<name>_check`) replaced. */
function domain(m) {
    if (m.pgType === null) fail(`postgres: type ${m.name} has no column type`);
    const lines = [
        "DO $$ BEGIN",
        `    IF NOT EXISTS (SELECT FROM pg_type WHERE typname = ${sqlString(m.name)} AND typnamespace = 'scalars'::regnamespace) THEN`,
        `        CREATE DOMAIN scalars.${m.name} AS ${m.pgType};`,
        "    END IF;",
        `    ALTER DOMAIN scalars.${m.name} DROP CONSTRAINT IF EXISTS ${m.name}_check;`,
    ];
    if (m.pgDomainCheck !== null) lines.push(`    ALTER DOMAIN scalars.${m.name} ADD CONSTRAINT ${m.name}_check CHECK (${m.pgDomainCheck}) NOT VALID;`);
    return [...lines, "END $$;", ""].join("\n");
}

/** The gates of one type, as [condition, reason] pairs in the reference's order. */
function gates(m) {
    const g = [];
    switch (m.kind) {
        case "text":
            if (m.maxLen !== null) g.push([`char_length(v) > ${m.maxLen}`, "too_long"]);
            if (m.minLen) g.push([`char_length(v) < ${m.minLen}`, "too_short"]);
            if (m.pattern !== null) g.push([`v !~ ${sqlString(m.pattern)}`, "pattern"]);
            if (m.check !== null) g.push([`NOT scalars.check_${m.check}(v)`, "check"]);
            if (m.list !== null) g.push([`NOT (${sqlString(JSON.stringify(Object.fromEntries(m.list.map((c) => [c, 1]))))}::jsonb ? v)`, "not_in_list"]);
            return g;
        case "number":
            g.push(["v IN ('NaN', 'Infinity', '-Infinity')", "out_of_range"]);
        // falls through
        case "integer":
            g.push([`v !~ ${sqlString(JSON_NUMBER)}`, "wrong_kind"]);
            // Text float8 can't hold (1e400, 1e-400) parses to no value: out of range, without an exception block.
            g.push(["NOT pg_input_is_valid(v, 'float8')", "out_of_range"]);
            if (m.kind === "integer") g.push(["v::float8 <> trunc(v::float8)", "wrong_kind"]);
            if (m.minimum !== null) g.push([`v::float8 < ${m.minimum}`, "out_of_range"]);
            if (m.maximum !== null) g.push([`v::float8 > ${m.maximum}`, "out_of_range"]);
            return g;
        case "boolean":
            return [["v NOT IN ('true', 'false')", "wrong_kind"]];
        case "object":
        case "array":
            return [[`jsonb_typeof(v) <> '${m.kind}'`, "wrong_kind"]];
        case "any":
            return [];
        default:
            return fail(`postgres: no gates for kind "${m.kind}" (type ${m.name})`);
    }
}

/** `scalars.<name>_reason` (NULL when valid) and `scalars.is_<name>`. */
function typeFunctions(m, reason) {
    const arg = JSONB_KINDS.has(m.kind) ? "jsonb" : "text";
    const body = gates(m).map(([cond, r]) => `    IF ${cond} THEN RETURN ${reason(r)}; END IF;\n`).join("");
    if (body.includes("$$")) fail(`postgres: type ${m.name} has "$$" in a rule`);
    return [
        `-- ${m.name}`,
        `CREATE OR REPLACE FUNCTION scalars.${m.name}_reason(v ${arg}) RETURNS text`,
        "LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE AS $$",
        "BEGIN",
        `${body}    RETURN NULL;`,
        "END $$;",
        `CREATE OR REPLACE FUNCTION scalars.is_${m.name}(v ${arg}) RETURNS boolean`,
        "LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$",
        `    SELECT scalars.${m.name}_reason(v) IS NULL`,
        "$$;",
        "",
    ].join("\n");
}
