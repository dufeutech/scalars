# Changelog

## 0.6.1 — 2026-11-21

### Fixed
- **Go:** a lone surrogate encoded in a string (the 3 bytes `ED A0..BF 80..BF`) counts as one code point, as in the other languages, so on a short type such as `char` it fails as `malformed`, not `too_long`. Valid text is unchanged.
- **README:** no longer says models are unreleased (they shipped in 0.5.0).

## 0.6.0 — 2026-11-21

### Added
- **Failure reasons.** Every failed `validate` says why, with one reason from a fixed set: `wrong_kind`, `malformed`, `too_long`, `too_short`, `pattern`, `out_of_range`, `check`, `not_in_list`. A value that breaks several rules gets the first one checked, the same in all four languages. TypeScript and Python `ScalarError.reason` (with an emitted `Reason`), Go `ScalarError.Reason` (`type Reason string`, constants like `ReasonNotInList`), Rust `ScalarError.reason` (an enum with `as_str()`). The set, its order and meanings are the new `$meta.reasons` in `dist/scalars.json`. Messages are unchanged.
- **Closed code lists.** `country` and `country_alpha3` accept only currently assigned ISO 3166-1 codes (249 each, from Debian `iso-codes` v4.20.1), and `currency` only ISO 4217 List One codes (178, from SIX, published 2026-09-17). The list is the type's `schema.enum`, so JSON Schema and OpenAPI enforce it too, and the HTML `select` options read it. New `examples.list_invalid`.

### Changed
- **`validate` accepts less:** unassigned and withdrawn codes (`XX`, `QQQ`, `XK`, `HRK`) now fail `country`, `country_alpha3` and `currency`. Stored data holding them will start failing. Postgres is unchanged: its CHECK is still the pattern only, so no migration.
- **Models:** the `invalid` code is gone. A field whose value fails its type reports the reason as its code (`pattern`, `wrong_kind`, `not_in_list`, ...), and every problem on a type field carries `params.type`, including `too_long`, `not_allowed` and `too_many_digits`. A type's own length limit reports `too_long` with `params.max`, like a field's `length`.
- **Rust:** `Text::new` takes the list as a new last argument.
- **HTML:** `currency` options no longer point at `Intl.supportedValuesOf`; `country`, `country_alpha3` and `currency` take their values from `schema.enum` and only their labels from `Intl.DisplayNames`.

## 0.5.0 — 2026-11-21

### Added
- **Models**: check a whole payload against models written as data, in Python, TypeScript, Go and Rust. A models file has three levels (domain, model, field); fields can reference types, models and other fields (`billing:invoice.total`); `scalars.models(data)` loads it, `get("domain:model")` finds a model, `validate` / `is_valid` check a payload and return the cleaned one.
- Field settings are now enforced in models: `length`, `values`, `precision` and `scale` (what Postgres `numeric(p, s)` refuses), `nullable`, and `items` on `array`.
- Errors have a fixed `code`, an RFC 6901 `pointer` and `params`, so they drop into an RFC 9457 response and can be translated. `ModelError` (payload) and `ModelsError` (file) list every problem, sorted by location. The English templates are new in `$meta.errors` in `dist/scalars.json`. In Rust, `serde_json::Value::from(&problem)` gives the JSON object.
- `schema/models.schema.json`, a JSON Schema for models files.
- `$meta.params.values` has `maxItemBytes: 63`: each enum value is at most 63 bytes as UTF-8, the longest label Postgres `CREATE TYPE ... AS ENUM` takes. Models refuse a longer one with `bad_setting`.
- **Rust now needs `serde_json`** (as well as `regex`) for models data and payloads.

### Fixed
- **`unix_time`** is bounded at ±(2^53−1), like `double_int`. It had no bounds, so the four languages disagreed on values near 2^63 (Python and TypeScript accepted even 1e300).

### Changed
- **Rust**: the public `Check` enum variants are renamed `Mod97` → `Iso7064Mod9710` and `Mod11_2` → `Iso7064Mod112`, and `Meta` gained a required `params` field.

## 0.4.0 — 2026-11-20

### Fixed
- **`int64`** and **`uint64`** reject values outside the 64-bit range. They used to accept any run of digits, so `validate` passed values Postgres refused.
- **`isbn`**: the valid example `030640615X` had a wrong check digit; it is now `080442957X`, plus `0306406152`. `isbn` also uppercases a final `x`, so each book has one spelling.
- **`email`** pattern rewritten so it runs in linear time in backtracking engines (Python, JavaScript, browsers): the old one took seconds on long inputs. It accepts exactly the same values.

### Added
- **`check`**: a type can name a rule beyond its pattern, defined once in `$meta.checks` and run by `validate` in all four languages. Check digits for `gtin`, `gln`, `iban`, `lei`, `isbn` and `orcid`; ranges for `int64` and `uint64`. New `examples.check_invalid` lists values that match the pattern but fail the check.
- **`gln`** (GS1 Global Location Number), a domain type with a check digit.
- GitHub Actions run `npm test`, `npm run check:langs` and `go test -race` on pushes to `main` and on pull requests.
- The build rejects any pattern that is not provably linear.
- Generated code for Python, TypeScript, Go and Rust: `dist/python/scalars.py`, `dist/ts/scalars.ts`, `dist/go/scalars.go` (with `go.mod`) and `dist/rust/scalars.rs`. Each has `normalize`, `validate` and `is_valid` per type, `get` by name or alias, and a list of all types. `validate` runs in linear time. Python and TypeScript have no dependencies, Go needs `golang.org/x/text`, Rust needs `regex`.
- Text types reject text that is not well-formed Unicode (WHATWG `USVString`, RFC 7493): lone surrogates in Python and TypeScript, invalid UTF-8 in Go. Rust's `&str` cannot hold either. TypeScript uses `String.prototype.isWellFormed` (ES2024) where it exists, and an equivalent loop elsewhere.

## 0.3.0 — 2026-11-12

Every rule now means the same thing in Go, Python, Rust and TypeScript, checked by a runner in each language. **The shape of `dist/scalars.json` is now stable:** from here on, releases only add or fix types. No field will be renamed or moved.

### Fixed
- **Patterns match the same in every language.** Go and Rust could not compile `duration` and `hostname` (they used lookaround). Python and Rust read `\d` and `\s` as Unicode, so `+1٣٣٣` passed as a `phone` there but not in Go or JS. Patterns now use a subset every engine reads the same way (based on RFC 9485): no `\d` `\s` `\w`, no `.`, no lookaround or backreferences. The build rejects anything else.
- **`hostname`** keeps its 253-character limit as `maxLength`. **`char`** is `minLength: 1` + `maxLength: 1` (one code point) instead of a pattern.
- **Media types** no longer accept control characters in their parameters.
- **Lookup** says exactly what to do: the trim step, the lowercase step, then each run of spaces and `-` becomes one `_`.

### Changed
- **`schema`.** Each type's JSON Schema keys (`type`, `format`, `pattern`, `minLength`, `maxLength`, `minimum`, `maximum`, `contentEncoding`) are grouped under `schema`, ready to pass to any validator. `dist/openapi.json` is unchanged.
- **`params`.** Settings a field can take (`length`, `precision`, `scale`, `fractional_seconds`, `values`) belong to the type, not to Postgres. Each type lists its own in `params`, and each setting is defined once in `$meta.params`. `nullable` applies to every type. HTML no longer reads enum options from Postgres.
- **`primitive`** is a closed list of 16. It's all a language needs to pick a native type.
- **Postgres.** `postgres.attr` is a list of names defined once in `$meta.postgres_attrs`, and only `enum` and `duration` have one. `collation` applies to every text column. `check_extra` is now `check` in the source.
- The `lowercase` and `uppercase` steps spell out the full Unicode mapping (`İ` → `i̇`, `ß` → `SS`). In Go that means `golang.org/x/text/cases`, not `strings.ToLower`.

### Removed
- `category`. It was a second classification next to `level`, and its value `primitive` clashed with the `primitive` field.
- `$meta.templates`. The `{column}` rule is in the description of `postgres.check`.

### Added
- `dev/langs/`: a short, standalone runner per language (TypeScript, Python, Go, Rust) that reads `dist/scalars.json` and checks every example plus shared cases. Run them with `npm run check:langs`.

## 0.2.0 — 2026-11-12

First release. Everything is plain JSON.

### Added
- **Tiers.** Every type has a `level` (`core`, `advanced` or `domain`). The 33 core types cover everyday data, and every other type names a core `alternative`.
- **HTML layer.** Every type says which form control to use, with attributes (`type`, `autocomplete`, `inputmode`, `min`/`max`/`step`) and notes on known traps. One example: `int64` and `decimal` use text inputs because `type="number"` loses precision.
- **Postgres layer.** Every type gives its column type, attributes and notes. Types with a rule get a generated `CHECK` that enforces the same rule as the API and the form.
- **Beginner layer.** Every type has a plain-language `label`, `hint` and `error`. Core text avoids jargon, and each error shows a tested example. **Aliases** let people type what they already know (`url`, `password`, `money`, `colour`, …).
- **Examples.** Every type has `valid` examples. Types with a rule also have `invalid` ones, and `db_invalid` covers values only the database rejects. All of them are tested against JSON Schema, the browser's regex engine and Postgres.
- **Cleanup steps.** `normalize` (`trim`, `lowercase`, `uppercase`, `remove_spaces`, `remove_hyphens`), with each step's meaning defined in the data.
- **Release files.** `dist/scalars.json` has every type fully resolved, and `dist/openapi.json` has OpenAPI 3.1 component schemas. JSON Schemas for every file live in `schema/`.
- **Colors.** `color` (core) is lowercase `#rrggbb` or `#rrggbbaa`, matching `<input type="color">`. `css_color` (advanced) is any CSS Color 4 value.

### Changed (from the unreleased draft)
- `null` is now the `nullable` attribute rather than a type.
- The time types' `precision` setting is renamed to `fractional_seconds`.
- `int64` and `uint64` have JSON `type: "string"`, so their pattern now applies.
- `hex_color` became `color` (core) and `css_color` (advanced).
- `json_pointer` moved to advanced.
- Source files use `base` inheritance: about 20% smaller, with no information lost.

### Removed
- `is_number`. It was misleading for numbers sent as strings, and `primitive` already tells you the basic type.

### Fixed
- HTML patterns are now valid under the `v` flag that browsers use. Before this, 11 of them were silently ignored by browsers.
