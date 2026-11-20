# Handoff

State of the project for whoever picks it up next. Last updated 2026-11-20, at release 0.4.0 (generated language files, checks, `gln`, CI).

## Where things stand

- **0.4.0 is released** (tag `v0.4.0`). Since 0.3.0 the shape of `dist/scalars.json` is now **stable**: releases add or fix types, but never rename or move a field. Anything that would break that waits for a 1.0 discussion.
- **Goal:** one JSON definition per data type that works the same in Go, Python, Rust and TypeScript (the main four), plus HTML forms, JSON Schema/OpenAPI and Postgres. Languages read the core of each type; the `html` and `postgres` blocks only say how those two spell it.
- **Generated code (since 0.4.0):** `dist/python/scalars.py`, `dist/ts/scalars.ts`, `dist/go/` (`scalars.go` and `go.mod`) and `dist/rust/scalars.rs`. One file per language, built from `dist/scalars.json` by `dev/codegen/`. Each has `validate` / `is_valid` per type (and `normalize`: every type in Python and TypeScript, text types in Go and Rust), `get` by name or alias, and `all`. Python and TypeScript need no dependencies, Go needs `golang.org/x/text`, Rust needs `regex` (each header names the tested versions). Rust `Meta` has no examples, and Go leaves out the 4 object-valued ones (in `any`, `array`, `object`) so the package needs no init code.
- **Linear guarantee:** `validate` is O(n) worst case in all four languages. The build rejects any pattern that isn't provably linear, and every check (below) is a single pass with no big integers.
- **Checks (since 0.4.0):** a type can name a rule beyond its pattern with `check`. Seven exist: check digits for `gtin`, `gln`, `iban`, `lei`, `isbn` and `orcid`, and the 64-bit range for `int64` and `uint64` (which used to accept any run of digits, so `validate` passed values Postgres refused). Only the four languages and `dev/lib/reference.mjs` run them. JSON Schema and HTML check the pattern alone. Postgres catches the 64-bit range (bigint, and uint64's CHECK) but not check digits.
- **README is quick-start first:** one `curl` command and a short example per language, then a method table across the four, the core type table, the JSON files (forms, OpenAPI, Postgres), edge cases, and editing types last. Each quick start was run from scratch in a fresh project on 2026-11-13. The download links point at the release tag (`v0.4.0`); move them to the new tag with each release. Keep the method table and examples in step with `dev/codegen/` when the API changes.
- **CI:** `.github/workflows/test.yml` runs `npm test`, `npm run check:langs` and `go test -race` on pushes to `main` and on pull requests. All green since its first run on 2026-11-20. It's the only place `go test -race` runs, since the dev machine has no C compiler.
- **`tsc --strict` passes** on `dist/ts/scalars.ts` (TypeScript 5, checked by hand on 2026-11-20). It isn't in CI; the TS runner uses Node's type stripping, which doesn't type-check.
- **Tests, all passing:** `cd dev && npm test` (188 tests: JSON Schema, the browser's regex engine, real Postgres via PGlite) and `npm run check:langs` (TypeScript, Python, Go, Rust).

## How a type reads in dist (since 0.3.0)

- `primitive`: one of 16. It's all a language needs to choose a native type.
- `schema`: plain JSON Schema keywords (`type`, `format`, `pattern`, `minLength`, `maxLength`, `minimum`, `maximum`, `contentEncoding`).
- `params`: settings a field can take (`length`, `precision`, `scale`, `fractional_seconds`, `values`), defined once in `$meta.params`. `nullable` applies to every type and isn't listed.
- `normalize`: cleanup steps, defined in `$meta.normalize_steps`. `$meta.lookup` gives the rule for finding a type from a word.
- `check` (on 8 types): a rule run on the normalized value after the pattern matched, defined in `$meta.checks`. `examples.check_invalid` holds values that pass the pattern but fail the check.
- `html`, `postgres`: generated pattern, CHECK and attrs. `postgres.attr` names entries in `$meta.postgres_attrs`; only `enum` and `duration` have one.

## Rules that are easy to break

- **Patterns must be provably linear** (`dev/lib/linear.mjs`). The build fails on nested repeats that yield the same step twice, or on ambiguity that grows with the input. If it rejects a pattern, rewrite it to name one split point, as `email` does.
- **Patterns use the portable subset** (`dev/lib/portable.mjs`, based on RFC 9485): no `\d \s \w`, no `.`, no lookaround or backreferences, no leading `]` in a class, and no `\xHH` followed by a hex digit. The build fails otherwise. Write `[0-9]`, not `\d`.
- **Python:** use `re.fullmatch`, since `$` alone also matches before a trailing newline. Python's `str.strip()` and JS's `trim()` use different whitespace sets from the trim step, so implementations write the set out.
- **Go:** case steps need `golang.org/x/text/cases`. `strings.ToLower` turns `İ` into `i` and leaves `ß` alone.
- **Text must be well-formed Unicode:** JS and Python strings can hold lone surrogates and Go strings can hold invalid UTF-8; every engine (and `reference.mjs`) rejects them right after trim, before `remove_*` steps (which could join two halves in JS and Go but not Python) and after an O(1) over-length gate. Rust's `&str` can't hold them. Cases marked `"malformed": "surrogate"` are skipped by the Go and Rust runners, since their JSON decoders can't carry a lone surrogate.
- **Lengths count code points** everywhere except the HTML `maxlength` attribute, which counts UTF-16 units.
- **`params` is not inherited**: list it on every type that takes it. Every other core key is inherited from `base` (`null` deletes).
- **Every type with a `check` needs at least 2 `check_invalid` examples, and no other type may have any.** They must pass JSON Schema and the HTML pattern. Range values that Postgres rejects also go in `db_invalid`, since `check_invalid` values are never inserted into Postgres.
- **Adding a check touches four places:** `schema/scalar.schema.json` `$defs.check` (name and meaning), `CHECKS` in `dev/lib/reference.mjs`, and each `engine.*`. In `engine.go` name the constant `check` + the PascalCase check name (`iso7064_mod11_2` → `checkIso7064Mod112`); in `engine.rs` name the `Check` variant the PascalCase name (`Iso7064Mod112`). The emitters derive those names and fail the build if the engine lacks them or two names collide. A new normalize step works the same way (`step` + PascalCase in Go, a PascalCase `Step` variant in Rust). Port a check over ASCII bytes or code units, reduce mod as you go (no big integers, no growing totals), and run it only after the pattern matched.
- **`invalid` examples are raw-pattern rejects:** a few become valid after `normalize` (e.g. `country` "us"), and the runners accept that only when normalize changes the value.
- **Generated files:** never edit `dist/python`, `dist/ts`, `dist/go` or `dist/rust` by hand. Change `dev/codegen/` and run `npm run build`. The hand-written parts are `dev/codegen/engine.{py,ts,go,rs}`.
- **Source edits:** the Bash tool on this Windows machine collapses `\\` to `\`, even in quoted heredocs. Write scripts that touch patterns with a file editor, never with shell heredocs.

## Layout

- `src/`: what you edit. `scalar.json` holds the core, `targets/html.json` and `targets/postgres.json` hold the two targets.
- `dist/`: the generated release. `npm run build` rewrites it, and a test fails if the committed copy is stale.
- `schema/`: JSON Schemas for the source and dist files.
- `dev/codegen/`: the generator. `model.mjs` is the shared model, `generate.mjs` drives it, `python.mjs` `ts.mjs` `go.mjs` `rust.mjs` write each language, and `engine.*` is the hand-written runtime each one embeds.
- `dev/`: build, tests, and `dev/langs/` (one runner per language, plus the shared `cases.json`).
- `.github/workflows/test.yml`: CI.
- `coding/`: the owner's own gitignored scratch folder. Leave it alone.

## Known follow-ups from the models branch (to fix)

Minor findings from the per-task reviews of the `models` work (spec and plan: `docs/superpowers/specs/2026-11-20-models-design.md`, `docs/superpowers/plans/2026-11-20-models.md`). None blocks the feature; each is a known gap to close. The final whole-branch review may move some of these into "fix before merge".

- **64-bit integer edges (pre-existing, not models code):** the JS reference compares integer bounds as JS numbers (`Number(maxInt64)` is 2^63), so it may accept `9223372036854775808` where Go and Python refuse it. Rust accepts `-9223372036854775809`, because serde_json reads it as a float equal to -2^63. No shared case pins ±2^63 or values above 2^53. Add those cases to `dev/langs/cases.json` and make all five agree.
- **Python returns a float for number fields** (`3` → `3.0`), on purpose (engine.py: "the native value of a number type is a float"). TS, Go and Rust return `3`. Numerically equal as JSON, but the text differs, so the shared cases use `1.5`. Decide whether Python should keep numbers as given.
- **Alias collisions:** Python's `get` lets the first type with an alias win, the JS reference the last. Latent, since no two types share an alias today. Add a build-time check that aliases are unique.
- **Public constructors:** TS `Model` / `Models` (and probably Python's) can be built by callers from internal maps, skipping load's checks. Make them internal or document "use `models()`".
- **Models JSON Schema tests:** they check the setting keys against `$meta.params`, but not the ranges or types, and not that duplicate or non-string `values` are refused.
- **Codegen tests:** the `metaFields` test covers only `email` (not the optional `params`, `check`, `maxLen`, `minimum`, `maximum`). `header()` quietly falls back to `//` for an unknown file extension. The engine-name regexes are loose (the compilers back them up). The Go helper `mod97` keeps its old name while the constant is now `checkIso7064Mod9710`.
- **Pinned versions copied by hand:** `SERDE_JSON_VERSION` and `REGEX_VERSION` in `rust.mjs` are copies of `dev/langs/rust/Cargo.lock` and can drift. Read them from the lock file or test that they match.
- **Not run anywhere:** Python 3.10 (header says ≥ 3.10; CI uses 3.12) and Rust 1.80 (header says ≥ 1.80; only 1.97 was run). Add them to CI, or raise the stated minimums.
- **Hostile timing:** `wide_list` (200,000 items) takes ~1.0–1.6 s of its 2 s bound in Python and ~0.9 s in Rust's debug runner, mostly the existing `gtin` check. If CI flakes, halve the count: it still tells linear from quadratic.
- **Python runner:** compares `out` with sorted keys, so declared key order isn't checked (not a spec requirement).
- **README:** the Quick start Rust line says it needs only `regex` (true for the linked v0.4.0 file, wrong once models ship: `cargo add regex serde_json`). Fix it at the next release. "No extra keys" next to "undeclared keys are errors" reads as a contradiction; say "the cleaned payload has only declared keys". The Errors row of the method table is cramped.
- **Go payloads** must be what `encoding/json` produces; hand-built `int`, `[]string` or `json.Number` are refused. That's the spec, and the README says so; revisit if Go users ask.

## Possible next steps (none promised)

- **Source as YAML:** convert `src/scalar.json` to a single `src/scalar.yaml` (YAML 1.2, the `yaml` dev dependency) for comments, unescaped patterns and wrapped text. Convert with an established tool (`yq` or the `yaml` CLI), not a hand-written script, preferring single-quoted patterns. `dist/` stays JSON and must build byte-identical, with a test that every example keeps its type. Decided: one file, no split by type, domain or primitive.

- Add or fix types without changing the shape. Each new type needs `valid` examples, at least 2 `invalid` ones if it has a rule, and a `level`.
- `format`-only types (dates, `uri`, …) are checked by pattern where they have one. Their `format` keyword isn't validated by the runners.
- Follow-ups from the `docs/info.md` review (approved in principle, not designed):
  - **Closed ISO code lists** for `country`, `country_alpha3` and `currency` (later `language`): an O(1) set lookup, `CHECK (col IN (...))` in Postgres, and a `<datalist>` for forms. Skip `timezone` and `subdivision`, whose lists change too often or are too big.
  - **New identifier types** that reuse the checks: `sscc` (GS1 mod 10), `un_locode`, `gpc_brick`, `spdx_license`.
  - **Why a value failed:** `ScalarError` could carry a reason (`malformed`, `too_long`, `pattern`, `check`, `not_in_list`) for RFC 9457 problem responses.
  - **Postgres functions for check digits,** so the database enforces them too.
- Deferred on purpose: units and quantities (UCUM, which needs two fields, so a schema), translated labels, hints and errors, and JSON-LD mappings.

## History

- 0.4.0 (2026-11-20): the generated language files and the checks below, tagged `v0.4.0` once CI passed. A release is: bump `version` in `src/scalar.json` and the two asserts in `dev/test/build.test.mjs`, `npm run build`, date the changelog's "Unreleased" heading, move the README links to the new tag, then tag and push.

- Checks (2026-11-20): `check` and `$meta.checks`, `examples.check_invalid`, the `gln` type, the 64-bit range fix (from an outside review), `isbn` uppercasing its final `x` and a corrected example, a test that cleanup leaves validated values unchanged, and CI. A fresh reviewer ran 160,000 random inputs through the reference and all four languages: no disagreements. The spec and plan are in git history (`docs/superpowers/specs/2026-11-20-checks-design.md`, `docs/superpowers/plans/2026-11-20-checks.md`, removed once merged).

- README rewrite (2026-11-13): quick start per language at the top, and the `dev/langs/` runners described as tests of the generated files, not usage examples.

- Codegen (2026-11-13): generated Go, Python, Rust and TypeScript packages in `dist/`. The spec and plan are in git history (`docs/superpowers/specs/2026-11-12-codegen-design.md`, `docs/superpowers/plans/2026-11-12-codegen.md`, removed once merged).

- 0.3.0 (2026-11-12): portable patterns, `params` in the core, `schema` block, closed `primitive`, removed `category`/`templates`, runners in four languages. The details are in [CHANGELOG.md](../CHANGELOG.md), and the full plan is in git history (`docs/superpowers/plans/2026-11-12-scalars-0.3.0.md`, removed in the commit that added this file).
- 0.2.0 (2026-11-12): first pure-JSON release. The plan is in git history (`docs/superpowers/plans/2026-11-12-scalar-core-v2.md`).
