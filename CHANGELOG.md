# Changelog

## Unreleased

### Removed
- `link` is no longer an alias of `uri`, so the word means one thing: a models link. `scalars.get("link")` finds nothing; write `url` or `uri`.

## 0.8.1 — 2026-11-22

### Fixed
- **Postgres answers the same whatever the session's settings.** Patterns are written `E'...'`, so they read the same with `standard_conforming_strings` off (before, `\.` meant any character). Each `scalars.<type>_reason` pins `search_path` to `pg_catalog`, and each domain's CHECK is created under it, so a schema placed before `pg_catalog` can't swap `char_length`, `~` or `family` under them. The cost is about 3 µs per checked value.
- `scalars.sql` suggests `psql -v ON_ERROR_STOP=1 -1 -f scalars.sql`, so a failed load changes nothing.
- Number text a double can't hold, `1e400` or `1e-400`, is `out_of_range` in Postgres, as a `float8` column refuses it; now pinned by a test and in the README. The README also says `scalars.<type>_reason(NULL)` is NULL.

## 0.8.0 — 2026-11-21

### Added
- **Postgres is a fifth language:** [`dist/postgres/scalars.sql`](dist/postgres/scalars.sql) creates a `scalars` schema with, for every type but `enum`, `scalars.<type>_reason(v)` (NULL when valid, else the same reason the other languages give), `scalars.is_<type>(v)` and a `scalars.<type>` domain to use as the column type. Text columns get the whole rule, check digits and closed lists included (an `iban` with a wrong check digit or the country `XX` is refused). Native columns (uuid, inet, date, the integers, ...) keep Postgres's own parser, and the domain adds only what it misses: a narrower range, the IP family, no `NaN` or `infinity`, the version for `uuid_v7`, 32 bytes for `sha256`. `scalars.char` is a `varchar`, since `char(1)` stores `''` as a space. Plain SQL and PL/pgSQL on Postgres 16+, no extensions. Run the file again to upgrade: it replaces the functions and each domain's CHECK (without rechecking stored rows) and keeps the domains.
- Values go in clean: normalize in the app first. Number functions take JSON number text, and text a double can't hold (`1e400`) is `out_of_range`.
- A fifth runner checks every example and shared case against Postgres (PGlite) in `npm run check:langs`.

### Changed (breaking)
- **`postgres.check` is gone** (the `CHECK ({column} ...)` snippets). Each type's `postgres` block has `domain` (`scalars.<type>`, absent for `enum`) and, when the domain needs one, `domain_check` (its CHECK, over `VALUE`). In `src/targets/postgres.yaml`, `check` becomes `domain_check`.

## 0.7.0 — 2026-11-21

### Removed
14 types that checked little or never appear as field data, leaving one type per concept (75 remain). Their aliases go with them.
- **HTTP wire formats:** `sf_integer`, `sf_decimal`, `sf_string`, `sf_token`, `sf_binary`, `sf_boolean` (use `int64`, `decimal`, `string` for both strings and tokens, `base64`, `boolean`), `http_date` (use `date_time`), `media_range` (use `media_type`).
- **International variants:** `idn_email` (use `email`, which already accepts addresses like `用户@例子.广告`), `idn_hostname` (use `hostname`, with the name in punycode), `iri` and `iri_reference` (use `uri` and `uri_reference`, percent-encoded).
- **Niche:** `relative_json_pointer` (use `json_pointer`), `double_int` (use `int64`).

### Changed
- **`email` is marked international everywhere:** its JSON Schema `format` is `idn-email` (a superset of `email`), and its HTML input drops `type="email"`, which browsers refuse for non-ASCII local parts. `validate` is unchanged: its pattern already accepted these addresses.
- **The build refuses `precision` or `scale` on a number type.** It used to accept them and the models engines dropped them, which is why `precision` on `sf_decimal` was an unknown setting. No remaining number type lists them, so models behave the same.
- **Source files are YAML** (`src/scalar.yaml`, `src/targets/*.yaml`). The dist files are unchanged by it.

## 0.6.2 — 2026-11-21

### Changed
- **`language` accepts only current BCP 47 language codes:** 8,043 subtags from the IANA Language Subtag Registry (File-Date 2026-11-18), not deprecated and not private-use. That's every ISO 639-1 code plus the 639-3 and 639-5 codes for languages without one, and `mul`, `und`, `zxx`. `xx`, 3-letter forms of 2-letter languages (`fra`, use `fr`) and deprecated codes (`iw`, now `he`) fail with `not_in_list`. JSON Schema, OpenAPI and the HTML `select` use the same list. Postgres is unchanged (pattern CHECK only).
- Each dist file grows by about 50 KB for the list.

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
