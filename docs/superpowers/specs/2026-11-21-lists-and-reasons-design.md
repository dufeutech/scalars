# Closed code lists and failure reasons (0.6.0)

## Intent

Two gaps in what `validate` tells you:

1. `country`, `country_alpha3` and `currency` accept any 2 or 3 capital letters. `XX` and `QQQ` pass today. They should accept only codes ISO currently assigns.
2. A failed `validate` says *that* a value failed, never *why*. Callers that build error responses (and models, which report every bad value as `invalid`) need the reason.

Both ship together as 0.6.0.

## Goals

- `country` (ISO 3166-1 alpha-2), `country_alpha3` (alpha-3) and `currency` (ISO 4217 alpha-3) check membership in a closed list. The check is O(1) and works the same in the four languages, the reference and JSON Schema. Postgres keeps the pattern only (see Design). HTML forms get the list as their `select` options.
- Every `validate` failure carries a reason drawn from one fixed set, the same in all four languages. Models put it in `params.reason`.

## Non-goals

- `language`, `timezone` and `subdivision` lists. `language` may come later; the other two change too often or are too big.
- Postgres functions for check digits (deferred: users would need to install SQL first).
- New identifier types.
- Translated country or currency names.

## Anti-goals

- **Bending the design around backward compatibility.** The project has no users to protect, so it may rename, move or remove anything when that gives the cleaner design; the changelog and version bump are kept for a professional record, not as a promise.
- **Each list lives once in `src/`.** No copy for HTML, no copy per language.
- **`is_valid` costs nothing extra.** It must not build an error or a reason string.
- **No second pass** to explain a failure: the reason comes from the same single pass that validates.

## Constraints

- `validate` stays O(n) worst case. Membership is a hash-set lookup after the pattern has matched, so the value is already 2 or 3 bytes long.
- Lists hold **currently assigned codes only**. Withdrawn codes (`HRK`) and codes ISO never assigned (`XK`) fail. The 0.6.0 changelog must say that stored data holding them will start failing.
- Python and TypeScript need no dependencies. Go needs only `golang.org/x/text`. Rust needs only `regex` and `serde_json`.

## Approaches

**Lists.** We picked **A**.
- **A. A core `enum` key on the type.** `src/scalar.json` gets `enum: [...]` next to `pattern`. Like the other core keys, it is a JSON Schema keyword and lands in dist as `schema.enum`. Every target reads that one list.
- B. A named `check` with the list in `$meta.checks`. Rejected: JSON Schema and HTML don't run checks, so they would lose the list, and the reason would come out as `check`, not `not_in_list`.
- (Ruled out: a Postgres lookup table, which needs an install step.)

**Reasons.** We picked **A**.
- **A. The single pass returns the reason.** The internal "not valid" marker becomes the reason. `ScalarError` carries it, and `is_valid` compares against "no reason" exactly as it compares against the marker today.
- B. A separate `explain(v)` that runs the rules again. Rejected: every rule would exist twice, in four languages.

## Design

### Lists

- **Source.** In `src/scalar.json`, `country`, `country_alpha3` and `currency` each get an `enum` array, sorted, with no duplicates. `enum` joins `INHERITED` in `dev/lib/resolve.mjs` like the other core keys. `country_alpha3` inherits from `country`, so it must set its own `enum`. The build fails if an inherited `enum` is left in place on a type whose pattern its codes don't match.
- **Build checks.** Every `enum` value must match the type's pattern and be unchanged by its `normalize`. The array must be sorted and free of duplicates. Only text types may have an `enum`.
- **Where the codes come from.** ISO 3166-1 (249 codes, alpha-2 and alpha-3) and ISO 4217 List One (active codes, including the `X` codes such as `XAU`, `XDR`, `XTS` and `XXX`, since List One assigns them). Each list records its source and the date it was copied, in a `$comment` or the type's `details`. The builder chooses an established machine-readable copy (Debian `iso-codes` for 3166-1, SIX's `list-one.xml` for 4217) and records which one.
- **dist.** The type gets `schema.enum`. JSON Schema and OpenAPI enforce it as they are. `schema/` is updated so `enum` is allowed in a type's `schema` block. `examples.invalid` are still raw-pattern rejects.
- **Examples.** A new `examples.list_invalid`, at least 2 values, on every type with an `enum` and no other type: values that pass the pattern and normalize but are not on the list (`XX`, `QQQ`). They work like `check_invalid`: they pass the HTML pattern and fail JSON Schema and the four languages. Postgres is not tested with them (see below).
- **Engines.** Each generated file emits the list once per type as a set: a `frozenset` in Python, a `Set` in TS, a `map[string]struct{}` in Go, and in Rust a sorted `&'static [&str]` searched with `binary_search` (O(log 249), constant in practice; avoids init code). Membership is tested last, after pattern, bounds and `check`.
- **Postgres: no list.** A type with an `enum` keeps its pattern CHECK only, as with check digits. A database constraint outlives the app version that wrote it: putting the list in a CHECK would make every ISO change a migration on every user's table (drop and re-add a 249-value CHECK, which fails if any stored row holds a withdrawn code), and would refuse new codes until then. The PGlite tests do not insert `list_invalid` values, as with `check_invalid`.
- **HTML.** `country` and `currency` already say `element: select`. Their `options` stop pointing at `Intl` for the *values*. `options.source` stays, and a note says the options are `schema.enum`. `options.js` names only how to get labels: `new Intl.DisplayNames([locale], { type: 'region' })` for country, `{ type: 'currency' }` for currency. `country_alpha3` gets the same treatment. No list is copied into the `html` block.
- **Reference.** `dev/lib/reference.mjs` checks membership in the same order as the engines.

### Reasons

- **The set.** These are defined once in `src/scalar.json` as `$defs.reasons` (name → one-line meaning) and emitted to `$meta.reasons`:

  | reason | meaning |
  |---|---|
  | `wrong_kind` | not the value's primitive kind (TS, Python and models only; Go and Rust are typed by their signatures) |
  | `malformed` | text that isn't well-formed Unicode |
  | `too_long` | more code points than the type's `maxLength` |
  | `too_short` | fewer than its `minLength` |
  | `pattern` | doesn't match the pattern |
  | `out_of_range` | below `minimum`, above `maximum`, or a non-finite float |
  | `check` | failed the type's `check` (check digit, 64-bit range) |
  | `not_in_list` | not on the type's `enum` |

- **Order.** When a value breaks several rules, the reason is the first rule the single pass trips. The order is the one the engines already run: kind → (early length gate: `too_long`) → `malformed` → (case-mapping gate: `too_long`) → `too_long` / `too_short` → `pattern` → `out_of_range` → `check` → `not_in_list`. `dev/lib/reference.mjs` defines this order, and shared cases pin it, including at least one case per gate where two reasons compete.
- **API, per language.** The reason is exposed as a string constant from the set; no exception message changes (it stays the type's `error`).
  - TS: `ScalarError.reason: Reason`, a string-literal union type.
  - Python: `ScalarError.reason: str`, plus the set emitted as constants.
  - Go: `ScalarError.Reason Reason` (`type Reason string`, one exported constant per reason, e.g. `ReasonNotInList`).
  - Rust: `ScalarError.reason: Reason`, a plain enum (exhaustive matching is a feature here) with `as_str()`, and `Display` unchanged.
  - The reason names are emitted from `$meta.reasons`; a codegen test fails if an engine spells them by hand, as with the models constants.
- **Inside the engines.** The internal "not valid" marker becomes the reason. Concretely: in TS and Python `run` returns a reason sentinel (a module-level constant per reason), in Go the check returns `(value, Reason)` with `""` meaning ok, in Rust `Result<_, Reason>`. `is_valid` keeps building no error.
- **Models: the reason is the code.** The catch-all `invalid` code goes away. A field whose value fails its type reports the reason itself as `code` (`pattern`, `not_in_list`, `wrong_kind`, ...), with `params.type` as today. One vocabulary then covers both layers, and consumers switch on one field. Messages follow one rule: a code with a template in `$meta.errors` uses it, anything else uses the type's `error`. So `too_long` reads "At most {max} characters." whether the limit came from the type's `maxLength` (`params.max` is then the type's limit) or the field's `length` setting, and `pattern` reads the type's `error`. The models schema, the `$meta.errors` docs, the shared cases and the README are updated to match.
- **Tests.** `dev/langs/cases.json` cases gain an expected `reason`, and every runner checks it. Every reason appears in at least one shared case per language that can produce it. The fuzzer compares reasons too.

### Release

0.6.0: bump the version and its asserts, date the changelog, move the README links, and add a README line on `.reason` to the method table. The changelog says the lists narrow what `validate` accepts and that models' `invalid` code became the reason codes. `docs/HANDOFF.md` drops "the shape of `dist/scalars.json` is stable" and says instead that there is no compatibility promise before 1.0.

**Keeping the lists current** (goes into `docs/HANDOFF.md` as a rule): an older release rejects a code ISO added after it. A list update is a patch release (0.6.x), shipped soon after ISO announces the change; ISO 4217 changes about once a year, ISO 3166-1 rarely.

## Left to the builder

- Which machine-readable copy of each ISO list to use, as long as it is recorded.
- Names of internal sentinels and helpers.
- Exact README wording.
