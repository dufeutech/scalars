// Dev-only: writes the release files dist/scalars.json and dist/openapi.json from the source JSON.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonical, loadSources, resolve } from "./lib/resolve.mjs";
import { toJsonSchema } from "./lib/derive.mjs";

const LOOKUP_RULE =
    "To find a type from a word: trim it, lowercase it, and turn spaces and '-' into '_'. " +
    "If a type has that exact name, use it; otherwise use the type whose aliases contain it; otherwise there is no match.";

/** Minified, key-sorted JSON with a trailing newline: the committed form of every dist file. */
export const serialize = (data) => canonical(data) + "\n";

export function build(root) {
    const sources = loadSources(path.join(root, "src"));
    const types = resolve(sources);
    const pgDefs = sources.targets.postgres.$defs ?? {};
    const schema = JSON.parse(fs.readFileSync(path.join(root, "schema/scalar.schema.json"), "utf8"));
    const version = sources.core.version;

    // Inline every Postgres reference so a tool never has to look anything up.
    for (const t of Object.values(types)) {
        const pg = t.postgres;
        if (pg.attr) {
            pg.attr = Object.fromEntries(Object.entries(pg.attr).map(([k, v]) => {
                if (typeof v !== "string") return [k, v];
                const def = pgDefs.attr?.[v];
                if (!def) throw new Error(`Type "${t.name}" postgres attr "${k}" names unknown attr "${v}"`);
                return [k, def];
            }));
        }
        const docs = pgDefs.postgres_docs?.[pg.type];
        if (docs) pg.docs_link = docs;
    }

    const scalars = {
        $schema: "../schema/dist.schema.json",
        version,
        $meta: {
            lookup: LOOKUP_RULE,
            normalize_steps: Object.fromEntries(schema.$defs.normalize_step.oneOf.map((s) => [s.const, s.description])),
            templates: pgDefs.templates,
        },
        types,
    };
    const openapi = {
        openapi: "3.1.0",
        info: { title: "Scalar types", version },
        components: { schemas: Object.fromEntries(Object.entries(types).map(([n, t]) => [n, toJsonSchema(t)])) },
    };
    return { scalars, openapi };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const out = build(root);
    fs.mkdirSync(path.join(root, "dist"), { recursive: true });
    for (const [file, data] of [["scalars.json", out.scalars], ["openapi.json", out.openapi]]) {
        fs.writeFileSync(path.join(root, "dist", file), serialize(data));
        console.log(`wrote dist/${file} (${serialize(data).length} bytes)`);
    }
}
