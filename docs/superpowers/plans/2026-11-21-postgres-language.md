# Postgres as a fifth language: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A generated `dist/postgres/scalars.sql` giving every type (except `enum`) `scalars.<type>_reason`,
`scalars.is_<type>` and a `scalars.<type>` domain, held to `cases.json` by a fifth runner in PGlite.

**Architecture:** A new emitter `dev/codegen/postgres.mjs` writes per-type PL/pgSQL from the codegen model, and
embeds the hand-written `dev/codegen/engine.sql` (one boolean function per `$meta.checks` entry). The domain CHECK
for each type is computed in `dev/lib/derive.mjs` and lands in dist as `postgres.domain_check`, so the emitter reads
dist only. A runner `dev/langs/check.pg.mjs` loads the file into PGlite and runs the shared cases.

**Tech Stack:** Node 22+, PL/pgSQL, `@electric-sql/pglite` 0.2.17 (Postgres 16.4), `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-21-postgres-language-design.md`

## Global Constraints

- Plain SQL and PL/pgSQL only; no extension, no superuser; Postgres 16+ (tested on PGlite 16.4).
- Every function `IMMUTABLE STRICT PARALLEL SAFE`, every name inside fully qualified (`scalars.`, `pg_catalog`
  built-ins unqualified is fine), no `SET search_path`.
- Linear worst case: read characters with `convert_to(s, 'UTF8')` + `get_byte`, never `substr` in a loop; checks use
  `integer` arithmetic reduced mod as they go; no `numeric` in checks.
- Closed lists: a jsonb object literal (`{"AD":1,...}`) tested with `?` inside the PL/pgSQL function.
- Reasons are emitted from `$meta.reasons`; `engine.sql` never spells one.
- Normalize is not ported: inputs are canonical.
- Re-running the file must succeed and update functions; domains are created in `DO` blocks that skip existing ones.
- Spec amendment (made while planning): the domain CHECK expression is carried in dist as
  `postgres.domain_check` (SQL using `VALUE`), next to `postgres.domain: "scalars.<type>"`, because emitters read dist
  only. `postgres.check` (the `{column}` snippets) is removed.
- Number text that `float8` can't parse (overflow or underflow, e.g. `1e400`, `1e-400`) is `out_of_range` for both
  integer and number kinds: a Postgres-only edge the README states. The number kinds parse as `float8`, as JSON
  parsers do, so the cost is linear and `9223372036854776000` behaves as in the reference.
- Release 0.8.0. Never edit `dist/` by hand; `npm run build` in `dev/`.

## Review Focus

1. **Running the file twice** (an upgrade): must succeed, keep domains, replace functions. Pinned in Task 4.
2. **A column holding NULL**: domains with a STRICT function must accept NULL (nullable is the column's business).
   Pinned in Task 4.
3. **Over-long input to a closed-list or check type** (`language` with 200,000 letters, `int64` with 100,000
   digits): must fail fast by length or pattern before the check or list. Pinned by the hostile cases in Task 3, plus
   a timing assertion in Task 3.
4. **Quotes and backslashes in emitted literals** (patterns contain `\.` and `'`; list codes are plain): the emitter
   must SQL-quote with `sqlString` and the file must load with `standard_conforming_strings` on (the default). Pinned
   by the loading test in Task 2 and a pattern-with-quote unit test there.
5. **Text with characters outside ASCII reaching a check** (impossible after the pattern, but the check must not
   misread multibyte UTF-8 if called directly): `scalars.check_*` called on non-ASCII returns false, not an error.
   Pinned in Task 1.

---

### Task 1: Check helpers in `engine.sql`

**Files:**
- Create: `dev/codegen/engine.sql`
- Create: `dev/test/postgres.test.mjs`

**Interfaces:**
- Produces: in schema `scalars`, `check_gs1_mod10(text)`, `check_iso7064_mod97_10(text)`, `check_iban(text)`,
  `check_isbn(text)`, `check_iso7064_mod11_2(text)`, `check_int64_range(text)`, `check_uint64_range(text)`, each
  `RETURNS boolean LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE`. The file starts with
  `CREATE SCHEMA IF NOT EXISTS scalars;` and uses `CREATE OR REPLACE FUNCTION`. The names are `check_` + the
  `$meta.checks` key (snake case), which Task 2's guard relies on.

- [ ] **Step 1: Write the failing test** in `dev/test/postgres.test.mjs`: load `engine.sql` (via `readEngine`) into a
  fresh `PGlite`, then for every check name in `$meta.checks` and every type with that check, assert
  `scalars.check_<name>(v)` equals `CHECKS[name](v)` from `dev/lib/reference.mjs` for each normalized valid and
  `check_invalid` example, plus 2,000 random strings per check built in the check's shape (seeded: digits of the right
  lengths for gs1/isbn/int64/uint64 including leading zeros, `-` signs and the exact boundary texts
  `9223372036854775807`, `9223372036854775808`, `-9223372036854775808`, `-9223372036854775809`,
  `18446744073709551615`, `18446744073709551616`; `[A-Z0-9]` for mod97/iban; digits with hyphens and a final `X` for
  mod11_2). Also assert `scalars.check_gs1_mod10('٣٣٣')` and `scalars.check_iban('DEéé')` return `false` without error,
  and that a 100,000-digit `check_int64_range` call returns false in under 200 ms.
- [ ] **Step 2: Run** `cd dev && node --test test/postgres.test.mjs`. Expected: FAIL (`engine.sql` missing).
- [ ] **Step 3: Implement `dev/codegen/engine.sql`** porting `CHECKS` from `reference.mjs` line by line. Characters
  outside `0-9A-Z` (and `X`/`-` where the check allows them) make the function return false. Range checks: strip
  leading zeros with `ltrim(s, '0')` (keep one zero), compare `char_length`, then compare `COLLATE "C"`.
- [ ] **Step 4: Run** the test again. Expected: PASS.
- [ ] **Step 5: Add `engine.sql` to the reason sweep** in `dev/test/codegen.test.mjs` (the list in "reasons are
  emitted from $meta.reasons"); run `node --test test/codegen.test.mjs`. Expected: PASS.
- [ ] **Step 6: Plant a bug** (e.g. `* 3` → `* 2` in gs1), run Step 4, see it fail, revert.
- [ ] **Step 7: Commit** `feat(postgres): check helpers in engine.sql`.

### Task 2: The emitter and the per-type functions

**Files:**
- Create: `dev/codegen/postgres.mjs`
- Modify: `dev/codegen/generate.mjs` (add `emitPostgres` to `EMITTERS`)
- Modify: `dev/codegen/common.mjs` (`header`: `.sql` uses `--`)
- Test: `dev/test/postgres.test.mjs`, `dev/test/codegen.test.mjs`
- Output: `dist/postgres/scalars.sql`

**Interfaces:**
- Consumes: Task 1's `scalars.check_<name>`; `toModel` records (`kind`, `pattern`, `check`, `list`, `minLen`,
  `maxLen`, `minimum`, `maximum`); `sqlString` from `dev/lib/derive.mjs`.
- Produces: `emitPostgres(models, version, meta) → { "postgres/scalars.sql": text }`. For every model except
  `name === "enum"`:
  - `scalars.<name>_reason(v text) RETURNS text` (`jsonb` instead of `text` when `kind` is `object`, `array` or
    `any`), NULL when valid, else a reason name.
  - `scalars.is_<name>(v <same>) RETURNS boolean` as `LANGUAGE sql` returning `scalars.<name>_reason(v) IS NULL`.
  - Gates by kind, in this order:
    - `text`: `char_length(v) > maxLen` → `too_long`; `< minLen` → `too_short`; `v !~ pattern` → `pattern`;
      `NOT scalars.check_<check>(v)` → `check`; `NOT (<jsonb literal> ? v)` → `not_in_list`. Emit only the gates the
      model has.
    - `integer`: `v !~ JSON_NUMBER` → `wrong_kind`; `x := v::float8` (exception `numeric_value_out_of_range` →
      `out_of_range`); `x <> trunc(x)` → `wrong_kind`; outside `minimum`/`maximum` → `out_of_range`.
    - `number`: `v IN ('NaN','Infinity','-Infinity')` → `out_of_range`; `v !~ JSON_NUMBER` → `wrong_kind`; cast as
      above; bounds if any.
    - `boolean`: not `'true'`/`'false'` → `wrong_kind`.
    - `object`/`array`: `jsonb_typeof(v) <> 'object'`/`'array'` → `wrong_kind`. `any`: always NULL.
  - `JSON_NUMBER` is `'^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$'`, defined once in the emitter.
  - The emitter fails the build if `engine.sql` lacks `FUNCTION scalars.check_<name>(` for any `$meta.checks` key
    (as `engineNames` does for Go/Rust), or if a model has a `kind` it doesn't know.
  - File order: `header(...)` (`-- ` lines: version, "Postgres 16+, plain SQL, no extensions", "Install or upgrade:
    psql -f scalars.sql"), `engine.sql`, then the functions sorted by type name. LF endings, trailing newline.

- [ ] **Step 1: Write failing tests** in `dev/test/postgres.test.mjs`: build (`build(root).code["postgres/scalars.sql"]`),
  load it into PGlite twice (the second load must not throw), and for every type and every example
  (`valid` normalized by `reference.normalize` for text kinds, `invalid`, `check_invalid`, `list_invalid`) assert
  `<type>_reason` equals `reference.validate(distT, input)`'s reason (NULL when ok). Numbers go in as
  `JSON.stringify(v)`, jsonb kinds as `$1::jsonb`. Assert there is no `scalars.enum_reason`. In
  `codegen.test.mjs`: `emitPostgres` throws `has no scalars.check_x` when given a `$meta.checks` with an extra `x`;
  a model whose pattern holds `'` emits it doubled; `header({file: "a.sql", ...})` starts with `-- a.sql`.
- [ ] **Step 2: Run** `node --test test/postgres.test.mjs test/codegen.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** `emitPostgres`, the `.sql` branch of `header`, and register it in `generate.mjs`.
- [ ] **Step 4: Run** `npm run build`, then `npm test`. Expected: PASS, including "dist holds only built files" and
  the stale-dist test with the new file.
- [ ] **Step 5: Plant a bug** per gate kind (swap `too_long`/`too_short` order; drop the list gate), see Step 1's test
  fail, revert.
- [ ] **Step 6: Commit** `feat(postgres): generated scalars.sql with a reason function per type`.

### Task 3: The fifth runner

**Files:**
- Create: `dev/langs/check.pg.mjs`
- Modify: `dev/langs/runners.mjs`, `dev/langs/fuzz.mjs`

**Interfaces:**
- Consumes: `dist/postgres/scalars.sql` (path: `postgres/scalars.sql` next to the dist file argument), Task 2's
  functions; `normalize`, `validate` from `dev/lib/reference.mjs`.
- Produces: `node check.pg.mjs <dist/scalars.json> <cases.json>` printing `postgres: N cases ok (K skipped: ...)`
  and exiting 1 on any disagreement, in the same style as `check.ts`. `runners(dist, cases, { postgres = true } = {})`
  includes `["postgres", process.execPath, ["check.pg.mjs", dist, cases], here]`; `runAll` takes the same option and
  `fuzz.mjs` passes `{ postgres: false }`.

- [ ] **Step 1: Write the runner.** For `validate`, `hostile` (built as `prefix + repeat × count + suffix`) and
  `match` cases: text kinds get `normalize(t, in)`; numbers `JSON.stringify(in)`; `special` by name
  (`NaN`/`Infinity`); booleans `String(in)`; jsonb kinds as jsonb. First assert `reference.validate(t, input)` agrees
  with the case (else fail naming the case as a spec bug), then compare `<type>_reason(input)` to the case's
  `reason` (NULL when `ok`). Skip, counting each: `malformed` cases; `dynamic` cases whose input is `null` or whose
  JSON kind differs from the type's kind except where Postgres gives the same answer (`boolean` into an integer type
  and arrays into `object` run; `null` and numbers into text types skip). `match` cases compare `ok` only (pattern
  match on the raw input, as the other runners do: check what `check.ts` does with `match` and mirror it). Skip
  `normalize`, `lookup`, `models`. Fail if any single hostile case takes over 2 s.
- [ ] **Step 2: Wire it** into `runners.mjs`; update `fuzz.mjs`.
- [ ] **Step 3: Run** `cd dev && npm run check:langs`. Expected: five runners print ok, Postgres with its skip
  counts. Read the skipped cases once and confirm each category is one the spec allows.
- [ ] **Step 4: Plant a bug** in the generated file's source (e.g. emit `>=` for the maxLen gate), rebuild, see the
  runner fail on a named case, revert and rebuild.
- [ ] **Step 5: Commit** `test(postgres): fifth runner over cases.json`.

### Task 4: Domains, and the dist `postgres` block

**Files:**
- Modify: `dev/lib/derive.mjs` (`pgCheck` → `pgDomainCheck`), `src/targets/postgres.yaml`,
  `schema/postgres.schema.json`, `schema/dist.schema.json`, `dev/codegen/postgres.mjs`
- Modify tests: `dev/test/derive.test.mjs`, `dev/test/portable.test.mjs`, `dev/test/resolve.test.mjs` (only where they
  read `postgres.check`), `dev/test/conformance.test.mjs`, `dev/test/postgres.test.mjs`

**Interfaces:**
- Produces: every dist type except `enum` has `postgres.domain: "scalars.<name>"`; it has `postgres.domain_check`
  (SQL boolean expression over `VALUE`) when the domain needs one:
  - column `text`/`varchar` and the type has a pattern, length bound, check or list: `scalars.is_<name>(VALUE)`.
  - integer columns with bounds narrower than native: `VALUE BETWEEN lo AND hi` (today's `INT_RANGES` logic).
  - hand-written in `postgres.yaml` as `domain_check` (replacing `check`): `uint64`
    `VALUE >= 0 AND VALUE <= 18446744073709551615 AND VALUE = trunc(VALUE)`; `sha256` `octet_length(VALUE) = 32`;
    `float32`/`float64` `VALUE NOT IN ('NaN', 'Infinity', '-Infinity')`; `ipv4` `family(VALUE) = 4 AND
    masklen(VALUE) = 32`; `ipv6` `family(VALUE) = 6 AND masklen(VALUE) = 128`; `ipv4_cidr` `family(VALUE) = 4`;
    `ipv6_cidr` `family(VALUE) = 6`. A hand one replaces the generated one.
  - `postgres.check` no longer exists anywhere.
  - The SQL file gains, after the functions, one `DO` block per type: create
    `scalars.<name> AS <postgres.type> [CHECK (<domain_check>)]` unless `to_regtype('scalars.<name>')` is not null.
    `enum` gets none.

- [ ] **Step 1: Update the tests first.** `derive.test.mjs`: `pgDomainCheck` returns `scalars.is_slug(VALUE)` for a
  patterned text type, `null` for uuid, the BETWEEN for int8, `null` for int32, and a hand `domain_check` wins.
  `conformance.test.mjs`: load the built `scalars.sql` in `before`, declare each table's column as
  `postgres.domain` (enum keeps its named type), insert text kinds normalized (`refValidate(distT, v).value`), and
  additionally assert the domain refuses every `check_invalid` and `list_invalid` value. `postgres.test.mjs`: loading
  the file twice keeps one domain per type; a `scalars.iban` column accepts NULL; `'1.2.3.4/24'::scalars.ipv4`,
  `'::1'::scalars.ipv4`, `'NaN'::scalars.float64` and a 31-byte `scalars.sha256` are refused; dist has no
  `postgres.check` and every non-enum type has `postgres.domain`.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL on the new assertions.
- [ ] **Step 3: Implement** the derive change, the yaml and schema edits (schema descriptions say what `domain` and
  `domain_check` are), and the `DO` blocks in the emitter.
- [ ] **Step 4: Run** `npm run build`, `npm test`, `npm run check:langs`. Expected: PASS.
- [ ] **Step 5: Plant a bug** (drop the ipv4 family check), see a test fail, revert.
- [ ] **Step 6: Commit** `feat(postgres): a domain per type; dist postgres.domain replaces check`.

### Task 5: Docs and release 0.8.0

**Files:**
- Modify: `README.md`, `CHANGELOG.md`, `src/scalar.yaml` (`version: 0.8.0`), `dev/test/build.test.mjs` (two version
  asserts), `docs/HANDOFF.md`
- Delete: this plan and the spec (recorded in the handoff's history, as with earlier work)

- [ ] **Step 1: README.** Add a Postgres quick start next to the others (download `dist/postgres/scalars.sql` from the
  `v0.8.0` tag with `curl`, `psql -f scalars.sql`, `CREATE TABLE payment (account scalars.iban NOT NULL)`,
  `SELECT scalars.iban_reason('DE89370400440532013001')` → `check`), a Postgres column in the method table
  (`<type>_reason`, `is_<type>`, domain; no normalize, no `get`/`all`), rewrite the `{column}` CHECK paragraph and the
  "Postgres catches the 64-bit range but not check digits" / "Postgres checks the pattern only" sentences, and state:
  normalize in the app; native types use Postgres's own parser; domains take no length/precision; re-run to upgrade,
  old rows aren't rechecked; number text `float8` can't hold is `out_of_range`. Run the quick start from scratch in
  PGlite (or a real Postgres if one is at hand) and paste nothing unverified.
- [ ] **Step 2: Version and changelog**: bump to 0.8.0 (scalar.yaml and the asserts), `npm run build`, a dated 0.8.0
  entry (breaking: `postgres.check` removed, `postgres.domain`/`domain_check` added; new: `dist/postgres/scalars.sql`).
  Move the README links to `v0.8.0`.
- [ ] **Step 3: Verify**: `npm test`, `npm run check:ts`, `npm run check:langs`, `npm run fuzz:models -- 1 200`,
  `gofmt -l` on the Go dirs. Expected: all pass, no gofmt output.
- [ ] **Step 4: Commit** `release: 0.8.0, Postgres as a fifth language`.
- [ ] **Step 5: Handoff**: update "Where things stand" (Postgres is a language; the runner; the jsonb list measurement;
  the float8 edge), replace the "Next: Postgres" section with a history entry, delete the spec and plan, commit
  `docs(handoff): 0.8.0`. Ask the owner before pushing and tagging `v0.8.0`; tag only after CI passes.
