# Handoff

State of the project for whoever picks it up next. Last updated 2026-11-21, after 0.6.2 (closed BCP 47 language list).

**Keep this file current:** after every big event (a release, a merged feature, a CI break and its fix, a finished review), update this handoff and commit it as its own `docs(handoff)` commit, without waiting to be asked.

## Where things stand

- **0.6.2** (2026-11-21): `language` is a closed BCP 47 list. 0.6.1 before it fixed Go's count of an encoded lone surrogate. Tag `v0.6.0`, `v0.6.1` and `v0.6.2` once the owner approves the push and CI passes. There is **no compatibility promise before 1.0**: a release may rename, move or remove anything when that gives the cleaner design, and says so in the changelog.
- **Reasons (since 0.6.0):** every failed `validate` carries one reason from `$meta.reasons` (`src/scalar.json` `$defs.reasons`): `wrong_kind`, `malformed`, `too_long`, `too_short`, `pattern`, `out_of_range`, `check`, `not_in_list`, in the order the single pass checks them; a value breaking several gets the first. `dev/lib/reference.mjs` defines the order and `dev/langs/cases.json` pins it (every `ok: false` case has a `reason`, with cases where two gates compete). Engines never spell a reason: the names are emitted (TS `Reason` + `FAIL`, Python `Reason` + `_FAIL`, Go `Reason*` constants, Rust `enum Reason`), and a codegen test greps the engines. Models report the reason as the problem `code` (no more `invalid`), with `params.type` on every type-field problem.
- **Closed lists (since 0.6.0):** `country`, `country_alpha3`, `currency` and (since 0.6.2) `language` have a core `enum` (dist `schema.enum`), checked last, after `check`. Sources and dates are in each type's `details` (Debian `iso-codes` for ISO 3166-1, SIX `list-one.xml` for ISO 4217, the IANA Language Subtag Registry for `language`: its `Type: language` records minus `Deprecated` and the private-use `qaa..qtz`, 8,043 codes, about 50 KB per dist file). The registry gives one code per language, so `fra` and `iw` fail. Engines: TS `Set`, Python `frozenset`, Go sorted slice + `slices.BinarySearch` (no map, so no init code), Rust sorted `&[&str]` + `binary_search`. Postgres keeps the pattern CHECK only.
- **Goal:** one JSON definition per data type that works the same in Go, Python, Rust and TypeScript (the main four), plus HTML forms, JSON Schema/OpenAPI and Postgres. Languages read the core of each type; the `html` and `postgres` blocks only say how those two spell it.
- **Generated code (since 0.4.0):** `dist/python/scalars.py`, `dist/ts/scalars.ts`, `dist/go/` (`scalars.go` and `go.mod`) and `dist/rust/scalars.rs`. One file per language, built from `dist/scalars.json` by `dev/codegen/`. Each has `validate` / `is_valid` per type (and `normalize`: every type in Python and TypeScript, text types in Go and Rust), `get` by name or alias, and `all`. Python and TypeScript need no dependencies, Go needs `golang.org/x/text`, Rust needs `regex` and `serde_json` (each header names the tested versions, read from the runners' `go.mod` and `Cargo.lock` by `lockedVersion` in `dev/codegen/common.mjs`). Rust `Meta` has no examples, and Go leaves out the 4 object-valued ones (in `any`, `array`, `object`) so the package needs no init code.
- **Linear guarantee:** `validate` is O(n) worst case in all four languages. The build rejects any pattern that isn't provably linear, and every check (below) is a single pass with no big integers.
- **Checks (since 0.4.0):** a type can name a rule beyond its pattern with `check`. Seven exist: check digits for `gtin`, `gln`, `iban`, `lei`, `isbn` and `orcid`, and the 64-bit range for `int64` and `uint64` (which used to accept any run of digits, so `validate` passed values Postgres refused). Only the four languages and `dev/lib/reference.mjs` run them. JSON Schema and HTML check the pattern alone. Postgres catches the 64-bit range (bigint, and uint64's CHECK) but not check digits.
- **README is quick-start first:** one `curl` command and a short example per language, then a method table across the four, the core type table, the JSON files (forms, OpenAPI, Postgres), edge cases, and editing types last. Each quick start was run from scratch in a fresh project on 2026-11-13. The download links point at the release tag (`v0.6.2`); move them to the new tag with each release (a test in `build.test.mjs` fails until you do). Keep the method table and examples in step with `dev/codegen/` when the API changes.
- **CI:** `.github/workflows/test.yml` has three jobs on pushes to `main` and on pull requests. `test` runs `npm test`, `npm run check:ts` (`tsc --strict` on `dist/ts/scalars.ts`, TypeScript pinned in `dev/package.json`), `npm run check:langs`, a quick `npm run fuzz:models -- 1 200`, and `go test -race`. `minimums` runs `npm run check:langs` on Python 3.10 and Rust 1.80, the oldest versions the headers promise. `go-minimum` builds and vets a copy of `dist/go` on Go 1.21, the minimum its `go.mod` states (the engines use nothing newer: `slices`, `min`, `max`; `golang.org/x/text` v0.21.0 needs 1.18). Green since its first run on 2026-11-20, except one break: `40b4db5` bounded `unix_time` but gave it only one `invalid` example, failing the conformance test; `57b83c9` added a second (2^53) and CI is green again. Run `npm test` before pushing, not after, and stop on a failure: the 0.5.0 release commit went out with a stray `dist/python/__pycache__` (from importing the dist file in place for a hand check), fixed in the next commit before tagging. CI is the only place `go test -race` runs, since the dev machine has no C compiler.
- **Models (released in 0.5.0):** users declare domains → models → fields as parsed JSON; every language has `models(data)`, `get("domain:model")`, `validate` and `is_valid`, reporting every bad field as `{pointer, code, params, message}`. The behaviour is defined by `dev/lib/models.mjs` and the shared `models` cases in `dev/langs/cases.json`; each language's hand-written engine is `dev/codegen/models.{py,ts,go,rs}`. Error templates live once in `src/scalar.json` `$defs.errors` (→ `$meta.errors`). Rust now also needs `serde_json`. The spec and plan are `docs/superpowers/specs/2026-11-20-models-design.md` and `docs/superpowers/plans/2026-11-20-models.md`.
- **Models constants live once:** `MAX_DEPTH`, the `NAME`/`REF` patterns and the digit settings are exported by `dev/lib/models.mjs` and emitted into the generated files next to `PARAM_RULES` (Go and Rust get `MAX_DEPTH` only; they parse names by hand and wire `precision`/`scale` into the logic, pinned by the shared cases). A codegen test fails if a hand-written engine defines them again.
- **Only `models()` builds a `Model` or `Models`:** TS and Python constructors take a module-private key and throw `TypeError` otherwise. Go's `Model.Name()` and `ModelSet.All()` are methods (`All` returns a copy), as in Rust.
- **Tests, all passing:** `cd dev && npm test` (353 tests: JSON Schema, the browser's regex engine, real Postgres via PGlite, the models reference) and `npm run check:langs` (TypeScript, Python, Go, Rust, including the shared models cases). `npm run fuzz:models -- [seed] [count]` (`dev/langs/fuzz.mjs`) generates random models files and payloads, takes the answers from `dev/lib/models.mjs`, and runs all four runners on them (on top of the shared cases); it prints the seed so a failure can be rerun. Seeds 1-5 at 600 files each (39,928 payloads) found no disagreement on 2026-11-21. Run more seeds by hand after an engine change; reduce any disagreement to a named shared case in `cases.json`.
- **Adding to models:** a new behaviour goes into the reference first, with a shared case; then all four engines. Mutation tests during the build kept finding behaviours no shared case pinned, so when you change an engine, plant a bug and check a shared case catches it.

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
- **Text must be well-formed Unicode:** JS and Python strings can hold lone surrogates and Go strings can hold invalid UTF-8; every engine (and `reference.mjs`) rejects them right after trim, before `remove_*` steps (which could join two halves in JS and Go but not Python) and after an exact over-length gate (counting stops at the limit; a lone surrogate counts as one code point, in Go too: `codePoints` in `engine.go` counts the 3-byte form `ED A0..BF 80..BF` as one), so over-long malformed text is `too_long` everywhere. Rust's `&str` can't hold them. Cases marked `"malformed": "surrogate"` are skipped by the Go and Rust runners, since their JSON decoders can't carry a lone surrogate.
- **Lengths count code points** everywhere except the HTML `maxlength` attribute, which counts UTF-16 units.
- **A text type taking `precision` needs a digits pattern** (`-?[0-9]+(\.[0-9]+)?` or a narrower form, listed in `DIGIT_PATTERNS` in `dev/lib/resolve.mjs`); the build fails otherwise, since the digit counting assumes that shape.
- **Enum values are at most 63 bytes as UTF-8** (`maxItemBytes` in `$meta.params.values`, the Postgres label limit, checked against PGlite). Postgres accepts an empty label, so `""` is allowed.
- **`params` is not inherited**: list it on every type that takes it. Every other core key is inherited from `base` (`null` deletes).
- **Every type with a rule needs at least 2 `invalid` examples,** and a rule means a `pattern`, a `minimum` or a `maximum`. Adding bounds to a type that had none (as with `unix_time`) makes it need them.
- **Every type with a `check` needs at least 2 `check_invalid` examples, and no other type may have any.** They must pass JSON Schema and the HTML pattern. Range values that Postgres rejects also go in `db_invalid`, since `check_invalid` values are never inserted into Postgres.
- **Adding a check touches four places:** `schema/scalar.schema.json` `$defs.check` (name and meaning), `CHECKS` in `dev/lib/reference.mjs`, and each `engine.*`. In `engine.go` name the constant `check` + the PascalCase check name (`iso7064_mod11_2` → `checkIso7064Mod112`); in `engine.rs` name the `Check` variant the PascalCase name (`Iso7064Mod112`). The emitters derive those names and fail the build if the engine lacks them or two names collide. A new normalize step works the same way (`step` + PascalCase in Go, a PascalCase `Step` variant in Rust). Port a check over ASCII bytes or code units, reduce mod as you go (no big integers, no growing totals), and run it only after the pattern matched.
- **A type with an `enum` needs at least 2 `list_invalid` examples, and no other type may have any.** They pass the pattern and normalize but are not on the list. The build checks each `enum` is text-only, sorted with no repeats, matches the pattern and is unchanged by normalize; `enum` is inherited, so a child with another pattern (as `country_alpha3` under `country`) must set its own.
- **A list update is a patch release (0.6.x),** shipped soon after ISO announces the change: an older release rejects a code ISO added after it. ISO 4217 changes about once a year, ISO 3166-1 rarely. Re-download, regenerate the arrays, update the source line in `details`.
- **`invalid` examples are raw-pattern rejects:** a few become valid after `normalize` (e.g. `country` "us"), and the runners accept that only when normalize changes the value.
- **Generated files:** never edit `dist/python`, `dist/ts`, `dist/go` or `dist/rust` by hand. Change `dev/codegen/` and run `npm run build`. The hand-written parts are `dev/codegen/engine.{py,ts,go,rs}`.
- **Source edits:** the Bash tool on this Windows machine collapses `\\` to `\`, even in quoted heredocs. Write scripts that touch patterns with a file editor, never with shell heredocs. This bit twice more on 2026-11-21 (`\r\n` and `\n` inside a JS heredoc): any edit containing a backslash goes through the file editor.
- **Don't import `dist/python/scalars.py` in place:** it leaves a `__pycache__` that fails "dist holds only built files". Copy the file elsewhere, or run with `-B`.

## Layout

- `src/`: what you edit. `scalar.json` holds the core, `targets/html.json` and `targets/postgres.json` hold the two targets.
- `dist/`: the generated release. `npm run build` rewrites it, and a test fails if the committed copy is stale.
- `schema/`: JSON Schemas for the source and dist files.
- `dev/codegen/`: the generator. `model.mjs` is the shared model, `generate.mjs` drives it, `python.mjs` `ts.mjs` `go.mjs` `rust.mjs` write each language, and `engine.*` is the hand-written runtime each one embeds.
- `dev/`: build, tests, and `dev/langs/` (one runner per language, plus the shared `cases.json`).
- `.github/workflows/test.yml`: CI.
- `coding/`: the owner's own gitignored scratch folder. Leave it alone.

## Models follow-ups: settled

All the findings from the models branch's reviews were worked through on 2026-11-21, before 0.5.0. Fixed: constructors (only `models()` builds a model), Go `Name`/`All` as methods, Rust `Value::from(&Problem)`, versions read from the lock files, `header()` failing on an unknown extension, the wider `metaFields` and models-schema tests, CI on Python 3.10 and Rust 1.80, the models constants emitted once, the 63-byte enum limit, the digits-pattern build check, and the README wording. These were decided, not changed:

- **Python returns a float for number fields** (`3` → `3.0`). Kept: Go, Rust and TS hold a float64 too, only the printed text differs, the README says so, and 0.4.0 scalars already did it.
- **Alias collisions** were already guarded: `test/human.test.mjs` fails if two types share an alias or an alias is a type name.
- **Go's `mod97` helper** keeps its name: it serves both `iso7064_mod97_10` and `iban`, named the same in all four engines.
- **Loose engine-name regexes** in the emitters stay; each compiler rejects a name the engine lacks.
- **Go payloads** must be what `encoding/json` produces (no `int`, `[]string`, `json.Number`). That's the spec, and the README says so; revisit if Go users ask.
- **Shared shape values:** `object` and `any` values come back as the input's own object in Python, TS and Go, a copy in Rust. Documented in the README.

## Possible next steps (none promised)

- **Source as YAML:** convert `src/scalar.json` to a single `src/scalar.yaml` (YAML 1.2, the `yaml` dev dependency) for comments, unescaped patterns and wrapped text. Convert with an established tool (`yq` or the `yaml` CLI), not a hand-written script, preferring single-quoted patterns. `dist/` stays JSON and must build byte-identical, with a test that every example keeps its type. Decided: one file, no split by type, domain or primitive.

- Add or fix types without changing the shape. Each new type needs `valid` examples, at least 2 `invalid` ones if it has a rule, and a `level`.
- `format`-only types (dates, `uri`, …) are checked by pattern where they have one. Their `format` keyword isn't validated by the runners.
- Follow-ups from the `docs/info.md` review (approved in principle, not designed):
  - **A `language` list:** done in 0.6.2 (BCP 47, IANA registry). Skip `timezone` and `subdivision`, whose lists change too often or are too big.
  - **New identifier types** that reuse the checks: `sscc` (GS1 mod 10), `un_locode`, `gpc_brick`, `spdx_license`.
  - **Postgres functions for check digits,** so the database enforces them too.
- Deferred on purpose: units and quantities (UCUM, which needs two fields, so a schema), translated labels, hints and errors, and JSON-LD mappings.

## History

- 0.6.2 (2026-11-21): `language` accepts only current BCP 47 language subtags from the IANA registry (File-Date 2026-11-18), chosen over ISO 639-2 or full 639-3 as the industry standard (HTML `lang`, `Accept-Language`, CLDR, `Intl`). Data only, through the 0.6.0 enum machinery; a planted bug (`fra` in the list) was caught. The spec and plan are in git history (`docs/superpowers/specs/2026-11-21-language-list-design.md`, `docs/superpowers/plans/2026-11-21-language-list.md`, removed in the commit that recorded it here).

- 0.6.1 (2026-11-21): Go's length gates count an encoded lone surrogate as one code point (`codePoints`), closing a minor from the 0.6.0 review; a cut-short surrogate counts as 2 invalid bytes and a CESU-8 pair as 2, pinned in `dev/langs/go/main.go`. Also the stale README sentence on models. Built inline from a plan, with a planted bug caught. The plan is in git history (`docs/superpowers/plans/2026-11-21-post-0.6.0.md`, removed in the commit that recorded it here).

- 0.6.0 (2026-11-21): failure reasons (`$meta.reasons`, `ScalarError.reason` in all four languages, models report the reason as the code) and closed ISO code lists for `country`, `country_alpha3` and `currency`. Built inline from a plan, with a bug planted per engine to prove a shared case catches it. The spec and plan are in git history (`docs/superpowers/specs/2026-11-21-lists-and-reasons-design.md`, `docs/superpowers/plans/2026-11-21-lists-and-reasons.md`, removed in the commit that recorded it here).

- Hardening (2026-11-21, no release): a test that README links use the current tag, `tsc --strict` and a Go 1.21 build in CI, the engines' dev-only pointer comments kept out of dist, and the random models test. The plan is in git history (`docs/superpowers/plans/2026-11-21-hardening.md`, removed in the commit that recorded it here).

- 0.5.0 (2026-11-21): models, plus the review follow-ups above, tagged `v0.5.0` once CI passed on both jobs. The Rust quick start (now `cargo add regex serde_json`) was run from scratch with models and `Value::from`. The changelog has no "Unreleased" heading now; add one with the next change.

- Models (2026-11-20, released in 0.5.0): domains → models → fields as data, settings enforced, references by name (`domain:model.field`), error codes with JSON Pointers and `$meta.errors` templates, `schema/models.schema.json`, all four languages, and a shared emitter layer (`dev/codegen/common.mjs`). Built task by task with a reviewer per task and a final whole-branch review; the final review cross-checked the digits rule against Postgres 16.4 on 4,000 random cases (0 differences) and ran Python 3.10.

- 0.4.0 (2026-11-20): the generated language files and the checks below, tagged `v0.4.0` once CI passed. A release is: bump `version` in `src/scalar.json` and the two asserts in `dev/test/build.test.mjs`, `npm run build`, date the changelog's "Unreleased" heading, move the README links to the new tag, then tag and push.

- Checks (2026-11-20): `check` and `$meta.checks`, `examples.check_invalid`, the `gln` type, the 64-bit range fix (from an outside review), `isbn` uppercasing its final `x` and a corrected example, a test that cleanup leaves validated values unchanged, and CI. A fresh reviewer ran 160,000 random inputs through the reference and all four languages: no disagreements. The spec and plan are in git history (`docs/superpowers/specs/2026-11-20-checks-design.md`, `docs/superpowers/plans/2026-11-20-checks.md`, removed once merged).

- README rewrite (2026-11-13): quick start per language at the top, and the `dev/langs/` runners described as tests of the generated files, not usage examples.

- Codegen (2026-11-13): generated Go, Python, Rust and TypeScript packages in `dist/`. The spec and plan are in git history (`docs/superpowers/specs/2026-11-12-codegen-design.md`, `docs/superpowers/plans/2026-11-12-codegen.md`, removed once merged).

- 0.3.0 (2026-11-12): portable patterns, `params` in the core, `schema` block, closed `primitive`, removed `category`/`templates`, runners in four languages. The details are in [CHANGELOG.md](../CHANGELOG.md), and the full plan is in git history (`docs/superpowers/plans/2026-11-12-scalars-0.3.0.md`, removed in the commit that added this file).
- 0.2.0 (2026-11-12): first pure-JSON release. The plan is in git history (`docs/superpowers/plans/2026-11-12-scalar-core-v2.md`).
