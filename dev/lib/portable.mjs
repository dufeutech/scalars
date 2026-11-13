// Dev-only: the regex subset every pattern must use so it matches the same in Go (RE2), Python (re),
// Rust (regex), JS and Postgres. Based on RFC 9485 (I-Regexp), plus (?:...) and \xHH, which all of them share.
// - Shorthands like \d, \s, \w are out: Python and Rust read them as Unicode, Go and JS as ASCII.
// - "." is out: JS excludes \r, U+2028 and U+2029 from it; the others exclude only \n.
// - Lookaround and backreferences are out: Go and Rust do not support them.

/** Characters that may follow "\" as a literal escape. */
export const LITERAL_ESCAPES = new Set("\\^$.*+?()[]{}|/-");
const HEX = /[0-9A-Fa-f]/;

/** Every reason the pattern falls outside the portable subset; empty means portable. */
export function patternProblems(pattern) {
    const problems = [];
    if (!pattern.startsWith("^") || !pattern.endsWith("$")) problems.push("must be anchored with ^...$");
    let inClass = false;
    for (let i = 0; i < pattern.length; i++) {
        const c = pattern[i];
        if (c === "\\") {
            const n = pattern[i + 1];
            if (n === "x" && HEX.test(pattern[i + 2] ?? "") && HEX.test(pattern[i + 3] ?? "")) {
                // Postgres keeps reading hex digits after \x, so \x41B would mean U+41B there.
                if (HEX.test(pattern[i + 4] ?? "")) problems.push(`\\x at ${i} is followed by a hex digit`);
                i += 3;
            } else if (n !== undefined && LITERAL_ESCAPES.has(n)) i += 1;
            else { problems.push(`\\${n ?? ""} at ${i}: write the characters out, like [0-9] for \\d`); i += 1; }
        } else if (inClass) {
            if (c === "]") inClass = false;
        } else if (c === "[") {
            inClass = true;
            if (pattern[i + 1] === "^") i++;
            // JS reads [] as an empty class; Go, Python and Postgres read a leading ] as a literal.
            if (pattern[i + 1] === "]") problems.push(`[] at ${i}: write \\] for a literal ]`);
        } else if (c === ".") {
            problems.push(`. at ${i}: engines disagree on which line breaks it excludes; use a [^...] class`);
        } else if (c === "(" && pattern[i + 1] === "?") {
            if (pattern[i + 2] === ":") i += 2;
            else problems.push(`(?${pattern[i + 2] ?? ""} at ${i}: only (...) and (?:...) groups are portable`);
        }
    }
    return problems;
}
