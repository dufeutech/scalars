# Handoff

State of the project for whoever picks it up next. Last updated 2026-11-12, at release 0.3.0.

## Where things stand

- **0.3.0 is released** (tag `v0.3.0`). The shape of `dist/scalars.json` is now **stable**: releases add or fix types, but never rename or move a field. Anything that would break that waits for a 1.0 discussion.
- **Goal:** one JSON definition per data type that works the same in Go, Python, Rust and TypeScript (the main four), plus HTML forms, JSON Schema/OpenAPI and Postgres. Languages read the core of each type; the `html` and `postgres` blocks only say how those two spell it.
- **Generated code:** `dist/python/scalars.py`, `dist/ts/scalars.ts`, `dist/go/` (`scalars.go` and `go.mod`) and `dist/rust/scalars.rs`. One file per language, built from `dist/scalars.json` by `dev/codegen/`. Each has `validate` / `is_valid` per type, `get` by name or alias, and `all`. Python and TypeScript need no dependencies, Go needs `golang.org/x/text`, Rust needs `regex` (each header names the tested versions). Rust `Meta` has no examples, and Go leaves out the 4 object-valued ones (in `any`, `array`, `object`) so the package needs no init code.
- **Linear guarantee:** `validate` is O(n) worst case in all four languages. The build rejects any pattern that isn't provably linear.
- **Not run yet:** `go test -race`. The dev machine has no C compiler, so run it where cgo works.
- **Checks, all passing:** `cd dev && npm test` (182 tests: JSON Schema, the browser's regex engine, real Postgres via PGlite) and `npm run check:langs` (TypeScript, Python, Go, Rust).

## How a type reads in dist (0.3.0)

- `primitive`: one of 16. It's all a language needs to choose a native type.
- `schema`: plain JSON Schema keywords (`type`, `format`, `pattern`, `minLength`, `maxLength`, `minimum`, `maximum`, `contentEncoding`).
- `params`: settings a field can take (`length`, `precision`, `scale`, `fractional_seconds`, `values`), defined once in `$meta.params`. `nullable` applies to every type and isn't listed.
- `normalize`: cleanup steps, defined in `$meta.normalize_steps`. `$meta.lookup` gives the rule for finding a type from a word.
- `html`, `postgres`: generated pattern, CHECK and attrs. `postgres.attr` names entries in `$meta.postgres_attrs`; only `enum` and `duration` have one.

## Rules that are easy to break

- **Patterns must be provably linear** (`dev/lib/linear.mjs`). The build fails on nested repeats that yield the same step twice, or on ambiguity that grows with the input. If it rejects a pattern, rewrite it to name one split point, as `email` does.
- **Patterns use the portable subset** (`dev/lib/portable.mjs`, based on RFC 9485): no `\d \s \w`, no `.`, no lookaround or backreferences, no leading `]` in a class, and no `\xHH` followed by a hex digit. The build fails otherwise. Write `[0-9]`, not `\d`.
- **Python:** use `re.fullmatch`, since `$` alone also matches before a trailing newline. Python's `str.strip()` and JS's `trim()` use different whitespace sets from the trim step, so implementations write the set out.
- **Go:** case steps need `golang.org/x/text/cases`. `strings.ToLower` turns `İ` into `i` and leaves `ß` alone.
- **Text must be well-formed Unicode:** JS and Python strings can hold lone surrogates and Go strings can hold invalid UTF-8; every engine (and `reference.mjs`) rejects them first thing in the text check. Rust's `&str` can't hold them. Cases marked `"malformed": "surrogate"` are skipped by the Go and Rust runners, since their JSON decoders can't carry a lone surrogate.
- **Lengths count code points** everywhere except the HTML `maxlength` attribute, which counts UTF-16 units.
- **`params` is not inherited**: list it on every type that takes it. Every other core key is inherited from `base` (`null` deletes).
- **`invalid` examples are raw-pattern rejects:** a few become valid after `normalize` (e.g. `country` "us"), and the runners accept that only when normalize changes the value.
- **Generated files:** never edit `dist/python`, `dist/ts`, `dist/go` or `dist/rust` by hand. Change `dev/codegen/` and run `npm run build`. The hand-written parts are `dev/codegen/engine.{py,ts,go,rs}`.
- **Source edits:** the Bash tool on this Windows machine collapses `\\` to `\`, even in quoted heredocs. Write scripts that touch patterns with a file editor, never with shell heredocs.

## Layout

- `src/`: what you edit. `scalar.json` holds the core, `targets/html.json` and `targets/postgres.json` hold the two targets.
- `dist/`: the generated release. `npm run build` rewrites it, and a test fails if the committed copy is stale.
- `schema/`: JSON Schemas for the source and dist files.
- `dev/codegen/`: the generator. `model.mjs` is the shared model, `generate.mjs` drives it, `python.mjs` `ts.mjs` `go.mjs` `rust.mjs` write each language, and `engine.*` is the hand-written runtime each one embeds.
- `dev/`: build, tests, and `dev/langs/` (one runner per language, plus the shared `cases.json`).
- `coding/`: the owner's own gitignored scratch folder. Leave it alone.

## Possible next steps (none promised)

- Add or fix types without changing the shape. Each new type needs `valid` examples, at least 2 `invalid` ones if it has a rule, and a `level`.
- `format`-only types (dates, `uri`, …) are checked by pattern where they have one. Their `format` keyword isn't validated by the runners.

## History

- 0.3.0 (2026-11-12): portable patterns, `params` in the core, `schema` block, closed `primitive`, removed `category`/`templates`, runners in four languages. The details are in [CHANGELOG.md](../CHANGELOG.md), and the full plan is in git history (`docs/superpowers/plans/2026-11-12-scalars-0.3.0.md`, removed in the commit that added this file).
- 0.2.0 (2026-11-12): first pure-JSON release.
