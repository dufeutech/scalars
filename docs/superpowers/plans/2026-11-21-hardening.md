# Hardening plan (no new features), after 0.5.0

Five tasks, one commit each, pushed to `main` at the end. No release. Read `docs/HANDOFF.md` first ("Rules that are easy
to break" especially): edits containing a backslash go through the file editor, never a shell heredoc; never import
`dist/python/scalars.py` in place; run `cd dev && npm test && npm run check:langs` before each commit and stop on any
failure. Every commit ends with the `Co-Authored-By` line from the system prompt. When all five are done, update
`docs/HANDOFF.md` (CI section, tests count, remove this plan from the tree) in its own `docs(handoff)` commit, push,
and watch CI (`gh run watch <id> --exit-status`).

## 1. Test that README download links match the version

- In `dev/test/build.test.mjs`, add a test: read `README.md`, collect every
  `raw.githubusercontent.com/dufeutech/scalars/<ref>/` with a regex, assert there is at least one and every `<ref>`
  equals `v` + `src/scalar.json` `version` (today `v0.5.0`).
- Plant a bug (edit one link) to see it fail, then restore.
- Commit: `test: README download links use the current version tag`.

## 2. `tsc --strict` in CI

- Add `typescript` (exact 5.x version, `npm install -D -E typescript@5`) to `dev/package.json`; commit the lock change.
- Add script `"check:ts": "tsc --strict --noEmit --target es2022 --module nodenext --moduleResolution nodenext ../dist/ts/scalars.ts"`.
  It passed by hand on 2026-11-21 with exactly these flags.
- Add `- run: npm run check:ts` to the `test` job in `.github/workflows/test.yml`, after `npm test`.
- Commit: `ci: type-check dist/ts/scalars.ts with tsc --strict`.

## 3. Go 1.21 minimum in CI

- `dist/go/go.mod` says `go 1.21`, but CI only runs Go 1.26 (the runner's `dev/langs/go/go.mod`). Add a job
  `go-minimum` to `.github/workflows/test.yml`: checkout, `actions/setup-go@v5` with `go-version: "1.21"`, then
  copy `dist/go` to `$RUNNER_TEMP/scalars`, `go mod tidy` there (dist has no go.sum), `GOTOOLCHAIN=local go vet ./...`
  and `go build ./...`. Don't write into `dist/`.
- Before pushing, grep `dev/codegen/engine.go` and `models.go` for post-1.21 features (range over int `for i := range n`
  is 1.22, range-over-func 1.23). If any, either rewrite them or raise the stated minimum in `go.mjs` (header and
  `go.mod`), and say which in the commit.
- Push this commit alone first and watch CI, since it can't be checked locally.
- Commit: `ci: build the generated Go package on Go 1.21, its stated minimum`.

## 4. Drop dev-only pointer comments from the generated files

- The hand-written engines carry pointer comments that read oddly in `dist`, next to the emitted value:
  `models.ts`/`models.py` ("... are emitted after this file, from dev/lib/models.mjs."), `models.go` and `models.rs`
  (same phrase). Add one helper in `dev/codegen/common.mjs` (or inside `readEngine`) that removes every whole line
  containing `emitted after this file`, and use it for all four engines.
- Add a codegen test: no generated file contains `emitted after this file`; the hand-written engines still do.
- `npm run build`, check the dist diff only removes those lines.
- Commit: `build: keep the engines' dev-only pointer comments out of dist`.

## 5. Random differential test for models

Goal: random models files and payloads through the reference (`dev/lib/models.mjs`: `loadModels`, `validateModel`)
and all four runners, so engines that disagree with the reference fail. Reuse the runners as they are: each takes
`<dist> <cases>` arguments (see `dev/langs/run.mjs`), and `cases.json` has `models.load`
(`{name, data, ok, all | problems}`) and `models.validate` (`{name, load, model, in, ok, out | problems}`).

- New dev script `dev/langs/fuzz.mjs`, run as `npm run fuzz:models -- [seed] [count]` (add the script to
  `dev/package.json`). It uses a seeded PRNG (e.g. mulberry32) and writes a cases file to the OS temp dir: a copy of
  `dev/langs/cases.json` with `models.load` and `models.validate` replaced by generated cases (keep `models.hostile`
  and every other section, since the runners check them too). Expected `ok`/`all`/`problems`/`out` come from the
  reference. Then it runs the same runner list as `run.mjs` (factor the list into a shared export rather than copying
  it) with that cases path, prints the seed, and exits non-zero on any failure.
- Generator: 1–3 domains, 1–4 models each, 1–5 fields each. Field = a type name or alias from `dist/scalars.json`, a
  model name (same or other domain), a `domain:model.field` reference, or an object with `type` plus random settings
  (`length`, `values`, `precision`/`scale`, `nullable`, `items` on `array`). About 1 in 5 files has a deliberate
  mistake (bad name, unknown type, cycle, out-of-range or wrong-kind setting, a 64-byte enum value). Payloads per
  loaded model: valid values from each type's `examples.valid`, plus mutations (wrong kind, invalid example, missing
  key, extra key, null on non-nullable, nested arrays/models).
- Avoid known non-bugs: no lone surrogates (Go/Rust runners can't carry them), and for number-kind fields use
  non-integral values like `1.5` (Python prints `3.0` for `3`; see HANDOFF). Keep nesting shallow; depth limits have
  shared cases already.
- Run it for several seeds and a few thousand cases. Each real disagreement: reduce it, add it as a named shared case
  in `cases.json`, fix the engine, and note it in the commit. If none, say so in the commit with seeds and counts.
- Not in CI by default (slow); mention it in HANDOFF under Tests. Optionally a quick fixed-seed run in CI if it takes
  under ~30 s.
- Commit: `test: random differential test of models against the reference`.
