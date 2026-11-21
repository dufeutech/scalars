# Closed code lists and failure reasons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every `validate` failure carries a reason from one fixed set, models report that reason as their error code, and `country`, `country_alpha3` and `currency` accept only currently assigned ISO codes. Ships as 0.6.0.

**Architecture:** The reference (`dev/lib/reference.mjs`) defines the reasons and their order. Shared cases in `dev/langs/cases.json` pin them, and each hand-written engine (`dev/codegen/engine.*`, `models.*`) returns the reason from its existing single pass. The lists are a core `enum` key in `src/scalar.json`, which lands in dist as `schema.enum` and is emitted once per type into each language.

**Tech Stack:** Node (build and tests, `node --test`), TypeScript, Python ≥3.10, Go ≥1.21, Rust ≥1.80, PGlite, ajv.

**Spec:** `docs/superpowers/specs/2026-11-21-lists-and-reasons-design.md`

## Global Constraints

- No backward compatibility: rename or remove when it gives the cleaner design. A changelog entry and version bump are still required.
- `validate` stays O(n) worst case. `is_valid` builds no error and no reason string.
- The reason comes from the same single pass that validates. There is no second pass.
- Reasons, exactly: `wrong_kind`, `malformed`, `too_long`, `too_short`, `pattern`, `out_of_range`, `check`, `not_in_list`. They are defined once in `src/scalar.json` `$defs.reasons` and emitted as `$meta.reasons`. Engines never spell a reason as a string literal.
- Order: kind → early length gate (`too_long`) → well-formed (`malformed`) → case-mapping gate (`too_long`) → length (`too_long`, then `too_short`) → `pattern` → bounds (`out_of_range`) → `check` → `not_in_list`.
- Each list lives once in `src/`. Postgres keeps the pattern CHECK only (no list).
- Dependencies are unchanged: Python and TS none, Go `golang.org/x/text`, Rust `regex` and `serde_json`. Go has no package init code (no map literals at package level).
- Never edit `dist/` by hand: change `src/` or `dev/codegen/` and run `npm run build`.
- On this machine, the Bash tool collapses `\\` to `\`. Any edit containing a backslash goes through the file editor, never a shell heredoc. Run Python with `-B` or on a copy, never import `dist/python/scalars.py` in place.
- Run everything from `dev/`: `npm test`, `npm run check:langs`, `npm run check:ts`, `npm run fuzz:models -- 1 200`. Each task ends with all of them green.

## Review Focus

1. **Two reasons at once.** Text that is both over-long and malformed, or both too long and off-pattern, must give the same reason in all four languages. Task 1 adds shared cases at each gate.
2. **Go and Rust inputs the runner rejects before the engine** (a float passed as an int, a lone surrogate). These have no engine reason, so the runners skip the reason check there (`checked` is false), and nothing panics.
3. **A list value that normalize turns valid.** `country` " us " → "US" passes, and "ß" → "SS" (South Sudan) still passes. Task 6 keeps the existing `ß` case and adds `" xx "` → `not_in_list`.
4. **Models `too_long` from two sources.** A type's own `maxLength` and a field's `length` setting must both give `too_long` with the same template and `params {type, max}`. Task 5 adds a shared case for each.
5. **`country_alpha3` inheriting `country`'s list.** The build must refuse it unless the type sets its own. Task 6 adds a resolve test.

---

### Task 1: Reasons in the source and the reference

**Files:**
- Modify: `src/scalar.json` (`$defs.reasons`), `schema/scalar.schema.json` (allow `$defs.reasons`), `schema/dist.schema.json` (`$meta.reasons`: object of string → string, required), `dev/build.mjs` (emit `$meta.reasons`)
- Modify: `dev/lib/reference.mjs` (`validate` returns `{ ok: false, reason }`)
- Modify: `dev/langs/cases.json` (`reason` on every `ok: false` case in `validate` and `hostile`; new competing-gate cases)
- Test: `dev/test/reasons.test.mjs` (new)

**Interfaces:**
- Produces: `$meta.reasons` in dist, keyed in the order above. `validate(t, v)` → `{ ok: true, value }` or `{ ok: false, reason }`. Each `ok: false` scalar case has `"reason": "<name>"`.

- [ ] **Step 1: Write the failing tests** in `dev/test/reasons.test.mjs`:
  - `$meta.reasons keys are exactly the eight, in order`: `assert.deepEqual(Object.keys(scalars.$meta.reasons), ["wrong_kind","malformed","too_long","too_short","pattern","out_of_range","check","not_in_list"])`. Task 6 adds `not_in_list`'s first producer; the name exists from now on.
  - `reference gives each shared case's reason`: for every `validate` case with `ok: false` and no `special`, `assert.equal(validate(type, c.in).reason, c.reason)`. Build `special` inputs (`NaN`, `Infinity`) as the runners do. For `hostile`, build the input as `prefix + repeat.repeat(count) + suffix` and assert the same.
  - `every ok:false case names a reason`: each such case in `validate` and `hostile` has a `reason` that is a key of `$meta.reasons`.
  - `every reason except not_in_list has a shared case`: the set of reasons in cases ⊇ all eight minus `not_in_list` (Task 6 makes it all eight).
- [ ] **Step 2: Run** `npm test -- --test-name-pattern=reason` (from `dev/`). Expected: FAIL (no `$meta.reasons`, no `reason`).
- [ ] **Step 3: Add `$defs.reasons`** to `src/scalar.json`, with the meanings from the spec's table as one-line strings. Emit them in `build.mjs` as `$meta.reasons: sources.core.$defs.reasons`, and allow them in both schemas.
- [ ] **Step 4: Make the reference return the reason.** Keep the flow of `reference.mjs` `validate` and replace each `return fail` with the reason for that spot: non-string or wrong JS type → `wrong_kind`. Inside `formed`, split the length gate (`too_long`) from `isWellFormed` (`malformed`). Case gate → `too_long`. Final length: `n > maxLen` → `too_long`, else `n < minLen` → `too_short`. Then pattern → `pattern`, then `check`. Integer: not a number or not an integer → `wrong_kind`, out of bounds → `out_of_range`. Number: not a number → `wrong_kind`, non-finite or out of bounds → `out_of_range`. Boolean, object and array → `wrong_kind`.
- [ ] **Step 5: Annotate `cases.json`** with the file editor (it holds `\u` escapes). Give every `ok: false` case in `validate` and `hostile` the reason the reference gives, and check each one by eye against the order. Add these cases:
  - `{ "type": "char", "in": "ab", "ok": false, "reason": "too_long" }` in `validate`
  - one text type with `minLength` given a shorter value → `too_short`
  - a malformed value that is also over the early gate on a length-bounded type → `too_long` (the gate runs first), marked `"malformed": "surrogate"`
  - a lowercase/uppercase type given over-long text → `too_long` from the case gate
  - `{ "type": "int32", "in": 2147483648, "reason": "out_of_range" }` (exists, annotate it)
- [ ] **Step 6: Run** `npm run build && npm test`. Expected: PASS. Also run `npm run check:langs`. Expected: PASS, since the runners ignore the new `reason` key (verify that serde and Go's decoder don't reject unknown fields).
- [ ] **Step 7: Commit** `feat: failure reasons in the source and the reference`.

### Task 2: Reasons in the TypeScript and Python engines

**Files:**
- Modify: `dev/codegen/engine.ts`, `dev/codegen/ts.mjs`, `dev/codegen/engine.py`, `dev/codegen/python.mjs`
- Modify: `dev/langs/check.ts`, `dev/langs/check.py` (check `reason`)
- Test: `dev/test/codegen.test.mjs`

**Interfaces:**
- Consumes: `$meta.reasons` (Task 1).
- Produces: TS: emitted `export const Reason = { WrongKind: "wrong_kind", … } as const; export type Reason = (typeof Reason)[keyof typeof Reason];`, and `ScalarError.reason: Reason`. Python: an emitted `class Reason:` with `WRONG_KIND: Final = "wrong_kind"`, …, and `ScalarError.reason: str`. Internally, `run`/`_check` return the clean value or a module-private failure object per reason. In TS that's `const FAIL: Readonly<Record<Reason, Failure>>` with `class Failure { constructor(readonly reason: Reason) }`, so `r instanceof Failure` replaces `r === NO`. Python mirrors it with `_Failure`. Models (Task 5) read `.reason` off that object.

- [ ] **Step 1: Write the failing tests.**
  - In `codegen.test.mjs`, `reasons are emitted from $meta.reasons, never spelled by an engine`: in each of `engine.{ts,py,go,rs}`, no reason name appears as a quoted literal (`/["'](wrong_kind|malformed|too_long|too_short|pattern|out_of_range|check|not_in_list)["']/`). Task 5 extends the list to `models.{ts,py,go,rs}`, where the field-setting `too_long` then uses the `Reason` constant too. The test also asserts that the generated TS contains `export const Reason` with all eight, and that the Python has `class Reason`. If `"check"` or `"pattern"` collide with unrelated literals in an engine (a property name, say), narrow the regex to the reason context and note it in the test.
  - In `check.ts` and `check.py`: for each `validate`/`hostile` case with `ok: false`, assert `err.reason === c.reason` on the caught `ScalarError`.
- [ ] **Step 2: Run** `npm test` and `npm run check:langs`. Expected: FAIL on the new assertions.
- [ ] **Step 3: Emit the reasons** in `ts.mjs` and `python.mjs` from `meta.reasons`, using `pascal` (TS keys) and upper snake case (Python). Put them in the tables block, after the engine.
- [ ] **Step 4: Change the engines.** Replace `NO` with the per-reason failure objects at each return, following the reference's order: in `formed`, split the early gate from `isWellFormed`. `ScalarError(scalar, reason)` sets `.reason`. `isValid` / `is_valid` test `!(r instanceof Failure)` (`not isinstance(r, _Failure)`). That's still no allocation, because the failure objects are module constants.
- [ ] **Step 5: Run** `npm run build && npm test && npm run check:ts && npm run check:langs`. Expected: PASS.
- [ ] **Step 6: Plant a bug:** swap `too_long` and `malformed` in the TS `formed` order. Confirm Step 5 fails on a Task 1 competing-gate case, then revert.
- [ ] **Step 7: Commit** `feat(ts, python): ScalarError carries the reason`.

### Task 3: Reasons in the Go engine

**Files:**
- Modify: `dev/codegen/engine.go`, `dev/codegen/go.mjs`, `dev/langs/go/main.go`
- Test: `dev/test/codegen.test.mjs` (the literal guard from Task 2 now covers Go)

**Interfaces:**
- Produces: emitted `type Reason string` and `const ( ReasonWrongKind Reason = "wrong_kind"; … )` from `$meta.reasons`. `ScalarError{Scalar *Meta; Reason Reason}`. `(t *TextScalar) check(s string) (string, Reason)` returns `""` for ok, and the same shape for Int and Number (`IsValid` stays allocation-free). The models-side `check(scalar, v any) (any, Reason)` returns `ReasonWrongKind` when the JSON value's Go type is wrong.

- [ ] **Step 1: Write the failing test.** In `main.go`'s case loop, when `r.checked` and the case has `reason`, compare `r.err.(*scalars.ScalarError).Reason` with it. Add `Reason string \`json:"reason"\`` to the case structs.
- [ ] **Step 2: Run** `npm run check:langs`. Expected: FAIL (field missing).
- [ ] **Step 3: Implement.** Split `wellFormed` into the length gate (`ReasonTooLong`) and `utf8.ValidString` (`ReasonMalformed`). Then thread `Reason` through `check` in the order above, and through `IntScalar`/`NumberScalar` (out of bounds or non-finite → `ReasonOutOfRange`).
- [ ] **Step 4: Run** `npm run build && npm test && npm run check:langs`. Expected: PASS. CI runs `go test -race` and the Go 1.21 build.
- [ ] **Step 5: Plant a bug** (return `ReasonPattern` for a check failure). Confirm a case catches it, then revert.
- [ ] **Step 6: Commit** `feat(go): ScalarError carries the reason`.

### Task 4: Reasons in the Rust engine

**Files:**
- Modify: `dev/codegen/engine.rs`, `dev/codegen/rust.mjs`, `dev/langs/rust/src/main.rs`

**Interfaces:**
- Produces: emitted `#[derive(Debug, Clone, Copy, PartialEq, Eq)] pub enum Reason { WrongKind, … }` (a plain enum, not `non_exhaustive`) with `pub const fn as_str(self) -> &'static str`. `ScalarError { pub scalar: &'static Meta, pub reason: Reason }`, with `Display` unchanged. `Text::check(&self, s) -> Result<Cow<str>, Reason>`, and the same for `Int` and `Number`. Rust never produces `Malformed`. The models-side `check(kind, v: &Value) -> Result<Value, Reason>` gives `WrongKind` for a wrong JSON kind.

- [ ] **Step 1: Write the failing test.** In `main.rs`, compare `err.reason.as_str()` with the case's `reason` when the engine was called. Add `reason: Option<String>` to the case structs.
- [ ] **Step 2: Run** `npm run check:langs`. Expected: compile FAIL.
- [ ] **Step 3: Implement**, emitting the enum from `$meta.reasons` with `pascal` variant names.
- [ ] **Step 4: Run** `npm run build && npm test && npm run check:langs`. Expected: PASS.
- [ ] **Step 5: Plant a bug.** Confirm a case catches it, then revert.
- [ ] **Step 6: Commit** `feat(rust): ScalarError carries the reason`.

### Task 5: Models report the reason as the code

**Files:**
- Modify: `dev/lib/models.mjs`, `dev/codegen/models.{ts,py,go,rs}`, `dev/langs/cases.json` (`models`), `src/scalar.json` (`$defs.errors`: unchanged keys, but the README and the docs comment explain the rule), `README.md` (models error section)
- Test: `dev/test/models.test.mjs`

**Interfaces:**
- Consumes: the reason from each engine's internal check (Tasks 1–4).
- Produces: the code `invalid` no longer exists. A field failing its type reports `code = reason` and `params` including `type`. The message is the `$meta.errors` template when the code has one, else the type's `error`. A type-level `too_long` has `params { type, max }`, where `max` is the type's length limit in code points. **Every** problem on a type field carries `params.type`: also the field-setting codes `too_long`, `not_allowed` and `too_many_digits`.

- [ ] **Step 1: Write the failing tests** (shared cases, so all five implementations run them):
  - Rewrite every expected `"code": "invalid"` in `cases.json` `models.validate` to the reason the reference gives, with `params.type` and the type's `error` (or the template) as the message.
  - Add `type_too_long`: field `{"type":"char"}`, payload `"ab"` → `code "too_long"`, `params {"type":"char","max":1}`, message `"At most 1 characters."` (the template as it stands).
  - Add `setting_too_long`: field `{"type":"string","length":3}`, payload `"abcd"` → `too_long`, `params {"type":"string","max":3}`.
  - Add `wrong_kind_field`: an `int32` field given `"7"` → `wrong_kind`, with the type's error as the message.
  - Add `type_param_everywhere`: an existing `not_allowed` and an existing `too_many_digits` case gain `params.type`.
  - In `models.test.mjs`, `no problem has code invalid`: run every validate case and assert no `code === "invalid"`.
  - In `codegen.test.mjs`, extend Task 2's literal guard to `models.{ts,py,go,rs}`.
- [ ] **Step 2: Run** `npm test` and `npm run check:langs`. Expected: FAIL.
- [ ] **Step 3: Implement in the reference.** `problem()` uses the template when `$meta.errors` has the code, else the given message. Every type-field report passes `{ type: type.name, ... }`. The type-level `too_long` passes `max: modelOf(type).maxLen`. Remove the "a code without a template (`invalid`…)" comments.
- [ ] **Step 4: Implement in the four models engines,** reading the reason from the engine's check (Task 2's failure object, Go's `Reason`, Rust's `Err(Reason)`), with the same params and message rule.
- [ ] **Step 5: Run** `npm run build && npm test && npm run check:ts && npm run check:langs && npm run fuzz:models -- 1 200`, then `npm run fuzz:models -- 2 600`. Expected: PASS, no disagreements.
- [ ] **Step 6: Plant a bug:** drop `params.type` from Python's `not_allowed`. Confirm a case catches it, then revert.
- [ ] **Step 7: Update the README's models error section:** list the codes, the message rule, and say `params.type` is on every type-field problem.
- [ ] **Step 8: Commit** `feat(models): report the failure reason as the code`.

### Task 6: Closed code lists

**Files:**
- Modify: `src/scalar.json` (`enum` on `country`, `country_alpha3`, `currency`; `examples.list_invalid`; source and date in each `details` or a `$comment`), `schema/scalar.schema.json` (core `enum`: array of unique strings; `examples.list_invalid`), `schema/dist.schema.json` (`schema.enum`, `examples.list_invalid`)
- Modify: `dev/lib/resolve.mjs` (`enum` in `INHERITED` plus build checks), `dev/lib/derive.mjs` (`enum` in `SCHEMA_KEYS`; `pgCheck` ignores it), `dev/lib/reference.mjs` (`not_in_list`), `dev/codegen/model.mjs` (`list` in `modelOf` and `metaFields`)
- Modify: `dev/codegen/engine.{ts,py,go,rs}` and the four emitters (list per type)
- Modify: `src/targets/html.json` (`country`, `country_alpha3`, `currency` options)
- Modify: `dev/langs/check.{ts,py}`, `dev/langs/go/main.go`, `dev/langs/rust/src/main.rs`, `dev/langs/fuzz.mjs` (`list_invalid` examples are refused with `not_in_list`)
- Test: `dev/test/conformance.test.mjs`, `dev/test/resolve.test.mjs`, `dev/test/reasons.test.mjs`, `dev/test/codegen.test.mjs`

**Interfaces:**
- Consumes: `REASON` / `Reason` names (Tasks 2–4).
- Produces: dist `types.<t>.schema.enum: string[]` (sorted, unique) and `types.<t>.examples.list_invalid`. Model record `list: string[] | null`, written by `metaFields` as `["list", m.list]` when not null. Engines: TS `list?: ReadonlySet<string>` (built from the array in the `Scalar` constructor), Python `frozenset`, Go `list []string` used with `slices.BinarySearch`, Rust `list: &'static [&'static str]` with `binary_search` (a new last argument of `Text::new`). Membership runs after `check` and fails with `not_in_list`.

- [ ] **Step 1: Write the failing tests.**
  - `conformance.test.mjs`: `types with an enum have at least 2 list_invalid examples, other types none`. Per type, each `list_invalid` passes the HTML pattern, fails JSON Schema (ajv, which now sees `enum`), and gives the reference `{ ok: false, reason: "not_in_list" }`. Each `enum` value is `valid` for the reference, and unchanged by its normalize.
  - `resolve.test.mjs`: on a fixture, the build fails when an `enum` value doesn't match the pattern, isn't sorted, repeats a value, or is on a non-text type. A child with a different pattern that inherits a parent's `enum` fails through the first rule.
  - `reasons.test.mjs`: the Task 1 "every reason has a case" test now requires all eight. Add `{ "type": "country", "in": " xx ", "ok": false, "reason": "not_in_list" }` and `{ "type": "currency", "in": "HRK", "ok": false, "reason": "not_in_list" }` to `cases.json` `validate`, keeping the `ß` → `SS` case.
  - `shape.test.mjs`: `postgres CHECK for listed types is the pattern only`: `country`'s check equals `CHECK ({column} ~ '^[A-Z]{2}$')`.
  - `codegen.test.mjs`: the generated Go has no `map[` at package level for lists (the existing guard covers it; assert it still passes), and the Rust has the list as a `&[...]` literal.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Get the lists.** ISO 3166-1 alpha-2 and alpha-3 (249 each) come from Debian `iso-codes` (`data/iso_3166-1.json`, the latest tag). ISO 4217 active codes come from SIX's `list-one.xml` (unique `Ccy` values). Download each into its own new empty directory under the scratchpad. Extract with `node` (`JSON.parse` / a regex on `<Ccy>`), with the script kept outside the download directory. Write the sorted arrays into `src/scalar.json` with the file editor. Record the source, its version or tag, and the date in each type's `details`.
- [ ] **Step 4: Implement the source side:** `enum` in `INHERITED` and `SCHEMA_KEYS`, plus the resolve checks from Step 1. Give `country` `list_invalid` `["XX", "QQ"]`, `country_alpha3` `["XXX", "QQQ"]`, and `currency` `["QQQ", "HRK"]`. Confirm `HRK` is absent from List One; if it's present, use another withdrawn code.
- [ ] **Step 5: Implement the reference and engines:** `not_in_list` after `check`, in all five.
- [ ] **Step 6: Update the HTML targets.** `options.source` stays. Add `options.note: "The options are schema.enum."`. Set `options.js` to the labels only: `new Intl.DisplayNames([locale], { type: 'region' })` for `country`, the same for `country_alpha3` (labels from its alpha-2 sibling, said in the note), and `new Intl.DisplayNames([locale], { type: 'currency' })` for `currency`. Give `country_alpha3` the same `select` treatment.
- [ ] **Step 7: Update the runners** so `list_invalid` examples are refused with `not_in_list`, as they handle `check_invalid`.
- [ ] **Step 8: Run** `npm run build && npm test && npm run check:ts && npm run check:langs && npm run fuzz:models -- 1 200`. Expected: PASS.
- [ ] **Step 9: Plant a bug:** skip the list in the Go engine. Confirm `list_invalid` catches it, then revert.
- [ ] **Step 10: Commit** `feat: closed ISO code lists for country, country_alpha3 and currency`.

### Task 7: Release 0.6.0

**Files:**
- Modify: `src/scalar.json` (`version`), `dev/test/build.test.mjs` (the two version asserts), `CHANGELOG.md`, `README.md` (download links to `v0.6.0`, `.reason` in the method table, a line that the reasons and their order are listed in `$meta.reasons`), `docs/HANDOFF.md`

- [ ] **Step 1: Bump the version** to `0.6.0` and update the asserts. Run `npm run build && npm test`. Expected: the README-links test FAILS until Step 2.
- [ ] **Step 2: Update the README:** links to `v0.6.0`, `.reason` per language in the method table, and the list note under the type table.
- [ ] **Step 3: Write the `CHANGELOG.md` 0.6.0 entry, dated:** the reasons; models' `invalid` replaced by reason codes and `params.type` on every type-field problem; the lists narrowing `validate` (withdrawn and unassigned codes now fail); Postgres unchanged.
- [ ] **Step 4: Update `HANDOFF.md`.** Replace "the shape … is stable" with "no compatibility promise before 1.0". Add the reasons and lists bullets, and the rule "a list update is a patch release (0.6.x), shipped soon after ISO announces the change". Add the History entry, and remove this plan and the spec, as in earlier history entries.
- [ ] **Step 5: Run** everything: `npm run build && npm test && npm run check:ts && npm run check:langs && npm run fuzz:models -- 3 600`. Expected: PASS. `git status` shows only intended files, with no `__pycache__`.
- [ ] **Step 6: Commit** `release: 0.6.0`. Then, **after the owner approves**: push, wait for CI to pass on all three jobs, tag `v0.6.0`, and push the tag.
