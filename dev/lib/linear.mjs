// Dev-only: proves a pattern runs in linear time in backtracking engines (Python re, JS RegExp, browsers).
// Go and Rust never backtrack, so this only matters for the others, but the rule is the same everywhere.
//
// A backtracking engine tries every way the pattern can match each prefix of the input, so it is linear
// exactly when the number of ways is bounded. In automaton terms: the pattern's position (Glushkov)
// automaton, with every state accepting, has neither exponential (EDA) nor polynomial (IDA) ambiguity.
// That is decidable here because the portable subset has no backreferences or lookaround.
import { LITERAL_ESCAPES } from "./portable.mjs";

const MAX_CODE_POINT = 0x10ffff;
const HEX2 = /^[0-9A-Fa-f]{2}$/;
const HEX = /^[0-9A-Fa-f]$/;
/** Counted repeats above this are widened to * or + for the proof: that only adds ways to match. */
const MAX_COPIES = 4;

// ---------------------------------------------------------------------------------------------- parser

/**
 * The syntax tree of a portable pattern; throws on anything outside the subset portable.mjs allows.
 * Nodes: { kind: "class", ranges, at } (sorted, merged code-point intervals; `at` is its offset in the
 * pattern), { kind: "concat", items }, { kind: "alt", items }, { kind: "repeat", min, max, body }.
 */
export function parsePattern(pattern) {
    const cps = [...pattern];
    let i = 0;
    const fail = (why) => { throw new Error(`${why} at ${i} in ${pattern}`); };

    if (cps[0] !== "^") fail("must start with ^");
    i = 1;
    const tree = alternation();
    if (cps[i] !== "$" || i !== cps.length - 1) fail("expected $ at the end");
    return tree;

    function alternation() {
        const items = [sequence()];
        while (cps[i] === "|") { i++; items.push(sequence()); }
        return items.length === 1 ? items[0] : { kind: "alt", items };
    }

    function sequence() {
        const items = [];
        while (i < cps.length && !"|)$".includes(cps[i])) {
            let node = atom();
            if (isQuantifier()) node = quantified(node);
            if (isQuantifier()) fail("a quantifier cannot follow a quantifier");
            items.push(node);
        }
        return items.length === 1 ? items[0] : { kind: "concat", items };
    }

    function isQuantifier() {
        return i < cps.length && "*+?{".includes(cps[i]);
    }

    function quantified(body) {
        const c = cps[i++];
        if (c === "*") return { kind: "repeat", min: 0, max: Infinity, body };
        if (c === "+") return { kind: "repeat", min: 1, max: Infinity, body };
        if (c === "?") return { kind: "repeat", min: 0, max: 1, body };
        const min = number();
        let max = min;
        if (cps[i] === ",") { i++; max = cps[i] === "}" ? Infinity : number(); }
        if (cps[i] !== "}") fail("unterminated {");
        i++;
        if (max < min) fail(`{${min},${max}} is out of order`);
        return { kind: "repeat", min, max, body };
    }

    function number() {
        const start = i;
        while (/^[0-9]$/.test(cps[i] ?? "")) i++;
        if (i === start) fail("expected a number");
        return Number(cps.slice(start, i).join(""));
    }

    function atom() {
        const at = i;
        const c = cps[i];
        if (c === "(") {
            i++;
            if (cps[i] === "?") {
                if (cps[i + 1] !== ":") fail("only (...) and (?:...) groups are portable");
                i += 2;
            }
            const inner = alternation();
            if (cps[i] !== ")") fail("unterminated (");
            i++;
            return inner;
        }
        if (c === "[") return charClass();
        if (c === "\\") return literal(escape(), at);
        if ("*+?{".includes(c)) fail("nothing to repeat");
        if ("^.]}".includes(c)) fail(`unescaped ${c}`);
        i++;
        return literal(c.codePointAt(0), at);
    }

    function escape() {
        const n = cps[i + 1];
        const hex = cps.slice(i + 2, i + 4).join("");
        if (n === "x" && HEX2.test(hex)) {
            // Postgres keeps reading hex digits after \x.
            if (HEX.test(cps[i + 4] ?? "")) fail("\\xHH is followed by a hex digit");
            i += 4;
            return parseInt(hex, 16);
        }
        if (n !== undefined && LITERAL_ESCAPES.has(n)) { i += 2; return n.codePointAt(0); }
        fail(`\\${n ?? ""} is not portable`);
    }

    function charClass() {
        const at = i;
        i++;
        const negated = cps[i] === "^";
        if (negated) i++;
        if (cps[i] === "]") fail("[] or a leading ]: write \\] for a literal ]");
        const ranges = [];
        while (cps[i] !== "]") {
            const lo = classChar();
            let hi = lo;
            if (cps[i] === "-" && cps[i + 1] !== "]" && cps[i + 1] !== undefined) {
                i++;
                hi = classChar();
                if (hi < lo) fail("range out of order");
            }
            ranges.push([lo, hi]);
        }
        i++;
        const merged = merge(ranges);
        return { kind: "class", ranges: negated ? complement(merged) : merged, at };
    }

    function classChar() {
        if (i >= cps.length) fail("unterminated [");
        if (cps[i] === "\\") return escape();
        return cps[i++].codePointAt(0);
    }
}

const literal = (cp, at) => ({ kind: "class", ranges: [[cp, cp]], at });

/** Sorts intervals and joins the ones that overlap or touch. */
function merge(ranges) {
    const out = [];
    for (const [lo, hi] of [...ranges].sort((a, b) => a[0] - b[0])) {
        const last = out.at(-1);
        if (last && lo <= last[1] + 1) last[1] = Math.max(last[1], hi);
        else out.push([lo, hi]);
    }
    return out;
}

function complement(ranges) {
    const out = [];
    let next = 0;
    for (const [lo, hi] of ranges) {
        if (lo > next) out.push([next, lo - 1]);
        next = hi + 1;
    }
    if (next <= MAX_CODE_POINT) out.push([next, MAX_CODE_POINT]);
    return out;
}

function intersect(a, b) {
    const out = [];
    for (let i = 0, j = 0; i < a.length && j < b.length;) {
        const lo = Math.max(a[i][0], b[j][0]);
        const hi = Math.min(a[i][1], b[j][1]);
        if (lo <= hi) out.push([lo, hi]);
        if (a[i][1] < b[j][1]) i++;
        else j++;
    }
    return out;
}

// --------------------------------------------------------------------------------------------- lengths

/** Shortest and longest match in code points; max is Infinity when unbounded. */
export function matchLengths(pattern) {
    return lengths(parsePattern(pattern));
}

function lengths(node) {
    switch (node.kind) {
        case "class": return { min: 1, max: 1 };
        case "concat": return node.items.map(lengths).reduce((a, b) => ({ min: a.min + b.min, max: a.max + b.max }), { min: 0, max: 0 });
        case "alt": {
            const all = node.items.map(lengths);
            return { min: Math.min(...all.map((l) => l.min)), max: Math.max(...all.map((l) => l.max)) };
        }
        case "repeat": {
            const body = lengths(node.body);
            // An empty body repeated without bound is still empty (0 * Infinity would be NaN).
            return { min: body.min * node.min, max: body.max === 0 ? 0 : body.max * node.max };
        }
    }
}

// ------------------------------------------------------------------------------------------- automaton

/** Rewrites counted repeats into copies, ?, * and +; large or unbounded ones become * or +. */
function widen(node) {
    switch (node.kind) {
        case "class": return node;
        case "concat":
        case "alt": return { kind: node.kind, items: node.items.map(widen) };
        case "repeat": {
            const body = widen(node.body);
            if (node.max > MAX_COPIES) return { kind: "repeat", min: Math.min(node.min, 1), max: Infinity, body };
            if (node.min === 0 && node.max === 1) return { kind: "repeat", min: 0, max: 1, body };
            // x{2,4} becomes x x (x (x)?)?: nested, so each count has one parse, as in the engine.
            let optional = null;
            for (let k = node.min; k < node.max; k++) {
                optional = { kind: "repeat", min: 0, max: 1, body: optional ? { kind: "concat", items: [body, optional] } : body };
            }
            const items = Array(node.min).fill(body);
            if (optional) items.push(optional);
            return items.length === 1 ? items[0] : { kind: "concat", items };
        }
    }
}

/**
 * The position automaton: state 0 is the start, state p > 0 is the p-th class occurrence, entered only
 * by reading a character of classes[p]. follow[p] lists the states reachable in one step.
 */
function automaton(tree) {
    const classes = [null];
    const at = [null];
    const follow = [[]];
    const link = (from, to) => { for (const p of from) follow[p].push(...to); };

    function walk(node) {
        switch (node.kind) {
            case "class": {
                const p = classes.length;
                classes.push(node.ranges);
                at.push(node.at);
                follow.push([]);
                return { nullable: false, first: [p], last: [p] };
            }
            case "concat": {
                let acc = { nullable: true, first: [], last: [] };
                for (const item of node.items) {
                    const g = walk(item);
                    link(acc.last, g.first);
                    acc = {
                        nullable: acc.nullable && g.nullable,
                        first: acc.nullable ? [...acc.first, ...g.first] : acc.first,
                        last: g.nullable ? [...acc.last, ...g.last] : g.last,
                    };
                }
                return acc;
            }
            case "alt": {
                const all = node.items.map(walk);
                return { nullable: all.some((g) => g.nullable), first: all.flatMap((g) => g.first), last: all.flatMap((g) => g.last) };
            }
            case "repeat": {
                const g = walk(node.body);
                if (node.max === Infinity) link(g.last, g.first);
                return { ...g, nullable: g.nullable || node.min === 0 };
            }
        }
    }

    follow[0] = walk(widen(tree)).first;
    return { classes, at, follow };
}

/** Every key reachable from `starts` (included) through `next(key)`. */
function reachable(starts, next) {
    const seen = new Set(starts);
    const queue = [...starts];
    while (queue.length) for (const k of next(queue.pop())) if (!seen.has(k)) { seen.add(k); queue.push(k); }
    return seen;
}

// ------------------------------------------------------------------------------------------- ambiguity

/** Every reason the pattern may take super-linear time in a backtracking engine; empty means proven linear. */
export function linearProblems(pattern) {
    const g = graph(automaton(parsePattern(pattern)));
    return [exponential(g), polynomial(g)].filter(Boolean);
}

/** The automaton plus what both checks need: reachability, components and shared letters. */
function graph({ classes, at, follow }) {
    const n = classes.length;
    const states = [...Array(n).keys()];
    const preceding = states.map(() => []);
    for (const p of states) for (const q of follow[p]) preceding[q].push(p);
    // reach[p] holds what p reaches in one or more steps.
    const reach = states.map((p) => reachable(follow[p], (q) => follow[q]));
    const cyclic = (p) => reach[p].has(p);
    const sameScc = (p, q) => p === q ? cyclic(p) : reach[p].has(q) && reach[q].has(p);
    // Two moves share a letter when their target classes intersect.
    const shared = states.map((p) => states.map((q) => p && q ? intersect(classes[p], classes[q]) : []));
    return { n, classes, at, follow, preceding, reach, cyclic, sameScc, shared, loops: states.filter(cyclic) };
}

/**
 * EDA: some state p has two different loops that read the same word, so the ways to match double on
 * every turn. Either one step is added twice by a nested repeat, like (a+)+, or the pair automaton has a
 * cycle through (p, p) and some (a, b) with a != b. Every state on such a cycle is in p's component.
 */
function exponential({ n, at, follow, preceding, sameScc, shared, loops }) {
    for (const [u, steps] of follow.entries()) {
        const twice = steps.find((v, k) => steps.indexOf(v) !== k && sameScc(u, v));
        if (twice !== undefined) return `exponential ambiguity at positions ${at[u]}/${at[twice]}`;
    }
    const pair = (a, b) => a * n + b;
    const unpair = (key) => [Math.floor(key / n), key % n];
    for (const p of loops) {
        const inside = (x) => sameScc(p, x);
        const forward = reachable([pair(p, p)], (key) => {
            const [a, b] = unpair(key);
            return follow[a].filter(inside).flatMap((a2) =>
                follow[b].filter((b2) => inside(b2) && shared[a2][b2].length).map((b2) => pair(a2, b2)));
        });
        // Backwards, the shared letter is the one read on entering the current pair.
        const backward = reachable([pair(p, p)], (key) => {
            const [a, b] = unpair(key);
            if (!shared[a][b].length) return [];
            return preceding[a].filter(inside).flatMap((a0) => preceding[b].filter(inside).map((b0) => pair(a0, b0)));
        });
        for (const key of forward) {
            const [a, b] = unpair(key);
            if (a !== b && backward.has(key)) return `exponential ambiguity at positions ${at[a]}/${at[b]}`;
        }
    }
    return null;
}

/**
 * IDA: states p != q and one word that loops p -> p, goes p -> q and loops q -> q, so the ways to match
 * grow as a power of the length. That is, the triple automaton reaches (p, q, q) from (p, p, q). The
 * first track stays in p's component, the third in q's, and the second between p and q.
 */
function polynomial({ n, classes, at, follow, reach, sameScc, shared, loops }) {
    const triple = (a, b, c) => (a * n + b) * n + c;
    const untriple = (key) => [Math.floor(key / (n * n)), Math.floor(key / n) % n, key % n];
    for (const p of loops) {
        for (const q of loops.filter((q) => q !== p && reach[p].has(q))) {
            const first = (x) => sameScc(p, x);
            const second = (x) => (x === p || reach[p].has(x)) && (x === q || reach[x].has(q));
            const third = (x) => sameScc(q, x);
            const moves = (key) => {
                const [a, b, c] = untriple(key);
                const out = [];
                for (const a2 of follow[a].filter(first)) {
                    for (const b2 of follow[b].filter((b2) => second(b2) && shared[a2][b2].length)) {
                        for (const c2 of follow[c].filter(third)) {
                            if (intersect(shared[a2][b2], classes[c2]).length) out.push(triple(a2, b2, c2));
                        }
                    }
                }
                return out;
            };
            if (reachable([triple(p, p, q)], moves).has(triple(p, q, q))) {
                return `polynomial ambiguity between positions ${at[p]} and ${at[q]}`;
            }
        }
    }
    return null;
}
