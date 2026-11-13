# Changelog

## Unreleased

### Fixed
- **`email`** pattern rewritten so it runs in linear time in backtracking engines (Python, JavaScript, browsers): the old one took seconds on long inputs. It accepts exactly the same values.

### Added
- The build rejects any pattern that is not provably linear.

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
