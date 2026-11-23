# AGENTS.md

Instructions for coding agents working on scalars. [README.md](README.md) explains what the project is and how it's used.
[docs/HANDOFF.md](docs/HANDOFF.md) holds the current state, the full list of easy-to-break rules, and the history. Read
it before changing anything.

## What this is

One definition per data type (`src/*.yaml`) built into `dist/`: `scalars.json`, JSON Schema/OpenAPI, HTML form
attributes, and generated code for five languages (Go, Python, Rust, TypeScript, Postgres). Each language has the same
`validate` / `is_valid` / `normalize` per type and the same models engine (domains → models → fields, entities, values
and links). All languages must give the same answer for every input.

## Layout

- `src/`: what you edit (YAML 1.2). `scalar.yaml` is the core; `targets/html.yaml` and `targets/postgres.yaml` the targets.
- `dist/`: generated. **Never edit it by hand.** Change `src/` or `dev/codegen/`, then `npm run build`.
- `dev/codegen/`: the generators. `engine.{py,ts,go,rs,sql}` are the hand-written runtimes they embed.
- `dev/lib/`: the build and the JavaScript reference (`reference.mjs` for types, `models.mjs` for models). The
  reference defines the behaviour; the engines follow it.
- `dev/langs/`: one runner per language and the shared `cases.json`; `go/` also has hand-written Go tests.
- `dev/test/`: `node --test` suites. `schema/`: JSON Schemas for the source and dist files.
- `dev/gui/`: a no-dependency fields explorer over `dist/scalars.json` (`go run .` from `dev/gui/`, then
  http://localhost:8080).
- `coding/`: the owner's gitignored scratch folder. Leave it alone.

## Commands

All from `dev/` (Node 22+; `check:langs` also needs Python 3, Go and Cargo):

```sh
npm install
npm run build              # rewrites dist/
npm test                   # also fails if the committed dist/ is stale
npm run check:ts           # tsc --strict on dist/ts/scalars.ts
npm run check:langs        # every language runner on the shared cases, then go test
npm run fuzz:models -- 1 200   # random models through all engines; [seed] [count]
```

Run `npm test`, `check:ts` and `check:langs` before every push, and stop on a failure. CI
(`.github/workflows/test.yml`) runs the same plus gofmt, `go test -race`, and the oldest Python, Rust and Go the
headers promise.

## How to change things

- **Behaviour goes into the reference first, with a shared case in `dev/langs/cases.json`,** then into every engine.
  When you change an engine, plant a bug and check that a shared case catches it, then remove it.
- **Patterns must be provably linear and use the portable subset** (no `\d \s \w`, no `.`, no lookaround). The build
  enforces both. `validate` is O(n) worst case in every language; keep it that way.
- **Examples:** a type with a rule needs at least 2 `invalid` examples; a `check` needs at least 2 `check_invalid`; an
  `enum` needs at least 2 `list_invalid`. More rules like these are in HANDOFF's "Rules that are easy to break".
- **YAML:** patterns in single quotes, quote anything YAML 1.1 would mistype (`'NO'`, `'0'`).
- **Don't import `dist/python/scalars.py` in place** (it leaves a `__pycache__` that fails a test). Use `python -B`.
- **Windows dev machine:** no C compiler, so `go test -race` runs only in CI. The Bash tool collapses `\\` to `\`; use
  the Edit tool or a script file for backslashes.

## Design

- Ground each design call in established practice and name it; domain-driven design comes first for models.
- DRY code, a simple API where everything is reachable as `pkg.<thing>`, and the best worst-case big-O (back claims with
  analysis or a measurement).
- No backward compatibility to keep: pick the cleanest shape, breaking changes are fine. Still bump the version and
  write a changelog entry per release.
- Wait on things nobody needs yet. Make implementation calls yourself and state them.
- Storage (tables, migrations, indexes) stays out of scalars.

## Commits and docs

- Conventional commits: `feat(models): ...`, `fix(postgres): ...`, `test(langs): ...`, `docs(handoff): ...`,
  `release: 0.9.0, ...`. Stage explicit paths.
- If the owner has uncommitted edits, commit them separately from yours, never mixed in.
- After every big event (a release, a merged feature, a CI break and its fix, a finished review), update
  `docs/HANDOFF.md` and commit it as its own `docs(handoff)` commit, without asking.
- A release: bump `version` in `src/scalar.yaml` and the two asserts in `dev/test/build.test.mjs`, `npm run build`, date
  the changelog's "Unreleased" heading, move the README links to the new tag, push, and tag once CI passes.
