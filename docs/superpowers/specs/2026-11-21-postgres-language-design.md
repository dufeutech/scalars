# Postgres as a fifth language: design

Date: 2026-11-21. Status: draft, awaiting the owner's approval.

## Why

Today Postgres is a *target*: each type's dist entry says which column type to use and, for text types, hands over a
`CHECK ({column} ~ '...')` snippet to paste into every table. That has three problems:

- **The rule is copied, not shared.** Every column repeats the pattern; changing a rule means migrating every table.
- **Check digits are skipped.** A `gtin`, `iban`, `isbn`, `lei`, `gln` or `orcid` with a wrong check digit gets in.
- **The closed lists are skipped.** `country`, `currency` and `language` check only the shape, so `XX` gets in.

The owner decided Postgres should be a **language**, like Go, Python, Rust and TypeScript: a generated file of reusable
helpers, held to the same answers by the shared cases.

## Goals

- One generated file, `dist/postgres/scalars.sql`, that creates a `scalars` schema: a function per type, a domain per
  type, and shared helpers for the checks and the lists. Every rule is written once and used by every table.
- `ALTER TABLE ... ADD COLUMN account scalars.iban` is all a user writes. Check digits and lists are enforced.
- Runs anywhere Postgres runs: plain SQL and PL/pgSQL only, Postgres 16 and up (tested on PGlite's 16.4; nothing used
  is newer, but older versions are not tested, so none is promised), no extensions, so it
  works on RDS, Cloud SQL, Supabase and PGlite.
- Re-running the file upgrades it: functions are `CREATE OR REPLACE`, so a list update needs no migration.
- A fifth runner puts `cases.json` through PGlite, failure reasons included, and agrees with the reference.
- Same worst case as the other four: linear in the input, no `numeric` big integers in the checks.

## Non-goals

- **Normalize in Postgres.** The app normalizes and the database accepts only canonical values. Reason: `lower()` and
  `upper()` depend on the database's locale (under the common `C` locale they map ASCII only), so `İ` and `ß` would
  disagree with the other four languages depending on how the server was set up.
- **Models in Postgres** (`CREATE TABLE` from a models file, jsonb payload validation). Later, if wanted.
- **`params` on a domain.** A domain can't take a length, precision or scale. Users who need `string` with a length or
  `decimal(12,2)` spell the native column (`varchar(200)`, `numeric(12,2)`) or add a CHECK. Models would cover it later.
- **The `enum` type.** It needs a named Postgres enum per field; there is no `scalars.enum` domain or function.
- **Exact text for native types.** Decided with the owner (option A): types stored natively (uuid, inet, date,
  timestamptz, the integers, ...) keep Postgres's own parser, which accepts spellings the other languages refuse (uuid
  in braces, `Jan 8 1999`). Native operators, indexes and storage win.

## Anti-goals

- A file that needs superuser, an extension, or C.
- A per-call cost that grows with a list's size, or a check that is quadratic in the input.
- A second source of truth: no rule written by hand in SQL that the dist data already states.

## Approaches considered

1. **Native column, the domain adds only what the native type misses** (picked by the owner). Text types get the full
   rule; native types get only the gaps (ranges, inet family, byte length, no NaN). `scalars.is_<type>(text)` still
   checks the exact text for every type, for apps that check before casting, and it is what the runner tests.
2. **Everything stored as text with the exact rule.** Every column as strict as the other languages, but no date math,
   no inet operators, no 16-byte uuid. Rejected: it throws away what Postgres is good at.
3. **A C or pgrx extension.** Fast and exact, but managed hosts allow only approved extensions. Rejected by the
   handoff's constraint.

## The design

### What the file creates

```sql
CREATE SCHEMA IF NOT EXISTS scalars;
-- per type (every type except enum):
scalars.<type>_reason(text) RETURNS text   -- NULL when valid, else a reason name from $meta.reasons
scalars.is_<type>(text)     RETURNS boolean -- scalars.<type>_reason(v) IS NULL
scalars.<type>              DOMAIN          -- the column type
-- shared, hand-written (dev/codegen/engine.sql):
scalars.gs1_mod10(text), scalars.iso7064_mod97_10(text), scalars.iban(text) ... -- one boolean function per $meta.checks entry
```

All functions are `IMMUTABLE STRICT PARALLEL SAFE` with fully qualified names inside (no reliance on `search_path`).
Domain names like `scalars.boolean`, `scalars.char`, `scalars.text` and `scalars.time` are legal, checked in PGlite.
Hand-written check helpers are named `scalars.check_<name>(text)` (e.g. `scalars.check_iban`), so none reads like the
`scalars.iban` domain.

### `<type>_reason(text)`: the input

The input is the value as text, already normalized by the app:

- **Text kinds** (`primitive` string-like, including native types like uuid whose rule is a pattern): the gates in the
  reference's order, minus what normalize and well-formedness do: `too_long` (`char_length > maxLength`), `too_short`,
  `pattern` (`~` with the dist pattern), `check`, `not_in_list`. Malformed text can't exist in a Postgres `text`.
- **Integer kinds**: the text must be a JSON number (`-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?`), else
  `wrong_kind`; it must be integral (`numeric` value equal to its `trunc`), else `wrong_kind`; then `out_of_range` from
  the dist bounds. Comparing one `numeric` value against two bounds is fine: it's not a growing total in a loop. The
  builder caps the input length before the cast so `1e999999` can't make a huge numeric (any JSON number text longer
  than, say, 400 characters, or whose exponent is out of range, is `out_of_range` when it parses, which matches the
  reference since such values are beyond every bound).
- **Number kinds** (`float32`, `float64`): JSON number text, else `wrong_kind`, except `NaN`, `Infinity` and
  `-Infinity`, which are `out_of_range` as in the reference (the other languages see these as floats).
- **boolean**: `true` or `false`, else `wrong_kind`.
- **object, array, any**: these take `jsonb`, not text: `scalars.object_reason(jsonb)` is `wrong_kind` unless
  `jsonb_typeof` is `object` (`array` likewise); `any` is always valid. Their domains are over `jsonb`.
- **Types with no rule** (`text`, `commonmark`, `ipv6`, `cidr`, ...): the function exists and returns NULL, so the API
  is the same for every type.

The SQL spells each reason as a string literal emitted from `$meta.reasons`. `engine.sql` never spells one (it holds
boolean helpers only), and the codegen test that greps the engines for spelled reasons covers it.

### The domains

One per type, `CREATE DOMAIN scalars.<type> AS <postgres.type> CHECK (...)`:

- **Text columns** (`text`, `varchar`): `CHECK (scalars.is_<type>(VALUE))`. Types with no rule get no CHECK.
- **Native columns**: only what the native type misses, derived from dist data where it can be:
  - integer bounds narrower than the native type (`int8`, `uint8`, `uint16`, `uint32`, `port`, `unix_time`): `VALUE
    BETWEEN lo AND hi`, from `schema.minimum`/`maximum` (today's `pgCheck` logic, moved).
  - `uint64` over `numeric`: `VALUE >= 0 AND VALUE <= 18446744073709551615 AND VALUE = trunc(VALUE)`. `int64` is
    `bigint`, already exact.
  - `float32`, `float64`: `VALUE NOT IN ('NaN', 'Infinity', '-Infinity')`.
  - `ipv4` / `ipv6` over `inet`: `family(VALUE) = 4 AND masklen(VALUE) = 32` (6 and 128). `ipv4_cidr` / `ipv6_cidr`
    over `cidr`: `family(VALUE) = 4` (6). The plain `cidr` type takes either.
  - `sha256` over `bytea`: `octet_length(VALUE) = 32`.
  - `char` over `char(1)`.
  - Everything else (date, timestamptz, timestamp, time, timetz, interval, uuid, uuid_v7, macaddr, bytea, boolean,
    jsonb, `decimal`): no CHECK. `uuid_v7` could check the version nibble with `uuid_extract_version` (Postgres 17);
    leave it out to keep 16 support. The rules that can't be derived from dist (inet family, NaN, sha256 length) live
    in `src/targets/postgres.yaml` as a per-type `domain_check` in SQL with `VALUE`, replacing today's hand-written
    `check` (on `uint64` and `sha256`); `pgCheck` in `dev/lib/derive.mjs` becomes the domain-check builder. Each
    type's full domain CHECK is carried in dist as `postgres.domain_check` (amended while planning: the emitters read
    dist only).
- **Idempotent:** Postgres has no `CREATE OR REPLACE DOMAIN`, so each domain is created inside a `DO` block that skips
  it when `scalars.<type>` already exists. Re-running the file updates every function (so lists and checks update)
  and leaves domains alone. Postgres doesn't recheck existing rows when a function changes; fine while lists only grow,
  and the release note says so when a code is withdrawn.

### Checks and lists

- **Checks**: each `$meta.checks` entry is one hand-written PL/pgSQL function in `dev/codegen/engine.sql`, ported from
  `reference.mjs`: single pass, reduce mod as you go, `integer` arithmetic only. Read characters through
  `convert_to(s, 'UTF8')` and `get_byte` (O(1) each); `substr` on UTF-8 text walks from the start, which would make a
  loop quadratic. The 64-bit range checks compare digit text: strip leading zeros, compare lengths, then compare with
  `COLLATE "C"`. The emitter checks that `engine.sql` defines every check in `$meta.checks` (as the Go and Rust
  emitters do) and fails the build otherwise.
- **Closed lists**: a jsonb object literal of the codes, tested with `?`, inside the PL/pgSQL `<type>_reason`. jsonb
  objects keep their keys sorted and `?` binary-searches them, so a lookup is O(log n), and PL/pgSQL caches the parsed
  literal per session. Measured in PGlite on `language` (8,043 codes), 2,000 single-row inserts into a domain column:
  jsonb `?` in PL/pgSQL added about 0.07 ms per insert over a bare query; `= ANY(array)` in PL/pgSQL added about
  0.4 ms (Postgres hashes the array per statement); a sorted `text[]` with binary search would be worse, since indexing
  a variable-width array walks it. This replaces the handoff's "sorted array + binary search" idea, for that reason.
- **Patterns**: Postgres's `~` with the dist pattern, unchanged (the conformance test already proves Postgres reads
  every pattern the same). Every hostile case in `cases.json` (100,000 to 200,000 characters) matched in under 15 ms
  in PGlite. Postgres compiles each regex once per backend (a small cache), so per-call cost doesn't grow with the
  number of types used.

### The runner

`dev/langs/check.pg.mjs`, added to `runners.mjs` (so `npm run check:langs` and CI run it; not added to `fuzz.mjs`,
which tests models). It loads `dist/postgres/scalars.sql` into a fresh PGlite and runs:

- `validate`, `hostile` and `match` cases: the input is first normalized by `reference.mjs` (the app's job), then
  passed as text (numbers as `JSON.stringify`, `special` values by name, jsonb types as jsonb). It expects the case's
  `ok` and `reason`. If `reference.validate` on the normalized input ever disagrees with the case's answer, the runner
  fails with that case named (a spec bug, not a Postgres one; none is known). Most hostile inputs stay hostile after
  normalize; the few that collapse (runs of spaces) are still run. Skipped, with a count printed: `malformed` cases (no lone surrogates in Postgres text) and
  `dynamic` cases whose input's JSON kind can't reach a typed SQL function (e.g. `null` or a number into a text type);
  the builder confirms each skipped category against the case list.
- every type's `valid`, `invalid`, `check_invalid` and `list_invalid` examples through `<type>_reason`, normalized
  first, against `reference.validate`.
- `normalize`, `lookup` and `models` cases: not applicable, skipped.

The conformance test (`conformance.test.mjs`) switches from pasting `postgres.check` to declaring the column as
`scalars.<type>`, so every valid example is inserted through the domain and every `db_invalid` is refused by it; it now
also proves the domains refuse `check_invalid` and `list_invalid` values for text types.

### Dist and docs

- `dist/postgres/scalars.sql` is built by `dev/codegen/postgres.mjs` (an emitter in `generate.mjs`) plus
  `dev/codegen/engine.sql`. Header: version, Postgres 16+, how to install (`psql -f scalars.sql`), re-run to upgrade.
- Each dist type's `postgres` block drops `check` (the `{column}` snippets) and gains `domain: "scalars.<type>"`
  (absent for `enum`). `postgres.type` stays: it's the native base. `schema/postgres.schema.json` and
  `schema/dist.schema.json` follow. No backward compatibility (pre-1.0).
- README: a Postgres quick start (download, `psql -f`, `CREATE TABLE ... (account scalars.iban)`, `scalars.is_iban`),
  a Postgres column in the method table, the "Postgres catches the 64-bit range but not check digits" and "Postgres
  checks the pattern only" sentences rewritten, and the native-type caveat (Postgres's parser decides those).
- Release 0.8.0, changelog entry, handoff updated.

## Left to the builder

- Exact SQL layout of the generated file and helper names, within the shapes above.
- Whether the per-type `_reason` functions are PL/pgSQL or SQL (PL/pgSQL is the default, for the cached list literal;
  measure before switching).
- The exact cap on integer/number text before the `numeric` cast.
- Planting one bug per gate in the generated SQL (as with every engine change) to prove a shared case catches it.
