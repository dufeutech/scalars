# Check Digits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `validate` rejects identifiers with a wrong check digit (`gtin`, new `gln`, `iban`, `lei`, `isbn`, `orcid`) in all four generated languages and the dev reference.

**Architecture:** A type names its algorithm with a new core key `checksum`; the five names and their meanings live in `schema/scalar.schema.json` `$defs.checksum` and are copied to `dist/scalars.json` `$meta.checksums`, exactly like `normalize_steps`. Each engine implements the five algorithms once and runs the type's one after the pattern matches. A new example list `checksum_invalid` holds values that pass the pattern but fail the checksum.

**Tech Stack:** Node 22+ build/tests (node:test, ajv, PGlite), generated Python / TypeScript / Go / Rust.

**Spec:** `docs/superpowers/specs/2026-11-20-checksums-design.md`

## Global Constraints

- Never rename or move an existing field of `dist/scalars.json` (0.3.0 stable shape). Only add.
- `validate` stays O(n) worst case. The checksum runs only after the pattern matched. Mod 97 is computed digit by digit, never as a big integer.
- Never edit `dist/` by hand: change `src/`, `schema/` or `dev/codegen/`, then `cd dev && npm run build`.
- Write anything containing regex backslashes with the Edit/Write tools, never Bash heredocs (the Bash tool collapses `\\`).
- Checksum names, exactly: `gs1_mod10`, `iso7064_mod97_10`, `iban`, `isbn`, `iso7064_mod11_2`.
- Assignments: `gtin`, `gln` → `gs1_mod10`; `lei` → `iso7064_mod97_10`; `iban` → `iban`; `isbn` → `isbn`; `orcid` → `iso7064_mod11_2`.
- One error text per type. Reword the five existing ones so they also cover a wrong check digit.
- Done means: `npm test` and `npm run check:langs` both pass, and `dist/` is rebuilt and committed.

## Algorithms (the meaning every implementation follows; also the `$defs.checksum` descriptions)

- `gs1_mod10`: digits only. From the right, the check digit has weight 1, then weights alternate 3, 1, 3, …; the weighted sum is a multiple of 10.
- `iso7064_mod97_10`: read left to right; a digit d does `r = (r*10 + d) % 97`, a letter A-Z (value 10-35) does `r = (r*100 + v) % 97`; valid when `r == 1`.
- `iban`: the first four characters moved to the end, then `iso7064_mod97_10`.
- `isbn`: 13 characters use `gs1_mod10`. 10 characters: value of position i (0-based) times (10 − i), with `X` or `x` = 10; the sum is a multiple of 11.
- `iso7064_mod11_2`: skip hyphens. For each character but the last, `t = (t + digit) * 2`; the check value is `(12 - t % 11) % 11`, written `X` when 10; valid when the last character equals it.

Reference body (JS, `dev/lib/reference.mjs`); the engines port it:

```js
const gs1 = (s) => { let t = 0; for (let i = 0; i < s.length; i++) t += (s.charCodeAt(s.length - 1 - i) - 48) * (i % 2 ? 3 : 1); return t % 10 === 0; };
const mod97 = (s) => { let r = 0; for (const c of s) { const v = parseInt(c, 36); r = (v > 9 ? r * 100 + v : r * 10 + v) % 97; } return r === 1; };
const isbn10 = (s) => { let t = 0; for (let i = 0; i < 10; i++) t += (/[Xx]/.test(s[i]) ? 10 : s.charCodeAt(i) - 48) * (10 - i); return t % 11 === 0; };
const mod11_2 = (s) => { s = s.replaceAll("-", ""); let t = 0; for (let i = 0; i < s.length - 1; i++) t = (t + s.charCodeAt(i) - 48) * 2; const r = (12 - t % 11) % 11; return s.at(-1) === (r === 10 ? "X" : String(r)); };
export const CHECKSUMS = {
    gs1_mod10: gs1,
    iso7064_mod97_10: mod97,
    iban: (s) => mod97(s.slice(4) + s.slice(0, 4)),
    isbn: (s) => (s.length === 13 ? gs1(s) : isbn10(s)),
    iso7064_mod11_2: mod11_2,
};
```

## Example values (all verified against the reference above)

| Type | valid (changes) | checksum_invalid |
| --- | --- | --- |
| gtin | unchanged | `"0614141000037"`, `"96385075"` |
| gln (new) | `"0614141000012"`, `"4000001000005"` | `"0614141000013"`, `"4000001000006"` |
| iban | unchanged | `"DE89370400440532013001"`, `"GB82WEST12345698765433"` |
| lei | unchanged | `"5493001KJTIIGC8Y1R13"`, `"529900T8BM49AURSDO56"` |
| isbn | replace `"030640615X"` with `"080442957X"` (a real ISBN-10 ending in X) and add `"0306406152"` | `"9780306406158"`, `"0306406153"` |
| orcid | unchanged | `"0000-0002-1825-0098"`, `"0000-0002-9079-5930"` |

`gln` invalid (pattern): `"061414100001"`, `"06141410000123"`.

## Review Focus

- **Spaced or hyphenated input** (`"0614 1410 0001 2"`, `"0-306-40615-2"`, `" de89 3704 0044 0532 0130 00 "`). The checksum must run on the normalized value, so these pass. Covered by `validate` cases in Task 1.
- **Lowercase `x` in an ISBN-10** (`"080442957x"`). The pattern allows it, so the checksum must count it as 10. Covered by a `validate` case in Task 1.
- **Inheritance:** a type built on a checksum type with `"checksum": null` must lose the checksum. Covered by a resolve test in Task 1.
- **Unknown checksum name in source.** The build must fail at resolve time, not at runtime. Covered by a resolve test in Task 1.
- **Very long hostile input** on a checksum type. The length gate and pattern reject it before the checksum runs. Covered by a `hostile` case in Task 1.

---

### Task 1: Catalogue, schema and reference

**Files:**
- Modify: `schema/scalar.schema.json` (new `$defs.checksum`; type property `checksum`; `examples.checksum_invalid`; mention `checksum` in the `base` description's inherited list)
- Modify: `schema/dist.schema.json` (`$meta.checksums` required, same shape as `normalize_steps`; type property `checksum` (string); `examples.checksum_invalid`)
- Modify: `dev/lib/resolve.mjs` (add `"checksum"` to `INHERITED`; throw on an unknown name)
- Modify: `dev/build.mjs` (`$meta.checksums` from `schema.$defs.checksum.oneOf`)
- Modify: `dev/lib/reference.mjs` (export `CHECKSUMS`; `validate` runs the type's checksum after the pattern)
- Modify: `src/scalar.json` (checksum keys, `checksum_invalid` lists, the `isbn` fix, five reworded errors, new `gln`; `$defs.docs.gs1_gln` = `https://www.gs1.org/standards/id-keys/gln`)
- Modify: `dev/langs/cases.json` (`validate` and `hostile` cases below)
- Test: `dev/test/conformance.test.mjs`, `dev/test/resolve.test.mjs`, `dev/test/langs.test.mjs`

**Interfaces:**
- Produces: every resolved and dist type may carry `checksum: <name>`. `examples.checksum_invalid: string[]`. `$meta.checksums: { [name]: description }`. `CHECKSUMS` in `dev/lib/reference.mjs`, mapping each name to `(s: string) => boolean` on the normalized, pattern-matched value.

- [ ] **Step 1: Write the failing tests**

  In `conformance.test.mjs`:
  - `test("checksum types have at least 2 checksum_invalid examples, other types none")`: every type with `checksum` has `checksum_invalid.length >= 2`, and every type without one has no `checksum_invalid`.
  - Inside the per-type `conformance:` test, for each `checksum_invalid` value:
    - `validate(v)` (ajv) is true.
    - The HTML test is true.
    - The Postgres INSERT is accepted.
    - Reference `validate(t, v).ok` is false (import `validate as refValidate` from `../lib/reference.mjs`).
    - For each `valid` example, `CHECKSUMS[t.checksum](refValidate(t, v).value)` is true.

  In `resolve.test.mjs`:
  - A child with `"checksum": null` has no `checksum`.
  - A type naming `"checksum": "nope"` throws `/unknown checksum "nope"/`.

  Follow that file's existing fixture style for both.

  In `cases.json`, add these `validate` cases:

  | `type` | `in` | `ok` | `out` |
  | --- | --- | --- | --- |
  | `gln` | `"0614 1410 0001 2"` | true | `"0614141000012"` |
  | `isbn` | `"0-306-40615-2"` | true | `"0306406152"` |
  | `isbn` | `"080442957x"` | true | `"080442957x"` |
  | `iban` | `" de89 3704 0044 0532 0130 00 "` | true | `"DE89370400440532013000"` |
  | `gtin` | `"0614141000037"` | false | |

  And one `hostile` case: `gln`, 100000 repeats of `"1"`. It must stay under the file's existing time bound.

- [ ] **Step 2: Run them and confirm they fail**

  Run: `cd dev && npm test`
  Expected: FAIL. `gln` is unknown, the `checksum_invalid` assertions fail, and the resolve tests fail.

- [ ] **Step 3: Implement**

  Schema, resolve and build:
  - Add the schema entries. Each description is the algorithm text above.
  - Add `"checksum"` to `INHERITED`.
  - In resolve, next to the params check, throw ``Type "${name}" names unknown checksum "${t.checksum}"`` when the name isn't in the schema's `$defs.checksum`. Read the names from the schema file, as `PRIMITIVES` does.

  Reference:
  - Copy `CHECKSUMS` from this plan into `reference.mjs`.
  - In its `validate`, after `re.test(s)`, return `fail` when `t.checksum && !CHECKSUMS[t.checksum](s)`.

  Source (`src/scalar.json`):
  - Add the checksum keys and example values from the tables above.
  - Rewrite the five error texts so they also cover a wrong check digit, e.g. gtin: `"Please check the number: 8, 12, 13 or 14 digits, like 0614141000036."`. Keep each short and give the example.
  - Add `gln` with label `"Location number (GLN)"`, hint `"13 digits"`, error `"Please check the number: 13 digits, like 0614141000012."`, standard `"GS1 GLN"`, docs `"gs1_gln"`, and a details sentence telling it apart from `gtin`.

- [ ] **Step 4: Run, confirm everything passes, rebuild**

  Run: `cd dev && npm test`
  Expected: the new tests pass. The stale-dist test fails until you run `npm run build`; after the build, all tests pass.

  Then run `npm run check:langs` and confirm it still passes. The runners don't read `checksum_invalid` yet, and every valid example has a correct check digit.

- [ ] **Step 5: Commit**

  ```bash
  git add schema src dev/lib dev/build.mjs dev/langs/cases.json dev/test dist
  git commit -m "feat: checksum key, checksum_invalid examples, gln type"
  ```

---

### Task 2: TypeScript and Python engines

**Files:**
- Modify: `dev/codegen/model.mjs` (`checksum: t.checksum ?? null`)
- Modify: `dev/codegen/ts.mjs`, `dev/codegen/python.mjs` (emit `checksum` when not null)
- Modify: `dev/codegen/engine.ts`, `dev/codegen/engine.py`
- Modify: `dev/langs/check.ts`, `dev/langs/check.py`
- Test: `dev/test/codegen.test.mjs` (add `checksum: null` to the hand-built model at line 76)

**Interfaces:**
- Consumes: `checksum` on dist types, and `examples.checksum_invalid` (Task 1).
- Produces: `model.checksum: string | null`.
  - TS: `Scalar` init accepts `checksum?: string` and exposes `readonly checksum: string | undefined`.
  - Python: `Scalar(..., checksum: str | None = None)` and exposes the `checksum` attribute (added to `__slots__`).

- [ ] **Step 1: Make both runners check the new examples**

  In `check.ts` and `check.py`:
  - For each `checksum_invalid` value, report `${name} accepts checksum_invalid ${v}` when `isValid(v)` is true.
  - Add `checksum` to the metadata comparison (dist's `checksum ?? null` against the type's).

- [ ] **Step 2: Run and confirm it fails**

  Run: `cd dev && npm run check:langs`
  Expected: the ts and python runners report `accepts checksum_invalid` (go and rust are fixed in Task 3).

- [ ] **Step 3: Implement**

  - Each engine has one table from checksum name to function, ported from the reference in this plan.
  - Resolve an unknown name at construction so it fails there, like `_STEPS`.
  - Run the checksum after the pattern test passes (`engine.ts` near line 228, `engine.py` near line 190). Return `NO` / `_NO` when it fails.
  - Python: work on code points with `ord`, no regex.
  - TS: use `charCodeAt`.
  - Each emitter writes `checksum` only when it isn't null.

- [ ] **Step 4: Rebuild and run**

  Run: `cd dev && npm run build && npm test && node langs/run.mjs`
  Expected: npm test passes, and the ts and python runners pass.

- [ ] **Step 5: Commit**

  ```bash
  git add dev/codegen dev/langs/check.ts dev/langs/check.py dev/test dist
  git commit -m "feat(codegen): checksums in TypeScript and Python"
  ```

---

### Task 3: Go and Rust engines

**Files:**
- Modify: `dev/codegen/engine.go`, `dev/codegen/go.mjs`
- Modify: `dev/codegen/engine.rs`, `dev/codegen/rust.mjs`
- Modify: `dev/langs/go/main.go`, `dev/langs/rust/src/main.rs`

**Interfaces:**
- Consumes: `model.checksum` (Task 2) and `examples.checksum_invalid` (Task 1).
- Produces:
  - Go: `Meta.Checksum string` (`""` when none). `TextScalar` gets an unexported `check checksum` field; `checksum` is a `uint8` type with constants, like `step`.
  - Rust: `Meta.checksum: Option<&'static str>`. `TextScalar` gets a `check: Option<Checksum>` field, where `Checksum` is a private enum with one variant per name.

- [ ] **Step 1: Make both runners check the new examples**

  - Add the `accepts checksum_invalid` check and the `checksum` metadata comparison, mirroring Task 2.
  - Go: add `ChecksumInvalid []any \`json:"checksum_invalid"\`` to the examples struct at `main.go:31`.

- [ ] **Step 2: Run and confirm it fails**

  Run: `cd dev && npm run check:langs`
  Expected: the go and rust runners report `accepts checksum_invalid`.

- [ ] **Step 3: Implement**

  - Port the algorithms over bytes. The input is ASCII once the pattern has matched.
  - Run the checksum after `MatchString` (`engine.go:109`) or `is_match` (`engine.rs:125`). When it fails, return the ScalarError.
  - The emitters write the constant or variant.
  - Nothing may run at program start, and Go must need no init code. Both are existing rules.

- [ ] **Step 4: Rebuild and run everything**

  Run: `cd dev && npm run build && npm test && npm run check:langs`
  Expected: all pass in all four languages.

- [ ] **Step 5: Commit**

  ```bash
  git add dev/codegen dev/langs/go dev/langs/rust dist
  git commit -m "feat(codegen): checksums in Go and Rust"
  ```

---

### Task 4: Docs

**Files:**
- Modify: `README.md`, `CHANGELOG.md`, `docs/HANDOFF.md`

- [ ] **Step 1: Update the docs**

  README:
  - "55 more" becomes 56. Count the non-core types in `dist/scalars.json` to confirm.
  - Add one bullet under "Good to know": identifiers with a check digit (`gtin`, `gln`, `iban`, `lei`, `isbn`, `orcid`) have it checked by `validate` in all four languages. JSON Schema, HTML and Postgres check only the pattern. `checksum` names the algorithm, and `$meta.checksums` defines it.
  - Add one line in the JSON-files bullet list about `examples.checksum_invalid`.

  CHANGELOG: under "Unreleased", add checksum, `checksum_invalid`, `gln`, and the `isbn` example fix.

  HANDOFF:
  - Add a rule under "Rules that are easy to break": checksum types need at least 2 `checksum_invalid` examples.
  - Note that Postgres functions for checksums are a possible next step.
  - Update the test count from `npm test` output.

  Leave the user's unrelated uncommitted changes to `README.md` and `docs/HANDOFF.md` in place: edit on top of them and commit only these files.

- [ ] **Step 2: Verify**

  Run: `cd dev && npm test && npm run check:langs`
  Expected: all pass.

- [ ] **Step 3: Commit**

  ```bash
  git add README.md CHANGELOG.md docs/HANDOFF.md
  git commit -m "docs: check digits and gln"
  ```
