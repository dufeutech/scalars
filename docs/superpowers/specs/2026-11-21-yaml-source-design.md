# Source as YAML

**Intent.** Make the source easier to edit: comments, patterns without doubled backslashes, short lists. Decided earlier (`docs/HANDOFF.md`, next steps) and approved by the owner on 2026-11-21.

## Goals

- `src/scalar.json` → `src/scalar.yaml`, `src/targets/{html,postgres}.json` → `.yaml`, and the test fixtures in `dev/test/fixtures/mini/` likewise. One loader reads them.
- `dist/` builds byte-identical. No release.
- The files read the same under YAML 1.1 and 1.2, so no tool turns `NO`, `on` or `1.0` into a boolean or number. A test pins it.

## Non-goals

- No split into several files. No comments added by the conversion. `dist/` and `schema/` stay JSON.

## Decided

- Parser: the `yaml` dev dependency, pinned exact (`2.9.1`), default YAML 1.2 core schema.
- Converted once with the `yaml` library's own stringifier (Document with `version: "1.1"`, so it quotes anything a 1.1 reader would mistype; `singleQuote: true`; width 120). Patterns forced single-quoted. String lists over 20 items in flow style, packed to the width. A round trip under 1.1 and 1.2 must equal the JSON, or the conversion fails. The script is throwaway (scratchpad).
- The `$schema` key stays as data, and each file gets a first-line `# yaml-language-server: $schema=...` comment for editors.
- The source JSON Schemas validate the parsed YAML.

## Approaches

- **Library stringify with options (picked):** the established tool does the escaping; the round-trip check proves it.
- `yq`/`yaml` CLI as-is: no per-key quoting or list packing, so patterns stay mixed and lists take 8,500 lines.
- Hand-written emitter: what the handoff ruled out.

## Left to the builder

- Wording of README and handoff updates (every `src/*.json` mention).
