// The language-neutral view of dist/scalars.json that every code emitter reads.
// Nothing here is typed by hand: rules come from the catalogue, lengths from the pattern.
import { matchLengths } from "../lib/linear.mjs";

const KINDS = new Set(["string", "integer", "number", "boolean", "object", "array"]);

/** One record per type, in catalogue (alphabetical) order. */
export const toModel = (scalars) => Object.values(scalars.types).map(modelOf);

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
        examples: t.examples,
        kind,
        steps: t.normalize ?? [],
        pattern,
        minLen,
        maxLen,
        minimum: s.minimum ?? null,
        maximum: s.maximum ?? null,
    };
}

const words = (name) => name.split("_");
const IDENTIFIER_STYLES = {
    go: (n) => words(n).map((w) => w[0].toUpperCase() + w.slice(1)).join(""),
    ts: (n) => words(n).map((w) => w[0].toUpperCase() + w.slice(1)).join(""),
    rust: (n) => n.toUpperCase(),
    python: (n) => n,
};

/** Maps each type name to its identifier in `lang`; throws when two share one or one is reserved. */
export function identifiers(models, lang, reserved) {
    const style = IDENTIFIER_STYLES[lang];
    if (!style) throw new Error(`Unknown language "${lang}"`);
    const owner = new Map(reserved.map((r) => [r, "a reserved name"]));
    const out = new Map();
    for (const m of models) {
        const id = style(m.name);
        if (owner.has(id)) {
            const other = owner.get(id);
            throw new Error(`Identifier "${id}" is used by "${other}" and "${m.name}"`);
        }
        owner.set(id, m.name);
        out.set(m.name, id);
    }
    return out;
}
