# Changelog

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
