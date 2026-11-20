// The language-neutral view of dist/scalars.json that every code emitter reads.
// Nothing here is typed by hand: rules come from the catalogue, lengths from the pattern.
import { matchLengths } from "../lib/linear.mjs";
import { fail } from "./common.mjs";

const KINDS = new Set(["string", "integer", "number", "boolean", "object", "array"]);

/** One record per type, in catalogue order: sorted by name, as dist/scalars.json is written. */
export const toModel = (scalars) => Object.keys(scalars.types).sort().map((name) => modelOf(scalars.types[name]));

/** The model record for one catalogue type. */
export function modelOf(t) {
    const s = t.schema ?? {};
    const kind = s.type === "string" ? "text" : KINDS.has(s.type) ? s.type : "any";
    const pattern = s.pattern ?? null;
    let minLen = 0;
    let maxLen = null;
    if (kind === "text") {
        const p = pattern ? matchLengths(pattern) : { min: 0, max: Infinity };
        minLen = Math.max(s.minLength ?? 0, p.min);
        const max = Math.min(s.maxLength ?? Infinity, p.max);
        maxLen = Number.isFinite(max) ? max : null;
    }
    return {
        name: t.name,
        label: t.label,
        hint: t.hint,
        error: t.error,
        details: t.details,
        level: t.level,
        primitive: t.primitive,
        aliases: t.aliases ?? [],
        params: t.params ?? [],
        examples: t.examples,
        kind,
        steps: t.normalize ?? [],
        pattern,
        check: t.check ?? null,
        minLen,
        maxLen,
        minimum: s.minimum ?? null,
        maximum: s.maximum ?? null,
    };
}

/**
 * The facts every record writes, as [key, JSON value] pairs in one order: the ones every type has, then the
 * ones it only has when set. Each emitter maps the keys to its own casing and the values to its own literals.
 */
export function metaFields(m) {
    const fields = [
        ["name", m.name], ["label", m.label], ["hint", m.hint], ["error", m.error], ["details", m.details],
        ["level", m.level], ["primitive", m.primitive], ["aliases", m.aliases],
        ["examples", { valid: m.examples?.valid ?? [], invalid: m.examples?.invalid ?? [] }],
        ["kind", m.kind],
    ];
    if (m.params.length) fields.push(["params", m.params]);
    if (m.steps.length) fields.push(["steps", m.steps]);
    if (m.pattern !== null) fields.push(["pattern", m.pattern]);
    if (m.check !== null) fields.push(["check", m.check]);
    if (m.minLen) fields.push(["minLen", m.minLen]);
    if (m.maxLen !== null) fields.push(["maxLen", m.maxLen]);
    if (m.minimum !== null) fields.push(["minimum", m.minimum]);
    if (m.maximum !== null) fields.push(["maximum", m.maximum]);
    return fields;
}

/** The limits of every `$meta.params` setting, as the models engines check them: absent limits are null. */
export const paramRules = (meta) =>
    Object.fromEntries(
        Object.entries(meta.params).map(([name, p]) => [
            name,
            { kind: p.type, minimum: p.minimum ?? null, maximum: p.maximum ?? null, minItems: p.minItems ?? null },
        ]),
    );

/** PascalCase for a snake_case name: "iso7064_mod11_2" is "Iso7064Mod112". Empty words (a doubled underscore) vanish. */
export const pascal = (name) => name.split("_").filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join("");

const IDENTIFIER_STYLES = {
    go: pascal,
    ts: (n) => n,
    rust: (n) => n.toUpperCase(),
    python: (n) => n,
};

/** `name` in `lang`'s identifier style; throws for a language with none. */
export const styled = (lang, name) => (IDENTIFIER_STYLES[lang] ?? fail(`Unknown language "${lang}"`))(name);

/**
 * Maps each check or step name to the engine's identifier for it: `prefix` + PascalCase (Go: "check"/"step",
 * Rust: none). Throws when two names derive one identifier, or when `defined(id)` says the engine lacks it.
 */
export function engineNames(kind, names, prefix, defined, engineFile) {
    const out = new Map();
    const owner = new Map();
    for (const name of new Set(names)) {
        const id = prefix + pascal(name);
        if (owner.has(id)) fail(`${kind} names "${owner.get(id)}" and "${name}" both become the identifier "${id}"`);
        owner.set(id, name);
        out.set(name, id);
    }
    for (const [name, id] of out) if (!defined(id)) fail(`Unknown ${kind} "${name}": ${engineFile} has no ${id}`);
    return out;
}

/** Maps each type name to its identifier in `lang`; throws when two share one or one is reserved. */
export function identifiers(models, lang, reserved) {
    const owner = new Map(reserved.map((r) => [r, "a reserved name"]));
    const out = new Map();
    for (const m of models) {
        const id = styled(lang, m.name);
        if (owner.has(id)) {
            const other = owner.get(id);
            throw new Error(`Identifier "${id}" is used by "${other}" and "${m.name}"`);
        }
        owner.set(id, m.name);
        out.set(m.name, id);
    }
    return out;
}
