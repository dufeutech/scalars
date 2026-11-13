# Scalar Core v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship release `0.2.0` of the scalar types as **pure JSON**: a small, beginner-friendly core, separate target files for HTML and Postgres, and one fully resolved file that a tool can load without running any code.

**Architecture:** The release is JSON files only. Source files (`scalar.json`, `targets/*.json`) are where people edit. Most types are built on one of 16 primitives using `base`, so each rule is written once. `dist/scalars.json` is the same data fully resolved: no `base`, and every HTML pattern and Postgres CHECK written out. It's the file tools and people consume. Node is used only as **dev tooling** in `dev/`, to check the data and generate `dist/`. It isn't part of the release, and whether to keep Node after `0.2.0` is an open decision (see the decision log).

**Tech Stack:**
- Release: JSON (JSON Schema 2020-12 for the file schemas).
- Dev only: Node ≥ 22 (ESM, `node:test`), `ajv@8.17.1`, `@electric-sql/pglite@0.2.17`, all inside `dev/`.

**Spec:** No separate spec. The design decisions come from the 2026-11-12 sessions and are recorded in [Design](#design) and the [Decision log](#decision-log) below. Executors treat those two sections as the spec.

## Global Constraints

- **The release is pure JSON.** Outside `dev/` and `docs/`, the repo holds only `.json` files plus `README.md`, `LICENSE` and `CHANGELOG.md`. No `package.json`, `node_modules` or `.mjs` at the root.
- **`dist/` is self-contained.** It has no `base` keys, no `{...}` other than the `{column}` placeholder, and no references that need code to resolve.
- Primitives (the only entries whose `base` is absent or abstract; a primitive's `primitive` is itself): `string`, `text`, `boolean`, `int32`, `int64`, `float64`, `decimal`, `object`, `array`, `any`, `date`, `time_local`, `date_time`, `date_time_local`, `duration`, `binary`.
- **DRY rule: write a value once, and never store a value that can be generated.** The single reuse mechanism is `base`. There are no regex fragments and no templating.
- Abstract bases (`"abstract": true`, names start with `_`) are building blocks that never appear in `dist/`. Exactly three exist: `_token` (base `string`; machine text: HTML `autocapitalize: none`, `spellcheck: false`), `_json` (shared textarea and JSON-input note for `object`/`array`/`any`), and `_bytes` (base `string`, `contentEncoding: base64`, Postgres `bytea`, HTML file input).
- Levels: `core`, `advanced`, `domain`. Every non-core type resolves to an `alternative` that names a `core` type. **Default:** the nearest `core` ancestor in the `base` chain. It's written in source only when it differs.
- Inherited from `base`: `type`, `format`, `pattern`, `minimum`, `maximum`, `contentEncoding`, `normalize`. Not inherited: `level`, `category`, `alternative` (it has its own default), `label`, `hint`, `error`, `aliases`, `examples`, `details`, `standard`, `anchor`, `abstract`.
- A child value of `null` deletes the inherited key.
- Target blocks are inherited from the nearest ancestor that has one. `attrs` merge shallowly. **`note` is inherited**, because it describes the storage the child shares. A child can override it, or set it to `null`.
- `standard` is an id into `$defs.standards` (`{ "<id>": { "name", "url" } }`) in `scalar.json`. An optional `anchor` (e.g. `"#section-5.6"`) is added to the URL. `dist/` writes out `standard` (name) and `docs_link` (url + anchor).
- Never stored in source, only generated into `dist/`: HTML `pattern`, `title`, `placeholder`; Postgres regex/range `check`; `primitive`; default `alternative`; `docs_link`.
- `scalar.json` is a single file holding every type. There is no file per type.
- `normalize` steps are exactly: `trim`, `lowercase`, `uppercase`, `remove_spaces`, `remove_hyphens`, applied in the order listed. Their meaning is defined in JSON (`schema/scalar.schema.json` → `$defs.normalize_step`), so any language can implement them.
- Lookup rule, defined in JSON (`dist/scalars.json` → `$meta.lookup`): case-insensitive, spaces and `-` become `_`, exact type name first, then alias.
- Aliases match `^[a-z][a-z0-9_]*$`, are unique across all aliases and type names, and never equal a type name.
- Beginner text limits: `label` ≤ 32 chars, `hint` ≤ 60, `error` ≤ 100 and ends with `.`.
- For `core` types, `label`/`hint`/`error` contain none of: `RFC`, `ISO`, `IANA`, `regex`, `pattern`, `E.164`, `octet`, `UTC`, `string`, `integer`, `boolean`, `null`, `JSON`.
- Files are UTF-8, LF line endings, 4-space indented JSON (source), non-ASCII written as is, not escaped. `dist/` is minified with keys sorted.
- `scalar.json` and `dist/scalars.json` carry `"$schema"` and `"version": "0.2.0"`.

## Review Focus

1. **Stale rule after an override:** `uuid_v7` overrides `uuid`'s pattern, so its HTML pattern and CHECK in `dist/` must use the v7 rule. Test in Task 2.
2. **`'` in a pattern:** `sf_token` contains a single quote, so the CHECK must double it, and the DDL must run. Test in Task 2.
3. **Characters the `v` flag requires escaped:** `media_type`, `doi`, `sf_token` and `json_pointer` must compile with `new RegExp(p, "v")`. Otherwise browsers silently skip validation. Test in Task 2.
4. **Values the regex accepts but the database rejects:** `date` `2026-02-30` passes the regex but Postgres rejects it. `invalid` examples only promise that JSON validation rejects them, and `db_invalid` examples must be rejected by Postgres. Test in Task 4.
5. **A `dist/` file that's out of date or not self-contained:** someone edits `scalar.json` and forgets to rebuild. The committed `dist/` must equal a fresh build and contain no `base`. Test in Task 7.

---

## Design

**The shape of one type in source `scalar.json`:**

```json
"phone": {
    "base": "string",
    "level": "core",
    "category": "identity",
    "label": "Phone number",
    "hint": "Start with + and your country code",
    "error": "That doesn't look like a phone number. Try +14155550123.",
    "aliases": ["tel", "telephone", "mobile", "phone_number"],
    "pattern": "^\\+[1-9]\\d{1,14}$",
    "normalize": ["trim", "remove_spaces", "remove_hyphens"],
    "examples": { "valid": ["+14155550123"], "invalid": ["555-1234", "+0123"] },
    "standard": "itu_e164",
    "details": "<the old expert description>"
}
```

`phone` has no `alternative` (it's core) and no target blocks: it inherits `text + collation` and the text input from `string`. Its HTML `pattern`, `title`, `placeholder` and Postgres `check` all appear only in `dist/`.

**The same type in `dist/scalars.json`** (shown expanded) has every inherited field filled in. It adds `primitive: "string"`, `type: "string"`, `html` (element, attrs including `pattern`, `title` = error, `placeholder` = first valid example) and `postgres` (type, attr, `check`). It has no `base`.

**Targets:** `targets/html.json` and `targets/postgres.json`, each `{ "<type>": { ... } }`, use the same block shape as today's `html` / `postgres` fields, minus generated keys. `$defs.attr`, `$defs.postgres_docs` and `$defs.templates` move to `targets/postgres.json` under `$defs`. Special CHECKs that can't be generated (`uint64`, `sha256`, `sf_decimal`) go in the target file as `check_extra`.

**`dist/` (generated by dev tooling, committed, this is the release):**
- `dist/scalars.json`: `{ "$schema", "version", "$meta": { "lookup", "normalize_steps", "templates" }, "types": { ... } }`, every type resolved.
- `dist/openapi.json`: `{ "openapi": "3.1.0", "components": { "schemas": { ... } } }`, one JSON Schema per type.

**Dropped:** `is_number`. It was misleading for `int64`, `decimal`, `uint64` and `decimal128`, and it can be derived from `primitive`.

## File Structure

| Path | Released? | Responsibility |
|---|---|---|
| `scalar.json` | yes | Core and beginner layer, the file people edit |
| `targets/html.json`, `targets/postgres.json` | yes | Target mappings |
| `schema/scalar.schema.json`, `schema/target.schema.json`, `schema/dist.schema.json` | yes | Schemas that validate the files themselves, so editors autocomplete them |
| `dist/scalars.json`, `dist/openapi.json` | yes | Resolved output that tools load |
| `CHANGELOG.md`, `README.md` | yes | Release notes, plus a beginner "pick a type" intro |
| `dev/package.json`, `dev/.gitignore` | no | Dev tooling setup (`node_modules/`) |
| `dev/lib/resolve.mjs` | no | Loads the files, resolves `base`, merges targets |
| `dev/lib/derive.mjs` | no | `htmlPattern`, `pgCheck`, `toJsonSchema` |
| `dev/lib/reference.mjs` | no | Reference `normalize` and `lookup` implementations, used only to test that the JSON rules mean what they say |
| `dev/build.mjs` | no | Writes `dist/` |
| `dev/migrate.mjs` | no | One-off converter from v1. It's deleted at the end of Task 3 and stays in git history. |
| `dev/test/fixtures/legacy-scalar.json` | no | Frozen copy of today's `scalar.json` |
| `dev/test/*.test.mjs` | no | `node --test` suites |

All dev commands run from `dev/`: `cd dev && npm install && npm test`.

---

### Task 1: Resolver, dev setup and file schemas

**Files:**
- Create: `dev/package.json`, `dev/.gitignore`, `dev/lib/resolve.mjs`, `dev/test/resolve.test.mjs`, `dev/test/fixtures/mini/{scalar.json,targets/html.json,targets/postgres.json}`, `dev/test/fixtures/legacy-scalar.json` (copy of the current `scalar.json`, never edited again)
- Create: `schema/scalar.schema.json`, `schema/target.schema.json`

**Interfaces:**
- Produces: `loadSources(dir: string) -> { core: object, targets: { html: object, postgres: object } }` (`dir` is the repo root, `..` from `dev/`)
- Produces: `resolve(sources) -> Record<string, ResolvedType>` where `ResolvedType = { name, primitive, ...coreFields, html: object, postgres: object }`, with no `base` key. It throws `Error` with a message that names the type for unknown bases, base cycles and unknown targets.

`dev/package.json`: `"private": true`, `"type": "module"`, `"engines": { "node": ">=22" }`, scripts `"test": "node --test"`, `"build": "node build.mjs"`, devDependencies pinned as in Tech Stack.

`schema/scalar.schema.json` defines `$defs.normalize_step`: an `enum` of the five steps, with `description` of each one's exact meaning (`trim` = remove leading and trailing Unicode whitespace; `remove_spaces` = remove every U+0020; `remove_hyphens` = remove every U+002D; `lowercase`/`uppercase` = Unicode default case mapping).

`$defs.standards` lives in `scalar.json`, and the schema checks that every `standard` id exists in it.

The mini fixture has:
- `string` (core), with Postgres `{ type: text, attr: collation, note: "N" }` and an HTML text input
- `_token` (abstract, base `string`, HTML attrs `autocapitalize: none, spellcheck: false`)
- `slug` (core, base `_token`, own pattern, `standard: "rfc3986"`, `anchor: "#section-3.3"`)
- `uuid` (core, base `_token`, `format: uuid`, pattern, Postgres type `uuid`)
- `uuid_v7` (advanced, base `uuid`, own pattern, `format` inherited)
- `jwt_like` (advanced, base `uuid`, `"format": null`, `alternative: "string"`)
- `quiet` (advanced, base `string`, Postgres `note: null`)

- [ ] **Step 1: Write failing tests** in `dev/test/resolve.test.mjs`:
  - `inherits type and format`: `uuid_v7.format === "uuid"`, `.type === "string"` and `.primitive === "string"`.
  - `child pattern wins`: `uuid_v7.pattern !== uuid.pattern`.
  - `null deletes`: `!("format" in jwt_like)`.
  - `no base in output`: no resolved type has a `base` key.
  - `identity fields not inherited`: `slug.label === undefined` when only `string` has a label.
  - `targets and notes inherit`: `slug.postgres.type === "text"` and `slug.postgres.note === "N"`, both from `string`. `quiet.postgres.note` is undefined.
  - `attrs merge through abstract base`: `slug.html.attrs` has `type: "text"` (from `string`) and `spellcheck: "false"` (from `_token`).
  - `abstract hidden`: `"_token" in resolve(mini) === false`.
  - `alternative default`: `uuid_v7.alternative === "uuid"` (nearest core ancestor), `jwt_like.alternative === "string"` (explicit), and core `slug` has no `alternative`.
  - `standards expand`: `slug.standard === "RFC 3986"` and `slug.docs_link === "<rfc3986 url>#section-3.3"`. An unknown id throws with the type's name in the message.
  - `unknown base throws`: the message includes `"slug"` and `"nope"`.
  - `cycle throws`: a↔b gives a message that includes `"cycle"`.
  - `file schemas validate`: ajv compiles `schema/*.schema.json` and the mini fixture passes.
  - `repo root is pure JSON`: listing the repo root and its subfolders, skipping `dev/`, `docs/`, `.git/` and `coding/`, finds only `.json`, `README.md`, `LICENSE` and `CHANGELOG.md`.
- [ ] **Step 2:** Run `cd dev && npm install && npm test`. Expected: FAIL (module not found).
- [ ] **Step 3:** Implement `loadSources`, `resolve` and both schemas. Resolution is a memoized depth-first walk with an in-progress set for cycle detection.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: add dev resolver and file schemas for scalar core v2`.

### Task 2: Generate HTML patterns, Postgres CHECKs and JSON Schema

**Files:**
- Create: `dev/lib/derive.mjs`, `dev/test/derive.test.mjs`

**Interfaces:**
- Consumes: `ResolvedType` from Task 1.
- Produces: `htmlPattern(jsonPattern: string) -> string` (anchors removed, safe for the `v` flag), `pgCheck(t: ResolvedType) -> string|null` (uses the `{column}` placeholder, or `check_extra` when present), `sqlString(s: string) -> string`, `toJsonSchema(t: ResolvedType) -> object` (only `type`, `format`, `pattern`, `minimum`, `maximum`, `contentEncoding`, plus `title` = label, `description` = hint, `examples` = valid).
- `resolve` (Task 1) now calls these. `html.attrs.pattern` is set only for input types `text`, `tel`, `search` and `password`. `postgres.check` is set when `pgCheck` returns non-null.

Port `vsafe` from `C:\Users\Toy\AppData\Local\Temp\claude\0bdb2dd46abc8202\6c6d5180-cc8c-4958-af80-97826c3c3017\scratchpad\vsafe.py`. Inside `[...]`, escape `()[]{}/|` and `&!#$%*+,.:;<=>?@^\`~`, and escape `-` unless it forms a range. Keep a leading `^`.

- [ ] **Step 1: Write failing tests:**
  - `v-flag safe`: for each of `^[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+(;.*)?$`, `^10\.\d{4,9}/[-._;()/:A-Za-z0-9]+$`, `^[A-Za-z*][A-Za-z0-9:/!#$%&'*+\-.^_\`|~]*$`, `^(/([^~/]|~[01])*)*$`: `new RegExp("^(?:" + htmlPattern(p) + ")$", "v")` does not throw, and it agrees with `new RegExp(p, "u")` on the inputs `["text/html", "a-b", "a|b", "10.1234/x(y)", "/a~1b", "", "#x"]`.
  - `quote escaped`: `sqlString("a'b") === "'a''b'"`.
  - `range check only when narrower`: `int8` gives `CHECK ({column} BETWEEN -128 AND 127)`, and `int32` gives `null`.
  - `override drives check`: in the mini fixture, `pgCheck(uuid_v7)` contains the v7 pattern.
  - `json schema strips extras`: `toJsonSchema(slug)` has no `level`, `html`, `postgres` or `normalize` key.
- [ ] **Step 2:** Run `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement `dev/lib/derive.mjs` and wire it into `resolve`.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: derive html patterns, postgres checks and json schema from core`.

### Task 3: Migrate v1 to v2 with no change in behavior

**Files:**
- Create (temporary): `dev/migrate.mjs`
- Rewrite: `scalar.json`. Create: `targets/html.json`, `targets/postgres.json`
- Create: `dev/test/legacy.test.mjs`

**Interfaces:**
- Consumes: `loadSources`, `resolve` (Tasks 1–2), `dev/test/fixtures/legacy-scalar.json`.

Migration rules:
- `description` → `details`. `example` → `examples.valid[0]`. `is_number` is dropped.
- `base`: `_json` for `object`/`array`/`any`. `_bytes` for any v1 type whose Postgres type is `bytea` (`binary` is a primitive, but its own blocks come from `_bytes` via base). `_token` for string types whose v1 HTML attrs include `spellcheck: "false"`, unless a closer non-abstract parent exists. Otherwise the type's `alternative`, if that type has the same JSON `type`, and failing that, the primitive for its JSON type (`integer`→`int32`, `number`→`float64`, `boolean`→`boolean`, `string`→`string`). Core non-primitives without a better parent get `string`. Primitives may use an abstract `base`; they're still primitives (`primitive` = themselves).
- Write a child key only when it differs from what it would inherit. Write `null` where v1 lacks a key the base has. Drop `alternative` when it equals the default.
- `docs_link` + `standard` → a `$defs.standards` id. Split the URL into base and `#anchor` when several types share the base. Ids are short snake_case (`rfc3339`, `openapi_formats`, `ieee754`).
- In the target files, drop generated keys (`attrs.pattern`, regex/range `check`), any key equal to the inherited value (including `note`), and any block that ends up empty. Move v1's `uint64`/`sha256`/`sf_decimal` checks to `check_extra`.
- Fill in the one missing `example` and the one missing `standard` found in v1.

- [ ] **Step 1: Write the failing test** `legacy.test.mjs` `v2 resolves to v1`: for all 88 v1 names, the resolved type equals the legacy entry on `type`, `format`, `pattern`, `minimum`, `maximum`, `contentEncoding`, `level`, `alternative`, `html` (element, attrs except `title`/`placeholder` which Task 5 adds, options, note), and `postgres` (type, attr, note, check). It also checks `resolved.details === legacy.description`, `resolved.docs_link === legacy.docs_link` and `resolved.standard === legacy.standard`.
  - `dry`: in the source files, no target block equals its inherited block, no `alternative` equals its default, and no `docs_link` key exists.
- [ ] **Step 2:** Run `npm test`. Expected: FAIL (`scalar.json` is still v1).
- [ ] **Step 3:** Run `node migrate.mjs` and add `$schema` and `version` at the top of `scalar.json`.
- [ ] **Step 4:** Run `npm test`. Expected: PASS. Record the source size (`scalar.json` + `targets/*.json`) against v1's 68 KB in the commit message. There's no fixed target: the `dry` test is the real gate.
- [ ] **Step 5:** Delete `dev/migrate.mjs`. Commit: `refactor: split scalar.json into core and targets with base inheritance`.

### Task 4: Examples and the cross-layer conformance suite

**Files:**
- Modify: `scalar.json` (`examples` for every type)
- Create: `dev/test/conformance.test.mjs`, `dev/test/helpers/pg.mjs`

**Interfaces:**
- Consumes: `resolve`, `toJsonSchema`, `pgCheck`.
- Produces: `pgLiteral(t: ResolvedType, value: string) -> string`, the SQL expression for inserting `value` (`decode(…,'hex')` for `sha256`, `decode(…,'base64')` for `binary`/`base64`, `base64url` translated first, `sf_binary` with its colons removed, otherwise `sqlString`).

Example rules: every type has `valid` (≥ 1). Types with a `pattern` or bounds also have `invalid` (≥ 2). `db_invalid` is optional.

- [ ] **Step 1: Write failing tests**, one `test()` per type:
  - Each `valid` value passes ajv (`strict: false`, `validateFormats: false`) on `toJsonSchema(t)`.
  - When `html.attrs.pattern` exists, each `valid` value matches it with the `v` flag.
  - Each `valid` value inserts into a PGlite table `("v" <postgres.type> <check>)`, using `pgLiteral`. `enum` uses a `CREATE TYPE` built from its valid examples.
  - Each `invalid` value fails ajv.
  - Each `db_invalid` value fails the Postgres insert (seed `date: ["2026-02-30"]`, `date_time: ["2026-13-01T00:00:00Z"]`).
  - The file test fails if a type with a `pattern` or bounds has fewer than 2 `invalid` examples.
- [ ] **Step 2:** Run `npm test`. Expected: FAIL on missing examples.
- [ ] **Step 3:** Write the examples for all 88 types.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit: `test: add valid/invalid examples and cross-layer conformance suite`.

### Task 5: Beginner layer (labels, hints, errors, aliases) and the lookup rule

**Files:**
- Modify: `scalar.json`
- Create: `dev/lib/reference.mjs` (`lookup` only for now), `dev/test/human.test.mjs`

**Interfaces:**
- Produces (dev only, to test the JSON rule): `lookup(types: Record<string, ResolvedType>, word: string) -> ResolvedType|null`, implementing the lookup rule from Global Constraints exactly.
- `resolve` now sets `html.attrs.title` = `error` and `html.attrs.placeholder` = `examples.valid[0]` on inputs that have a pattern.

Starting aliases (extend freely, the tests enforce uniqueness):
- `url`→`uri`
- `password`→`secret`
- `int`, `integer`→`int32`
- `number`, `float`, `double`→`float64`
- `bigint`, `long`→`int64`
- `money`→`decimal`
- `timestamp`, `datetime`→`date_time`
- `tel`, `telephone`, `mobile`, `phone_number`→`phone`
- `bool`→`boolean`
- `bytes`, `file`→`binary`
- `json`→`any`
- `list`→`array`
- `map`, `dict`→`object`
- `colour`→`color`
- `tz`→`timezone`
- `country_code`→`country`
- `currency_code`→`currency`
- `domain`→`hostname`

- [ ] **Step 1: Write failing tests:**
  - Every type has `label`, `hint` and `error`, within the Global Constraints limits.
  - Core types' text contains no banned jargon word (whole word, case-sensitive).
  - For types with a `pattern`, `error` includes `examples.valid[0]`.
  - Aliases match the rule, are unique and never equal a type name.
  - `lookup(types, "URL").name === "uri"`, `lookup(types, "Phone Number").name === "phone"`, `lookup(types, "time").name === "time"`, `lookup(types, "colour").name === "color"`, and `lookup(types, "nope") === null`.
  - Generated HTML inputs that have a pattern carry `title` and `placeholder`.
- [ ] **Step 2:** Run `npm test`. Expected: FAIL.
- [ ] **Step 3:** Write the text for all 88 types. Core text should be readable by a 10-year-old: short words, one idea per sentence, a concrete example. Implement `lookup` and the `title`/`placeholder` step.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: add beginner labels, hints, errors and aliases`.

### Task 6: Cleanup steps (`normalize`) as data

**Files:**
- Modify: `scalar.json`, `dev/lib/reference.mjs` (add `normalize`)
- Create: `dev/test/normalize.test.mjs`

**Interfaces:**
- Produces (dev only): `normalize(t: ResolvedType, value: string) -> string`, implementing `$defs.normalize_step` exactly. It throws on an unknown step.

Assignments:
- `slug`, `hostname`, `color`, `uuid`: `trim`, `lowercase`
- `email`: `trim`
- `country`, `currency`, `country_alpha3`, `subdivision`, `bic`: `trim`, `uppercase`
- `iban`: `trim`, `remove_spaces`, `uppercase`
- `phone`: `trim`, `remove_spaces`, `remove_hyphens`
- `isbn`, `gtin`: `remove_spaces`, `remove_hyphens`

- [ ] **Step 1: Write failing tests:**
  - `normalize(iban, " gb82 west 1234 5698 7654 32 ") === "GB82WEST12345698765432"`
  - `normalize(phone, "+1 415-555-0123") === "+14155550123"`
  - `normalize(slug, " Getting-Started ") === "getting-started"`
  - `normalize(uuid_v7, "ABC") === "abc"` (inherited)
  - `normalize(string, " x ") === " x "` (no steps)
  - Every step name in the file is in the `normalize_step` enum.
- [ ] **Step 2:** Run `npm test`. Expected: FAIL.
- [ ] **Step 3:** Add the assignments and the reference `normalize`.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: add normalize steps as data`.

### Task 7: Build `dist/` and release `0.2.0`

**Files:**
- Create: `dev/build.mjs`, `dev/test/build.test.mjs`, `schema/dist.schema.json`, `dist/scalars.json`, `dist/openapi.json`, `CHANGELOG.md`
- Modify: `README.md` (create if missing): what the files are, which one to load (`dist/scalars.json`), and a "pick a type" table for beginners

**Interfaces:**
- Consumes: `loadSources`, `resolve`, `toJsonSchema`.
- Produces: `build(root: string) -> { scalars: object, openapi: object }`. The script writes both files minified, with keys sorted. `scalars.$meta` contains `lookup` (the rule as text), `normalize_steps` (copied from the schema) and `templates`.

- [ ] **Step 1: Write failing tests:**
  - `build("..").scalars.types` has 88 keys and validates against `schema/dist.schema.json`.
  - The `dist/` text contains no `"base"` key and no `{` placeholder except `{column}`.
  - Every `openapi.components.schemas[*]` compiles in ajv.
  - The committed `dist/*.json` equal a fresh `build("..")`.
- [ ] **Step 2:** Run `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement the build, run `npm run build`, and write `CHANGELOG.md` (`## 0.2.0 — <date>`, with the v1→v2 changes: tiers, color split, html/postgres layers, beginner layer, `is_number` removed).
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit: `release: 0.2.0`, then `git tag v0.2.0` (ask before pushing).

---

## Ideas backlog

Not scheduled. Move an item into a task when it's picked up, and record the choice in the decision log.

| Idea | Notes |
|---|---|
| Language targets: TS, Go, Python, Rust | `coding/example.*` exist but are empty. Add `targets/<lang>.json` with the native type, parse and format functions, and the same conformance examples. |
| Composite types: `money`, `address`, `person_name`, `geo_point` | Objects, not scalars. They'd be a layer above the core. `money` = `decimal` + `currency`. |
| Translations of label/hint/error | `human.<locale>` blocks, or `i18n/<locale>.json`. Kids often aren't English readers. |
| `sensitive` flag | `secret` and `jwt` would be hidden in logs, UIs and API examples. Today that's implied only by `format: password`. |
| Postgres extras: `unique`, defaults, indexes | `slug` is usually UNIQUE, `uuid` can default to `gen_random_uuid()`, `jsonb` is usually indexed with GIN, `email` could use `citext`. |
| `examples.messy` | Raw input that `normalize` must turn into a valid value. This would put Task 6's tests in the data. |
| Real format checks beyond regex | Date validity, IBAN mod-97, ISBN/GTIN check digits, Luhn. Each needs a small function per language. |
| Range-aware HTML hints | `maxlength` from the `length` attr, `min`/`max` on dates. |
| Docs site generated from `dist/` | One page per type for beginners, with "pick a type" questions. |
| Short `#rgb` colors | Currently only `css_color` allows them. Revisit if the color picker's `alpha` attribute becomes widely supported. |
| Publish `dist/` to npm / PyPI / a CDN | After 0.2.0, as JSON-only packages. |

## Decision log

| Date | Decision | Why |
|---|---|---|
| 2026-11-12 | Demote types into tiers instead of deleting them (`level` + `alternative`) | Notes §2 and §4/§5.3 contradicted each other, and nothing is lost this way. |
| 2026-11-12 | No fixed core count (33, not 29) | A type is core when it's common and setting it up once saves work in ≥ 2 of HTML, JSON/OpenAPI and Postgres. |
| 2026-11-12 | `slug`, `phone` and `any` stay core. `json_pointer` moves to advanced. | `slug`/`phone` are everywhere. `any` is the escape hatch for `jsonb`. Pointers are a developer tool. |
| 2026-11-12 | `jwt` → `secret` alternative | A bearer credential: masked in the UI and kept out of logs. |
| 2026-11-12 | `color` (core, lowercase `#rrggbb[aa]`) plus `css_color` (advanced, any CSS Color 4 value) | Matches `<input type="color">`. CSS Color 5 expressions are computed in context, so they aren't data. |
| 2026-11-12 | `int64`/`decimal` use text inputs with `inputmode` in HTML | `type="number"` parses as a double and loses precision. |
| 2026-11-12 | HTML patterns are made safe for the `v` flag | Browsers silently drop a pattern that's invalid under the `v` flag. 11 v1 patterns had that bug. |
| 2026-11-12 | Core / targets split, `base` inheritance in source, fully resolved `dist/` | One source of truth per rule for editors, and zero code for consumers. |
| 2026-11-12 | Drop `is_number` | Misleading for numbers sent as strings. It's derivable from `primitive`. |
| 2026-11-12 | `invalid` examples promise only that JSON validation rejects them, and `db_invalid` covers values only the database rejects | Regex can't check calendar validity, while Postgres can. |
| 2026-11-12 | **Release 0.2.0 is pure JSON. Node is dev-only, isolated in `dev/`.** | The user wants a JSON-only first release. Rules like normalize and lookup are defined as data, so any language can implement them. |
| 2026-11-12 | DRY via one mechanism: `base`, plus three abstract bases (`_token`, `_json`, `_bytes`) | Measured v1 repeats: Postgres text+collation 43×, machine-text HTML 31×, derivable CHECKs 30×, links 29×, alternatives 55×. One idea for beginners: "like that type, except…". |
| 2026-11-12 | Target notes inherit. `alternative` defaults to the nearest core ancestor. Standards live in a registry. | Removes the remaining repeats without new syntax. |
| 2026-11-12 | No regex fragments, no nesting by level, no file per type. `scalar.json` stays one file. | Fragments make patterns unreadable without running code. Nesting makes a level change a block move. One sorted file is easiest to browse. |
| open | Keep Node dev tooling after 0.2.0, or replace it | Decide after the release. The JSON files don't depend on the choice. |
