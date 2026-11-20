# Check digits for identifier types

Approved 2026-11-20.

## Why

Several identifier types are checked only by pattern, so values with the right shape but a wrong check digit pass:
`gtin` accepts `0614141000037`, and `iban`, `lei`, `isbn` and `orcid` have the same gap. The standards behind these
types define a check digit precisely so that typos are caught. Checking it is the step from "looks right" to "is a
real identifier" (the semantic-validity point in `docs/info.md`).

## Goals

- `validate` / `is_valid` reject a wrong check digit in all four languages and in the dev reference.
- The rule is data: a type names its algorithm, and each algorithm is described once in `dist/scalars.json`.
- Add `gln` (GS1 Global Location Number), the first new type to use it.

## Non-goals

- Postgres, HTML and JSON Schema enforcement. They stay pattern-only; a Postgres SQL function per algorithm can come later.
- Closed ISO code lists, new types beyond `gln`, error reason codes (separate follow-ups).

## Anti-goals

- Moving or renaming any existing field (the 0.3.0 stable-shape promise).
- Losing the O(n) worst case of `validate`.

## Approaches

- **Named algorithm per type (chosen).** `"check": "<name>"` on the type; each engine implements the named
  algorithms; `$meta.checks` describes them. Mirrors how `normalize` steps already work.
- A small expression language in JSON to describe any check: too much machinery for five algorithms.
- Metadata only, not enforced: does not fix the problem.

## Design

- **Source:** optional core key `check`, one of the names in `schema/scalar.schema.json` `$defs.check`
  (`oneOf` of `const` + `description`). Inherited from `base` like other core keys (`null` deletes). The build copies
  the names and descriptions into `$meta.checks`, as it does `normalize_steps`; `schema/dist.schema.json` lists it.
- **Algorithms:**
  - `gs1_mod10`: GS1 check digit (weights 3,1 from the right, excluding the check digit; sum mod 10 = 0 including it). `gtin`, `gln`.
  - `iso7064_mod97_10`: letters A-Z map to 10-35, the number mod 97 equals 1. `lei`.
  - `iban`: move the first four characters to the end, then `iso7064_mod97_10`. `iban`.
  - `isbn`: 10 characters use ISBN-10 mod 11 (`X`/`x` = 10, weights 10..1); 13 digits use `gs1_mod10`. `isbn`.
  - `iso7064_mod11_2`: ORCID / ISNI check character over the digits, hyphens ignored; `X` = 10. `orcid`.
- **When it runs:** after the pattern matches, on the normalized value. Input is then short ASCII of bounded length,
  so the check is O(n) with a tiny constant; mod 97 is computed digit by digit, never as a big integer.
- **Errors:** one error text per type, as today; the five texts are reworded so they also cover a wrong check digit.
- **Examples:** new optional list `examples.check_invalid`: values that pass the pattern (and JSON Schema) but fail
  the checksum. Required (at least 2) on every type with a `check`; not allowed on types without one. Every
  runner asserts they fail `validate`; the JSON Schema / browser regex / Postgres tests assert they pass the pattern.
- **Codegen:** `model.mjs` carries `check`; each emitter passes it to the engine record; each `engine.*` implements
  the five algorithms behind one dispatch. Go/Rust `Meta` and Python/TS records expose the name.
- **New type `gln`:** base `_token`, level `domain`, pattern `^[0-9]{13}$`, normalize `remove_spaces`,
  `remove_hyphens`, checksum `gs1_mod10`, aliases `location_number`, `global_location_number`, standard
  "GS1 GLN", alternative `string`.
- **Fixes:** the `isbn` example `030640615X` has a wrong check digit; replace it with a real ISBN-10. Update the
  README (type count, a line under "Good to know"), the changelog ("Unreleased") and the handoff.

## Left to the builder

Exact error wording, example values (each must be verified with the reference), docs key for `gln`, and how each
engine structures the dispatch.

## Amendment (2026-11-20, approved)

- The key is `check`, not `checksum`, so one mechanism covers any named rule that runs after the pattern:
  `$meta.checks`, `examples.check_invalid`.
- Two more checks: `int64_range` (-9223372036854775808 to 9223372036854775807) and `uint64_range` (up to
  18446744073709551615), compared digit by digit with leading zeros ignored. Today `int64` and `uint64` accept any
  digit string, so `validate` takes values Postgres rejects (found by an outside review, confirmed).
- `check_invalid` values are not inserted into Postgres; range values Postgres rejects also stay in `db_invalid`.
- Also in scope: a test that `normalize` leaves every validated example unchanged, and a GitHub Actions workflow
  running `npm test`, `npm run check:langs` and `go test -race`.
- `docs/HANDOFF.md` is the owner's; this work does not edit it.
