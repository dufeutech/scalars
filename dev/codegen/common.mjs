// Helpers every code emitter shares, so each language writes them once.
import fs from "node:fs";
import path from "node:path";

/** Fails the build with `message`. An expression-friendly `throw`: `x ?? fail("...")`. */
export function fail(message) {
    throw new Error(message);
}

/**
 * The hand-written engine `dev/codegen/<file>`, with CRLF line endings turned into LF, and without its dev-only
 * pointer comments (whole lines saying a value is "emitted after this file", plus one blank line after them), which
 * read oddly in dist next to the emitted value.
 */
export const readEngine = (file) => fs.readFileSync(new URL(`./${file}`, import.meta.url), "utf8")
    .replaceAll("\r\n", "\n")
    .replace(/^.*emitted after this file.*\n\n?/gm, "");

/**
 * The version of `name` that a runner's lock file pins, so a generated header names what was tested: a Cargo.lock
 * package (`name = "regex"`, then `version = "1.13.1"`) or a go.mod requirement (`golang.org/x/text v0.21.0`).
 */
export function lockedVersion(file, name) {
    const lines = fs.readFileSync(new URL(`../langs/${file}`, import.meta.url), "utf8").split(/\r?\n/).map((l) => l.trim());
    if (file.endsWith("Cargo.lock")) {
        const i = lines.indexOf(`name = "${name}"`);
        const m = i >= 0 ? /^version = "([^"]+)"$/.exec(lines[i + 1] ?? "") : null;
        if (m) return m[1];
    } else {
        for (const line of lines) {
            const words = line.split(/\s+/);
            if (words[0] === "require") words.shift();
            if (words[0] === name && words[1]?.startsWith("v")) return words[1];
        }
    }
    return fail(`dev/langs/${file} pins no version of ${name}`);
}

/** Fails the build on a lone surrogate, which no Go or Rust literal can hold (it would become U+FFFD). */
export function noLoneSurrogate(s) {
    if (/[\ud800-\udfff]/u.test(s.replace(/[\ud800-\udbff][\udc00-\udfff]/g, ""))) fail(`Lone surrogate in ${JSON.stringify(s)}`);
    return s;
}

/** A signed 64-bit bound as decimal text; `fallback` when there is none. */
export function int64(n, name, fallback) {
    if (n === null) return fallback;
    if (!Number.isInteger(n) || Math.abs(n) >= 2 ** 63) fail(`${name}: bound ${n} is not an int64`);
    return String(n);
}

/**
 * The comment block at the top of a generated file, in the file's own comment syntax (by its extension).
 * Go and Rust use the "Code generated ... DO NOT EDIT." form that tooling looks for, then a blank line.
 */
export function header({ file, source, version, requires }) {
    const ext = path.extname(file);
    const generated = `by dev/codegen/${source}`;
    const name = `${file}, catalogue version ${version}`;
    if (ext === ".go" || ext === ".rs") {
        return [
            `// Code generated from dist/scalars.json ${generated}. DO NOT EDIT.`,
            `// ${name}. Run \`npm run build\` in dev/ to regenerate.`,
            `// ${requires}`,
            "",
            "",
        ].join("\n");
    }
    const mark = { ".py": "#", ".ts": "//" }[ext] ?? fail(`header: no comment syntax for ${file}`);
    return [
        `${mark} ${name}.`,
        `${mark} Generated from dist/scalars.json ${generated}. Do not edit: run \`npm run build\` in dev/.`,
        `${mark} ${requires}`,
        "",
    ].join("\n");
}
