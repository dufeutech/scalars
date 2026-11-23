# Model Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Models files can declare entities (with an implicit `id`), values (`"$value": true`, embedded) and links between entities (`{ "type": "link", "to": … }`, with `many` and `one`), checked the same way by the reference and all four language engines, released as 0.9.0.

**Architecture:** The behaviour is defined first in the reference loader `dev/lib/models.mjs` and pinned by shared cases in `dev/langs/cases.json` (`models.load`, `models.validate`, `models.hostile`). Each hand-written engine, `dev/codegen/models.{ts,py,go,rs}`, then copies it until its runner passes `npm run check:langs`. The four keyword names live once in the reference and are emitted into every generated file. Links are not edges of the nesting graph: a link value is an id.

**Tech Stack:** Node 22 (`node --test`, ajv), Python ≥ 3.10, TypeScript, Go ≥ 1.21, Rust ≥ 1.80 (`regex`, `serde_json`).

**Spec:** `docs/superpowers/specs/2026-11-22-model-links-design.md`. Read it first: every rule, code, template and "call" in it applies, and this plan argues from it. Background: `docs/superpowers/specs/2026-11-20-models-design.md` (models as they are) and `docs/HANDOFF.md` ("Rules that are easy to break").

## Global Constraints

- Work on a branch `model-links` off `main`. Commit after each task with the attribution lines from the session. Don't push or tag until the owner says so (Task 8).
- New load codes and templates, exactly: `reserved` → `This name is reserved.`; `not_value` → `Only a value model can be embedded; link to an entity instead.`; `not_entity` → `A link must point at an entity.`; `conflicting_setting` (params `setting`) → `Can't be used with "{setting}".`; `misplaced` → `Not allowed here.`. New payload code: `duplicate` (params `type`) → `Listed twice.`. They go in `src/scalar.yaml` `$defs.errors` (→ `$meta.errors`); engines never spell a template.
- Keyword constants, defined once in `dev/lib/models.mjs` and emitted (Task 2): `ID_FIELD = "id"`, `ID_TYPE = "uuid_v7"`, `LINK_KEYWORD = "link"`, `VALUE_KEY = "$value"`. Emitted names: TS and Rust `ID_FIELD`, `ID_TYPE`, `LINK_KEYWORD`, `VALUE_KEY`; Python the same with a leading `_`; Go `idField`, `idType`, `linkKeyword`, `valueKey`. Hand-written engines never write these strings.
- Load stays O(file) and iterative (no recursion driven by the input); validate stays O(payload). The repeat check in a `many` list is one hash set per list.
- Never edit `dist/` by hand: `cd dev && npm run build`. A file holding a backslash goes through the file editor, not a shell heredoc.
- Don't import `dist/python/scalars.py` in place (run with `-B` or copy it).
- Before each commit: `cd dev && npm test` passes. From Task 3 on, `npm run check:langs` passes for every engine done so far (the runners for engines not yet ported fail on the new cases; that's expected until Task 6).

## Review Focus

1. **Repeats compared after normalize:** `[" 018F4B2C-9C1E-7A3B-8F2D-1A2B3C4D5E6F", "018f4b2c-9c1e-7a3b-8f2d-1a2b3c4d5e6f"]` in a `many` link is one `duplicate` at `/tags/1`, and two *invalid* equal entries are two reason problems and no `duplicate`. Cases `many_dup_after_normalize`, `many_bad_twice` (Task 1).
2. **The string shorthand `"l": "link"`** now that `link` is no alias: `missing_setting` with `setting: "to"`, never `alias` or `unresolved`. Case `link_shorthand_without_to` (Task 1).
3. **A bad `$value` doesn't cascade:** `{"$value": false}` on `addr`, embedded by one field and linked by another, reports only `/app/addr/$value`. Case `value_flag_false` (Task 1).
4. **A conflict made by a copy:** `{ "type": "a.l", "one": true }` where `a.l` has `many: true` is `conflicting_setting` at `/…/one` with `setting: "many"`; the mirror case at `/…/many` with `setting: "one"`. Cases `copied_link_conflict_one`, `copied_link_conflict_many` (Task 1).
5. **A link value that isn't text** (a number, `true`, an object) is `wrong_kind` with `params.type: "uuid_v7"` in all four, including Go and Rust, whose scalar `validate` is typed. Case `link_wrong_kind` (Task 1).

---

### Task 1: The reference, the shared cases, the templates and the schema

**Files:**
- Modify: `dev/lib/models.mjs` (loader and validator)
- Modify: `src/scalar.yaml` (`$defs.errors`: the six templates; `uri` loses alias `link`)
- Modify: `dev/langs/cases.json` (`models.load`, `models.validate`, `models.hostile`)
- Modify: `schema/models.schema.json`
- Modify: `dev/test/models.test.mjs`, `dev/test/human.test.mjs`
- Modify: `README.md` type table row for `uri` (aliases `url`, `website`); `CHANGELOG.md` (new `## Unreleased` heading at the top)

**Interfaces:**
- Produces (exports of `dev/lib/models.mjs`): `ID_FIELD`, `ID_TYPE`, `LINK_KEYWORD`, `VALUE_KEY` (strings above), next to `MAX_DEPTH`, `NAME`, `REF`.
- Produces (resolved field shapes, seen by tests through `models.get(name).fields`): a link is `{ kind: "link", to: "<domain>:<model>", many: boolean, one: boolean, nullable: boolean }`. An entity's `fields` Map starts with `[ID_FIELD, { kind: "type", type: ID_TYPE, settings: {}, nullable: true }]`; a value model's has no `id`.
- Produces: the shared cases named below, which Tasks 3 to 6 must pass unchanged.

- [ ] **Step 1: Drop the alias and guard it.** In `src/scalar.yaml`, remove `- link` from `uri`'s aliases. In `dev/test/human.test.mjs`, test `aliases are well formed and unique` also pushes a problem when an alias equals `LINK_KEYWORD` (import it from `../lib/models.mjs`). Update the README row. Add `## Unreleased` to `CHANGELOG.md` with a `### Removed` line: `link` is no longer an alias of `uri` (`scalars.get("link")` finds nothing; use `url` or `uri`).

- [ ] **Step 2: Write the shared cases.** First, every existing `models.load` case whose models are embedded (by a model reference, `items`, or a copy of either) gains `"$value": true` on those models (`ok_spec_example`'s `billing:address` and `shop:line_item`, `model_cycle`, `items_cycle`, every `m*` in `too_deep`, `copied_ref_home_domain`, and so on); the expected results stay as they are. Every existing `models.validate` case whose model is an entity gets `"id": null` first in its `out`. Then add these `models.load` cases (each with the full `problems`, messages from the templates; pointer and code shown here):

  | Name | Data (shape) | Expect |
  |---|---|---|
  | `ok_links` | the spec's example file, verbatim | ok; `all` = `auth:profile, auth:user, shop:address, shop:category, shop:line_item, shop:order, shop:product, shop:review, shop:tag` |
  | `ok_link_loop` | `x:a` links `y:b`, `y:b` links `x:a`, plus `x:a.self` links `a` | ok |
  | `ok_many_one_false` | a link with `many: true, one: false` | ok |
  | `reserved_id` | an entity with a field `id` | `/app/user/id` `reserved` |
  | `reserved_id_in_value` | a value with a field `id` | `/app/addr/id` `reserved` |
  | `reserved_link_model` | a model named `link` | `/app/link` `reserved` |
  | `value_flag_false` | `addr` has `"$value": false`; `o.a` embeds it, `o.l` links to it | only `/app/addr/$value` `bad_setting` |
  | `embeds_entity` | `order.owner: "user"`, `user` an entity | `/app/order/owner` `not_value` |
  | `embeds_entity_items` | `order.owners: {type: array, items: "user"}` | `/app/order/owners/items` `not_value` |
  | `embeds_entity_copied` | `a.x: "user"`, `b.y: "a.x"` | only `/app/a/x` `not_value` |
  | `field_ref_to_id` | `o.x: "user.id"` | `/app/o/x` `unresolved` |
  | `link_to_value` | `to` a value model | `/app/o/l/to` `not_entity` |
  | `link_to_type` | `to: "email"` | `/app/o/l/to` `not_entity` |
  | `link_to_field` | `to: "user.email"` | `/app/o/l/to` `not_entity` |
  | `link_unresolved` | `to: "nope"`, and a second field `to: "other:user"` | both `/…/to` `unresolved` |
  | `link_to_not_string` | `to: 3` | `/app/o/l/to` `bad_setting` |
  | `link_without_to` | `{type: "link"}` | `/app/o/l` `missing_setting` `{setting: "to"}` |
  | `link_shorthand_without_to` | `"l": "link"` | `/app/o/l` `missing_setting` `{setting: "to"}` |
  | `link_flag_not_boolean` | `many: "yes"`, and a second field `one: 1` | `/…/many`, `/…/one` `bad_setting` |
  | `link_one_and_many` | `many: true, one: true` | `/app/o/l/one` `conflicting_setting` `{setting: "many"}` |
  | `copied_link_conflict_one` | `a.l` has `many: true`; `b.m: {type: "a.l", one: true}` | `/app/b/m/one` `conflicting_setting` `{setting: "many"}` |
  | `copied_link_conflict_many` | `a.k` has `one: true`; `b.m: {type: "a.k", many: true}` | `/app/b/m/many` `conflicting_setting` `{setting: "one"}` |
  | `link_unknown_setting` | a link with `length: 3` | `/app/o/l/length` `unknown_setting` |
  | `link_in_items` | `{type: array, items: {type: link, to: user}}`, and a second field `items: "link"` | both `/…/items` `misplaced`, nothing else |
  | `link_copied_into_items` | `items: "a.l"` where `a.l` is a link | `/app/b/x/items` `misplaced` |

  And these `models.validate` cases, all on `ok_links` (`U1` = `018f4b2c-9c1e-7a3b-8f2d-1a2b3c4d5e6f`, `U2` = `018f4b2c-9c1e-7a3b-8f2d-1a2b3c4d5e70`). Every `shop:order` payload carries a valid `customer`, `ship_to` and `items: []` besides what's listed, and every `shop:review` one the fields it doesn't name, so each case fails only where shown:

  | Name | Model, payload | Expect |
  |---|---|---|
  | `entity_id_missing` | `shop:tag`, `{name: "x"}` | out `{id: null, name: "x"}` |
  | `entity_id_null` | `shop:tag`, `{id: null, name: "x"}` | out `{id: null, name: "x"}` |
  | `entity_id_normalized` | `shop:tag`, `{id: " 018F4B2C-9C1E-7A3B-8F2D-1A2B3C4D5E6F ", …}` | out id `U1` |
  | `entity_id_bad` | `shop:tag`, id `f81d4fae-7dec-11d0-a765-00a0c91e6bf6` | `/id` `pattern` `{type: "uuid_v7"}`, the `uuid_v7` error text |
  | `value_has_no_id` | `shop:address`, with an `id` | `/id` `unknown_field` |
  | `link_ok` | `shop:review`, `{product: U1, author: U2, stars: 5}` | ok, `id: null` first |
  | `link_bad` | `shop:review`, `author: "nope"` | `/author` `pattern` `{type: "uuid_v7"}` |
  | `link_required` | `shop:review` without `author` | `/author` `required` |
  | `link_wrong_kind` | `shop:review`, `author: 3`; `product: true` | `/author`, `/product` `wrong_kind` `{type: "uuid_v7"}` |
  | `link_nullable` | `shop:category`, `parent: null` | ok |
  | `many_ok` | `shop:order`, `tags: [U1, U2]` (and a valid `customer`, `ship_to`, `items: []`) | ok |
  | `many_empty` | `tags: []` | ok |
  | `many_not_list` | `tags: "x"` | `/tags` `not_list` |
  | `many_null_entry` | `tags: [null]` | `/tags/0` `required` |
  | `many_dup_after_normalize` | `tags: [" 018F…6F", U1]` (the upper-case `U1` with spaces) | `/tags/1` `duplicate` `{type: "uuid_v7"}` |
  | `many_bad_twice` | `tags: ["nope", "nope"]` | `/tags/0`, `/tags/1` `pattern`; no `duplicate` |
  | `link_inside_value` | `shop:order`, `items: [{product: "nope", qty: 1}]` | `/items/0/product` `pattern` |

  And one `models.hostile` case: `{"kind": "wide_many", "load": "ok_links", "model": "shop:order", "count": 50000, "ok": true}`. Its payload, built by each runner: `customer` `U1`, `ship_to` a valid address, `items: []`, `tags` the `count` ids `018f4b2c-9c1e-7a3b-8f2d-` + `i` as 12 lower-case hex digits.

- [ ] **Step 3: Write the failing tests** in `dev/test/models.test.mjs`. The existing `load cases` / `validate cases` loops pick up Step 2. Add:
  - `test("links and ids resolve to their shapes")`: on `ok_links`, `shop:order` fields' keys in order are `["id", "customer", "ship_to", "items", "tags"]`; `fields.get("id")` deep-equals the `id` shape above; `fields.get("customer")` deep-equals `{ kind: "link", to: "auth:user", many: false, one: false, nullable: false }`; `tags` has `many: true`; `auth:profile`'s `user` has `one: true`; `shop:address` has no `id`.
  - `test("a copied link keeps its home-domain target")`: `{ a: { user: {}, o: { l: { type: "link", to: "user" } } }, b: { user: {}, p: { m: "a:o.l" } } }` loads, and `b:p`'s `m.to` is `"a:user"`.
  - `test("a 50,000-id many list validates in linear time")`: build the `wide_many` payload at 50,000 and 100,000; both are `ok`, and the second takes under 3× the first (best of three runs each, so a slow first run doesn't flake it).
  - Update `schema setting keys are the $meta.params keys plus items` to `plus items, to, many and one`.
  - In `schema refuses bad names and unknown settings`: the schema refuses `"$value": false` and a `$note` key on a model, and accepts every `ok_*` case (the existing loop).

- [ ] **Step 4: Run to see them fail.** Run: `cd dev && node --test test/models.test.mjs test/human.test.mjs`. Expected: FAIL on the new load and validate cases (`ok_links` reports `unresolved` for `link`) and the new tests.

- [ ] **Step 5: Implement in `dev/lib/models.mjs`.** `loadModels(data, scalars)` and `validateModel(model, payload)` keep their signatures. The spec's Links and Entities sections are the rules; the plan pins where they sit:
  - **Pass 1 (names):** inside a model, the key `VALUE_KEY` is read before the `NAME` test: `true` makes the model a value; anything else is `bad_setting` at `[d, m, "$value"]` and the model becomes *both kinds* (embedding it and linking to it report nothing). A model named `LINK_KEYWORD` and a field named `ID_FIELD` are `reserved` (checked after `NAME` and before `type_name`).
  - **Pass 2 (`parse`):** a written reference exactly `LINK_KEYWORD` (no domain, no field) sets `def.ref = { kind: "link" }`, checked before types.
  - **Pass 3 (Tarjan):** a `link` ref has no edges, like a `type` ref; `takesItems` is false for it.
  - **`resolve`:** the base for a `link` ref is `{ kind: "link", to: null, many: false, one: false, nullable: false }`; a field copy of a link uses the target's field as today. Allowed settings on a link are `to`, `many`, `one` (plus `nullable`). In order: (a) a def under `items` (`v.up`) whose base is a link reports `misplaced` at its own path and nothing else; (b) each written key: `to` must be a string (else `bad_setting`), matching `REF` (else `unresolved`), without a field part (else `not_entity`, whether or not that field exists: the plan's call), naming a model in `domain ?? v.domain` (a bare type name is `not_entity`, anything else missing is `unresolved`) that isn't a value (else `not_entity`); store the full name. `many`/`one` must be booleans (`bad_setting`). (c) No `to` written or inherited: `missing_setting` `{setting: "to"}`. (d) Both `true` after overrides: `conflicting_setting` on the written `one` with `setting: "many"`, else on the written `many` with `setting: "one"`. A base of kind `model` (a direct model reference, field or `items`) whose model is an entity reports `not_value` at the def's path; copies of a failed def fail silently, as today.
  - **Depth:** a link has `leaf = null`, `arrays = 0`.
  - **Building the result:** an entity's fields Map gets the `id` entry first.
  - **`run`:** a `link` field without `many` is checked exactly as a `{ kind: "type", type: ID_TYPE, settings: {} }` field. With `many`: not an array is `not_list`; each entry is a leaf (no push onto `pending`): `null` is `required` at its index, otherwise the `ID_TYPE` scalar's `validate` (reason problems with `params.type`); a valid entry whose cleaned value is already in this list's `Set` is `duplicate` with `{type: ID_TYPE}`. The output list holds the cleaned ids.

- [ ] **Step 6: Update `schema/models.schema.json`.** A model's `propertyNames` is `name` or the const `$value`, with `properties: { "$value": { "const": true } }`. A field object gains `to` (the `reference` def), `many` and `one` (booleans).

- [ ] **Step 7: Add the templates and rebuild.** The six entries in `src/scalar.yaml` `$defs.errors` (exact text in Global Constraints); `cd dev && npm run build`.

- [ ] **Step 8: Run the tests.** Run: `cd dev && npm test`. Expected: PASS (all of it, including the stale-dist and schema tests).

- [ ] **Step 9: Plant a bug, see a case catch it, remove it.** For example, skip the `Set` lookup: `many_dup_after_normalize` must fail. Then restore.

- [ ] **Step 10: Commit.**

```bash
git add src/scalar.yaml dist dev/lib/models.mjs dev/langs/cases.json schema/models.schema.json dev/test README.md CHANGELOG.md
git commit -m "feat(models): entities, values and links in the reference, with shared cases"
```

### Task 2: Emit the keyword constants into every generated file

**Files:**
- Modify: `dev/codegen/ts.mjs`, `python.mjs`, `go.mjs`, `rust.mjs` (emit next to `MAX_DEPTH`; add the names to each emitter's reserved-name list where `MAX_DEPTH` is)
- Test: `dev/test/codegen.test.mjs` (`models constants are emitted once, from the reference`)

**Interfaces:**
- Consumes: the four exports from Task 1.
- Produces: in `dist/ts/scalars.ts` `const ID_FIELD = "id";` (and the other three, same style); `dist/python/scalars.py` `_ID_FIELD: Final = "id"`; `dist/go/scalars.go` `const idField = "id"` (in the `const` style `maxDepth` uses); `dist/rust/scalars.rs` `const ID_FIELD: &str = "id";`. Tasks 3 to 6 use these names.

- [ ] **Step 1: Extend the test.** `has(file, …)` checks each emitted line above for all four names in all four files. The hand-written engines (`dev/codegen/models.{ts,py,go,rs}`) contain none of `"uuid_v7"`, `"$value"`, `"link"` as a string literal (in Python also with single quotes), and no `"id"` literal.

- [ ] **Step 2: Run to see it fail.** Run: `cd dev && node --test test/codegen.test.mjs`. Expected: FAIL, the constants aren't emitted.

- [ ] **Step 3: Emit them** from the imported values (never a literal in the emitter), then `npm run build`.

- [ ] **Step 4: Run.** Run: `cd dev && npm test && npm run check:ts`. Expected: PASS. Constants no engine uses yet are fine: `tsc --strict` and Go both accept unused top-level constants; Rust warns, so mark them `#[allow(dead_code)]` until Task 6 uses them, then remove the attribute there.

- [ ] **Step 5: Commit** (`feat(codegen): emit the models keyword constants`).

### Task 3: TypeScript engine

**Files:**
- Modify: `dev/codegen/models.ts`
- Modify: `dev/langs/check.ts` (`HOSTILE.wide_many`)

**Interfaces:**
- Consumes: `ID_FIELD`, `ID_TYPE`, `LINK_KEYWORD`, `VALUE_KEY` (Task 2); the shared cases (Task 1).
- Produces: no public API change. `ModelField.kind` widens to `"type" | "model" | "array" | "link"`; a link field carries `to: string`, `many: boolean`, `one: boolean`; `Ref` gains `{ kind: "link" }`.

- [ ] **Step 1: Add the `wide_many` builder** to `HOSTILE` in `dev/langs/check.ts`, as Task 1 Step 2 describes it.
- [ ] **Step 2: Run to see it fail.** Run: `cd dev && npm run build && npm run check:langs`. Expected: the TypeScript runner fails on the new load, validate and hostile cases (other new-case failures in Python, Go and Rust are expected until their tasks).
- [ ] **Step 3: Port Task 1 Step 5 into `Loader` and `Model`**, in the same passes and the same order of checks as the reference.
- [ ] **Step 4: Run.** Run: `cd dev && npm run build && npm run check:ts && npm run check:langs`. Expected: the TypeScript runner passes everything; `npm test` passes.
- [ ] **Step 5: Plant a bug** (e.g. report `conflicting_setting` on `many` always), see a shared case fail, restore.
- [ ] **Step 6: Commit** (`feat(models): links in TypeScript`).

### Task 4: Python engine

**Files:** Modify `dev/codegen/models.py`; `dev/langs/check.py` (`wide_many`).

**Interfaces:** Consumes `_ID_FIELD`, `_ID_TYPE`, `_LINK_KEYWORD`, `_VALUE_KEY`. `_Field` gains kind `"link"` with `to`, `many`, `one`. No public API change.

- [ ] **Step 1: Add `wide_many`** to the Python runner's hostile builders.
- [ ] **Step 2: Run to see it fail:** `cd dev && npm run build && npm run check:langs`. Expected: Python fails on the new cases.
- [ ] **Step 3: Port** Task 1 Step 5 into `_Loader` and `_Run`. The repeat check is a `set` per list.
- [ ] **Step 4: Run:** `cd dev && npm run build && npm run check:langs`. Expected: TypeScript and Python pass; `npm test` passes. Also the runner on Python 3.10 if available (CI's `minimums` job covers it otherwise).
- [ ] **Step 5: Plant a bug** (e.g. leave `id` out of an entity), see a case fail, restore.
- [ ] **Step 6: Commit** (`feat(models): links in Python`).

### Task 5: Go engine

**Files:** Modify `dev/codegen/models.go`; `dev/langs/go/main.go` (`wide_many`).

**Interfaces:** Consumes `idField`, `idType`, `linkKeyword`, `valueKey`. `fieldKind` gains `fkLink` (in the style of the existing constants); `field` gains `to string`, `many`, `one bool`; `refKind` gains a link kind. No public API change.

- [ ] **Step 1: Add `wide_many`** to the Go runner's hostile builders.
- [ ] **Step 2: Run to see it fail:** `cd dev && npm run build && npm run check:langs`. Expected: Go fails on the new cases.
- [ ] **Step 3: Port** Task 1 Step 5. The repeat check is a `map[string]struct{}` per list, sized to the list. A link value that isn't a `string` is `wrong_kind` with `params.type` `idType`, as other type fields already do.
- [ ] **Step 4: Run:** `cd dev && npm run build && npm run check:langs && gofmt -l ../dist/go ../dev/codegen ../dev/langs/go`. Expected: TS, Python and Go pass; `gofmt -l` prints nothing; `npm test` passes.
- [ ] **Step 5: Plant a bug** (e.g. count a link as a nesting level), see a case fail, restore.
- [ ] **Step 6: Commit** (`feat(models): links in Go`).

### Task 6: Rust engine

**Files:** Modify `dev/codegen/models.rs`; `dev/langs/rust/src/main.rs` (`wide_many`).

**Interfaces:** Consumes `ID_FIELD`, `ID_TYPE`, `LINK_KEYWORD`, `VALUE_KEY`. `FieldKind` gains `Link { to: String, many: bool, one: bool }`. No public API change.

- [ ] **Step 1: Add `wide_many`** to the Rust runner's hostile builders.
- [ ] **Step 2: Run to see it fail:** `cd dev && npm run build && npm run check:langs`. Expected: Rust fails on the new cases.
- [ ] **Step 3: Port** Task 1 Step 5. The repeat check is a `HashSet<String>` per list, with capacity the list's length.
- [ ] **Step 4: Run:** `cd dev && npm run build && npm run check:langs`. Expected: all five runners pass; `npm test` passes. Also on Rust 1.80 if installed (CI's `minimums` job covers it otherwise).
- [ ] **Step 5: Plant a bug** (e.g. let `$value: false` mark a value), see a case fail, restore.
- [ ] **Step 6: Commit** (`feat(models): links in Rust`).

### Task 7: The random models test learns links

**Files:** Modify `dev/langs/fuzz.mjs`.

**Interfaces:** Consumes `loadModels`, `validateModel` and the four runners as today.

- [ ] **Step 1: Generate the new shapes.** Drop `"id"` from `NAMES`. Each generated model is a value with chance 0.5 (`"$value": true`). Embedding (`field()` picking a model, directly or as `items`) picks only value models; a new link field (chance about 0.15) picks any entity, its own model included, written `{ type: "link", to }` with `many: true` or `one: true` sometimes. `mistake()` sometimes adds one of: an embedded entity, a link to a value, `many` and `one` both true, a field named `id`. Payloads: a link value is a valid uuid v7 (upper-case or space-padded sometimes), or a mistake (a v4 uuid, a number); a `many` value is a list of 0 to 4 such ids, sometimes with a repeat; an entity payload sometimes carries `id`.
- [ ] **Step 2: Run** `cd dev && npm run fuzz:models -- 1 600`, then seeds 2 and 3. Expected: no disagreement, and the printed share of files that load is not below what seed 1 gave before this change (check it on `main` first). Any disagreement becomes a named shared case in `cases.json`, fixed in the engine at fault.
- [ ] **Step 3: Commit** (`test(fuzz): generate entities, values and links`).

### Task 8: Docs and the 0.9.0 release

**Files:**
- Modify: `README.md` (models section), `CHANGELOG.md`, `src/scalar.yaml` (`version`), `dev/test/build.test.mjs` (the two version asserts), `docs/HANDOFF.md`
- Delete: `docs/superpowers/specs/2026-11-22-model-links-design.md`, `docs/superpowers/plans/2026-11-22-model-links.md`, and the stale `docs/superpowers/specs/2026-11-20-models-design.md` and `docs/superpowers/plans/2026-11-20-models.md` (the handoff already says they live in git history)

- [ ] **Step 1: README models section.** Every model in the example that is embedded gains `"$value": true`, and the example gets one link (`"customer": { "type": "link", "to": "auth:user" }` with an `auth:user` model) and one `many`. Add a short "Entities, values and links" part: an entity has an implicit `id` (`uuid_v7`, may be missing or `null`), a value has `"$value": true` and is the only kind that can be embedded, the link settings table from the spec, the rule that only the side holding the id declares a link, and that `validate` checks a link's id shape, never that the record exists. Mention the DDD grounding in one sentence. Add `duplicate` to the payload codes table and `reserved`, `not_value`, `not_entity`, `conflicting_setting`, `misplaced` to the file codes sentence. The cleaned-payload sentence says an entity's missing `id` comes back as `null`. Check every quick start and payload in the README that uses models still matches (run each against the built dist if it changed).
- [ ] **Step 2: Changelog.** Under `## Unreleased` → `## 0.9.0 — <date>`: `### Added` (entities, values, links, `many`, `one`, the implicit `id`, the new codes), `### Changed (breaking)` (embedded models need `"$value": true`; a field named `id` and a model named `link` are refused; entity payload results gain `id`), `### Removed` (the `link` alias, from Task 1).
- [ ] **Step 3: Version.** `version: 0.9.0` in `src/scalar.yaml`, the two asserts in `dev/test/build.test.mjs`, the README download links to `v0.9.0`, then `cd dev && npm run build`.
- [ ] **Step 4: Verify everything.** Run: `cd dev && npm test && npm run check:ts && npm run check:langs && npm run fuzz:models -- 1 200`. Expected: all pass. `git status` shows no stray `__pycache__`.
- [ ] **Step 5: Commit** (`release: 0.9.0, entities, values and links`).
- [ ] **Step 6: Handoff.** In `docs/HANDOFF.md`: a 0.9.0 bullet at the top of "Where things stand" (what links are, the DDD rule, the calls from the spec's "Calls made without the owner" list, that `link` left `uri`'s aliases); remove "Left, if wanted: models emitting `CREATE TABLE`" from Postgres follow-ups and record that the owner decided on 2026-11-22 that storage stays out of scalars; add the new constants to "Models constants live once"; add a History entry (built from this plan, the bugs planted per task). Delete the four spec and plan files listed above in the same commit, and say in the History entry that they're in git history. Commit as `docs(handoff): 0.9.0, entities, values and links`.
- [ ] **Step 7: Hand back to the owner** for the merge to `main`, the push, and the `v0.9.0` tag once CI passes. Don't push or tag without their go-ahead.
