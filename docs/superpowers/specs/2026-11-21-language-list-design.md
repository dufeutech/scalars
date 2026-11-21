# Closed language list (0.6.2)

**Intent.** `language` accepts any 2 or 3 small letters today (`xx`, `zzz` pass). Close it to the industry standard, as 0.6.0 did for `country` and `currency`. The owner asked for the standard, kept modern.

**Standard.** BCP 47, whose language codes live in the IANA Language Subtag Registry (`https://www.iana.org/assignments/language-subtag-registry/language-subtag-registry`). HTML `lang`, HTTP `Accept-Language`, CLDR and `Intl` all use it. The registry has one code per language: the ISO 639-1 2-letter code where one exists, else the 639-3 or 639-5 3-letter code.

## Goals

- `language` accepts exactly the registry's current `Type: language` subtags: not `Deprecated`, not `Scope: private-use` (`qaa..qtz`). About 8,040 codes (file 2026-11-18). Specials `mis`, `mul`, `und`, `zxx` and the 639-5 collections stay in.
- Same in all four languages, JSON Schema/OpenAPI and HTML, using the existing `enum` machinery.

## Non-goals

- `locale` (`en-US`) is unchanged; checking its language part is a separate change.
- No script, region or variant lists.
- No mapping from deprecated or 3-letter forms to the preferred code (`iw` → `he`, `fra` → `fr`): they fail.

## Constraints

- Every rule in `docs/HANDOFF.md` for enums: text only, sorted, no repeats, matches the pattern, unchanged by normalize, at least 2 `list_invalid` examples.
- No packed encoding: Go has no package-level init code.
- `validate` stays O(n); the list check is a `Set`/`frozenset`/binary search as for `country`.

## Approaches

- **Reuse `enum` (picked).** The list is the type's core `enum`. Zero new machinery; costs about 50 KB per dist file.
- Packed string split at load: saves about 24 KB but needs init code in Go. Dropped.
- Shape-only check: not a closed list, so not what was asked. Dropped.

## Decided

- `standard` becomes "BCP 47 (IANA Language Subtag Registry)"; `docs` follows if a key for it exists or is added. `details` names the registry and its `File-Date`.
- HTML stays a `select` (options from `enum`, labels from `Intl.DisplayNames`), as for `country`: the only control that enforces the list.
- `list_invalid` includes `xx` and `fra`; `iw` too if useful.
- Release 0.6.2, changelog under `### Changed`: `validate` accepts less.
- A list update is a patch release, as for the ISO lists.

## Left to the builder

- How the list is extracted (a script in the scratchpad, not committed, as for 0.6.0), and the exact example values.
- Whether the pattern stays `^[a-z]{2,3}$` (it fits every code; keep it unless the build disagrees).
