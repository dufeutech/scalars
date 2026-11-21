# Source as YAML Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The source files are YAML; `dist/` is unchanged byte for byte.

**Architecture:** `loadSources` in `dev/lib/resolve.mjs` parses YAML instead of JSON; every other reader of `src/*.json` goes through one exported `readSource(path)`. The files are converted once by a scratchpad script on the `yaml` library.

**Tech Stack:** Node ≥22, `yaml` 2.9.1 (dev, exact).

**Spec:** `docs/superpowers/specs/2026-11-21-yaml-source-design.md`

## Global Constraints

- `npm run build` must leave `git status -- dist` clean.
- No backslash edits through the shell: conversion is a node script reading and writing files.
- Each task ends green: `npm run build && npm test && npm run check:ts && npm run check:langs` from `dev/`.

## Review Focus

1. **1.1-ambiguous scalars** (`NO`, `on`, `y`, `'0'`, `'-42'`, `'true'`): read as strings by 1.1 and 1.2. Task 1's test.
2. **Patterns with backslashes** (`decimal`, `duration`): the built `dist` is byte-identical, which proves them.
3. **Stale `src/*.json` mentions** in README, handoff, comments and schema descriptions: `grep -rn "scalar\.json\|targets/.*\.json"` outside `dist/` and git history is empty after Task 1, except `dist/scalars.json`.

---

### Task 1: YAML source

**Files:**
- Modify: `dev/lib/resolve.mjs` (`readSource`, `loadSources`), `dev/lib/reference.mjs:80`, `dev/test/build.test.mjs:72`, `dev/test/source.test.mjs:56-58`, `dev/test/resolve.test.mjs:132-140`, `README.md:349`, `docs/HANDOFF.md`, `dev/package.json` (done: `yaml` 2.9.1)
- Replace: `src/scalar.json`, `src/targets/*.json`, `dev/test/fixtures/mini/**/*.json` with `.yaml`
- Test: `dev/test/source.test.mjs`

**Interfaces:**
- Produces: `export function readSource(p: string): any` in `resolve.mjs` (YAML 1.2 parse of a file); `loadSources(dir)` reads `scalar.yaml` and `targets/<t>.yaml`.

- [ ] **Step 1: Write the failing test** in `source.test.mjs`: `"source YAML reads the same under YAML 1.1 and 1.2"`: for each of `src/scalar.yaml`, `src/targets/html.yaml`, `src/targets/postgres.yaml`, `assert.deepEqual(YAML.parse(text, { version: "1.1" }), YAML.parse(text))`. Point the schema-validation test (lines 56-58) at the `.yaml` files through `readSource`.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL (files missing).
- [ ] **Step 3: Convert** the six files with the scratchpad script, `git rm` the JSON, add the modeline comment, and switch the readers to `readSource`.
- [ ] **Step 4: Run** `npm run build && npm test && npm run check:ts && npm run check:langs`, then `git status -- ../dist`. Expected: PASS, dist clean.
- [ ] **Step 5: Plant a bug:** unquote `'NO'` in `country`'s enum. Expected: the new test fails (1.1 reads `false`). Revert.
- [ ] **Step 6: Update** README (editing types), handoff (every `src/*.json` mention, the "Source edits" rule, the next-steps entry marked done, a History entry; remove this plan and spec). Commit `refactor: source files are YAML`, then `docs(handoff)` separately.
