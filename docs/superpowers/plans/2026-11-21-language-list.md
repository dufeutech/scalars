# Closed language list Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `language` accepts only current BCP 47 language subtags from the IANA Language Subtag Registry. Ships as 0.6.2.

**Architecture:** Data only. The list goes into `src/scalar.json` as `language.enum`, and the existing 0.6.0 enum machinery (build checks, `schema.enum`, the four engines, HTML `select`) does the rest. No engine or codegen changes.

**Tech Stack:** Node build (`dev/`), JSON source.

**Spec:** `docs/superpowers/specs/2026-11-21-language-list-design.md`

## Global Constraints

- The list is exactly the registry's `Type: language` records with no `Deprecated:` field and no `Scope: private-use` (the range `qaa..qtz`). Sorted, no repeats, every code matches `^[a-z]{2,3}$`.
- Download the registry into the scratchpad. The extraction script lives in the scratchpad too, not in the repo (as for 0.6.0). Run it with `node`, passing the file path as an argument.
- Never edit `dist/` by hand: run `npm run build` from `dev/`.
- Each task ends green: `npm run build && npm test && npm run check:ts && npm run check:langs` from `dev/`.

## Review Focus

1. **Deprecated and 3-letter forms fail.** `iw` (deprecated for `he`) and `fra` (BCP 47 uses `fr`) give `not_in_list`. Task 1 puts both in `list_invalid`.
2. **Specials and collections stay.** `mul`, `und`, `zxx`, `sgn` and `haw` pass. Task 1 puts `mul` and `cmn` in `valid`.
3. **Normalize.** `language` inherits trim from its base; an `enum` value must be unchanged by normalize (the build checks this).
4. **Size.** Each dist file grows about 50 KB. The hostile timings stay under 2 s (`check:langs` prints them).

---

### Task 1: The language list

**Files:**
- Modify: `src/scalar.json` (`language`: `enum`, `examples`, `standard`, `docs`, `details`; `$defs` docs links: replace `iso639`), `src/targets/html.json` (`language.options`), `dev/test/conformance.test.mjs:43`, `README.md` (the list paragraph, line ~279)

- [ ] **Step 1: Write the failing test.** In `conformance.test.mjs:43`, the expected enum types become `["country", "country_alpha3", "currency", "language"]`.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL on that assert only.
- [ ] **Step 3: Add the list.** Extract the codes from the registry (header `File-Date`) and write them as `language.enum`. Set:
  - `examples`: `valid` `["en", "haw", "mul", "cmn"]`, `invalid` unchanged, `list_invalid` `["xx", "fra", "iw"]`.
  - `standard`: `"BCP 47 (IANA Language Subtag Registry)"`.
  - `docs`: a new `$defs` docs key `iana_language` → `https://www.iana.org/assignments/language-subtag-registry/language-subtag-registry`, replacing `iso639` (used only by `language`).
  - `details`: `"A BCP 47 language code (en): tagging what language content is in, with the 2-letter code where one exists. Prefer locale when region or script variants matter. The list: current language subtags (not deprecated, not private-use) from the IANA Language Subtag Registry, File-Date <date>, copied 2026-11-21."`
  - `html.json` `language.options`: `source` `"IANA Language Subtag Registry"`, `note` `"The options are schema.enum."`, `js` `"new Intl.DisplayNames([locale], { type: 'language' }).of(code)"`.
  - README: the paragraph naming the closed lists adds `language` (BCP 47, from the IANA registry), with `fra` and `iw` as examples that fail.
- [ ] **Step 4: Run** `npm run build && npm test && npm run check:ts && npm run check:langs`. Expected: PASS, every hostile timing under 2 s.
- [ ] **Step 5: Plant a bug:** drop `fra` from `list_invalid` and add it to `enum` (sorted). Confirm the build or a test fails, then revert.
- [ ] **Step 6: Commit** `feat: closed BCP 47 list for language`.

### Task 2: Release 0.6.2

**Files:**
- Modify: `src/scalar.json` (`version`), `dev/test/build.test.mjs` (the two version asserts), `README.md` (links to `v0.6.2`), `CHANGELOG.md`, `docs/HANDOFF.md`

- [ ] **Step 1: Bump** the version to `0.6.2`, its two asserts and the README links. Run `npm run build && npm test`. Expected: PASS.
- [ ] **Step 2: Add the `CHANGELOG.md` 0.6.2 entry, dated,** under `### Changed`: `language` accepts only current BCP 47 language subtags (about 8,040, from the IANA registry); `xx`, 3-letter forms of 2-letter languages (`fra`) and deprecated codes (`iw`) fail with `not_in_list`. Each dist file grows by about 50 KB. Postgres unchanged.
- [ ] **Step 3: Update `HANDOFF.md`:** the status line goes to 0.6.2, "Closed lists" adds `language` and its source, the `language` follow-up under next steps is marked done, and a History entry. Remove this plan and the spec, as with earlier entries.
- [ ] **Step 4: Run** everything plus `npm run fuzz:models -- 1 200`. Expected: PASS. Commit `release: 0.6.2`, then `docs(handoff)` separately. Push and tag only after the owner approves.
