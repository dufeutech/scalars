# Type Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove 14 types that add noise, keep one way per concept (no `idn_*`, no `iri*`), and release 0.7.0.

**Architecture:** Data removal in `src/`, then the tests that used those types as samples move to remaining types. With `sf_decimal` gone no number-kind type lists `precision`/`scale`, so the per-engine filter becomes a build rule instead.

**Tech Stack:** Node (build, tests), YAML 1.2 source, generated TS/Python/Go/Rust.

**Spec:** `docs/superpowers/specs/2026-11-21-type-cleanup-design.md`

## Global Constraints

- Removed: `sf_integer`, `sf_decimal`, `sf_string`, `sf_token`, `sf_binary`, `sf_boolean`, `http_date`, `media_range`, `relative_json_pointer`, `iri`, `iri_reference`, `idn_hostname`, `idn_email`, `double_int`.
- Never edit `dist/` by hand; `npm run build` (in `dev/`).
- `cd dev && npm test` and `npm run check:langs` pass after every task.
- Stage explicit paths; no `git commit -a`.

## Review Focus

- A user looking up a removed alias (`unicode_email`, `structured_integer`, `accept`, …) gets "unknown type", not a stale match: the aliases go with the types.
- An international email (`用户@例子.广告`) validates as `email` in all four languages: pinned by a new `valid` example.
- `precision` on `float64` in a models file is still `unknown_setting`: the shared case `precision_on_number` moves to `float64`.
- A future source type listing `precision` on a number primitive fails the build, not silently at runtime.
- Go patterns containing a backtick still emit as interpreted strings: tested on the helper directly.

---

### Task 1: Remove the 14 types

**Files:**
- Modify: `src/scalar.yaml` (the 14 entries; `$defs.docs` entries `rfc6531`, `rfc5890`, `rfc3987`, `rfc9110`, `rfc9651` and any other link left unused), `src/targets/html.yaml`, `src/targets/postgres.yaml`
- Modify: `dev/test/params.test.mjs:33-35`, `dev/test/linear.test.mjs:36` (`media_range` → `ulid`), `dev/test/helpers/pg.mjs:8` (drop the `sf_binary` line), `dev/langs/cases.json` (drop the long-input cases for removed types; `precision_on_number` uses `float64`), `dev/test/codegen.test.mjs:73-74`
- Modify: `dev/codegen/go.mjs:61` (export `pattern` as `goPattern`)

- [ ] Step 1: Delete the entries and dangling docs links; `npm run build` must not fail on an unused link check (if one exists) or a dangling reference.
- [ ] Step 2: Replace the `sf_token` assertion with `assert.equal(goPattern("^a`b$"), JSON.stringify("^a`b$"))` and `assert.equal(goPattern("^ab$"), "`^ab$`")`.
- [ ] Step 3: Fix the other test samples as listed. Run `npm test` and `npm run check:langs`: PASS.
- [ ] Step 4: Commit `refactor!: remove 14 types that add noise`.

### Task 2: Digit settings are a build rule

**Files:**
- Modify: `dev/lib/resolve.mjs:133` — refuse `precision`/`scale` on any type whose resolved primitive isn't text (message: `Type "<name>" is a number, so it can't take precision or scale`).
- Modify: `dev/lib/models.mjs` (drop `DIGIT_SETTINGS` and the filter at :94), `dev/codegen/models.{ts,py,go,rs}` (drop the filter), `dev/codegen/{ts,python}.mjs` (stop emitting `DIGIT_SETTINGS`), `dev/test/codegen.test.mjs:215-230` (drop the `DIGIT_SETTINGS` asserts).
- Test: `dev/test/build.test.mjs` (or wherever resolve's build errors are tested): a fixture type with `primitive` float64 listing `precision` throws that message.

- [ ] Step 1: Write the failing build test; run, see it fail.
- [ ] Step 2: Add the rule; run, see it pass.
- [ ] Step 3: Drop the filter in the reference and the four engines; plant a bug (Rust `allowed` ignoring `params`) and confirm a shared case catches it, then revert the plant.
- [ ] Step 4: `npm run build && npm test && npm run check:langs`: PASS. Commit `refactor: refuse digit settings on number types at build time`.

### Task 3: One way per concept, in the words

**Files:** `src/scalar.yaml` (`email`, `hostname`, `uri`, `uri_reference` details), `README.md` (line 193 example → `float64`; any removed type in tables or text).

- [ ] Step 1: `email` gains valid example `用户@例子.广告`; details say it accepts international (RFC 6531) addresses. `hostname` details: international names are stored as punycode (`xn--`). `uri`/`uri_reference`: international text is percent-encoded. No mention of removed types anywhere (`grep -rw` over src, README, dev/test).
- [ ] Step 2: Build, `npm test`, `npm run check:langs`: PASS. Commit `docs: one type per concept`.

### Task 4: Release 0.7.0

- [ ] Bump `version` in `src/scalar.yaml` and the two asserts in `dev/test/build.test.mjs`, move README links to `v0.7.0`, add a dated `0.7.0` changelog section listing each removed type and its replacement (`sf_*`/`http_date`/`media_range` → the plain type; `iri*` → `uri*`; `idn_hostname` → `hostname` with punycode; `idn_email` → `email`; `double_int` → `int64`; `relative_json_pointer` → `json_pointer`; digit settings now a build rule). Build, test, `npm run fuzz:models -- 1 600`. Commit `release: 0.7.0`.
- [ ] Update `docs/HANDOFF.md` (state, next steps: new identifier types dropped, history entry), delete this plan and the spec, commit `docs(handoff): 0.7.0`.
