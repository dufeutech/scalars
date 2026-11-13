# Code generation: one ready-to-use file per language

Status: approved 2026-11-12, including the amendments from the complexity audit (see
[Complexity audit](#complexity-audit)): the `email` pattern rewrite and the linear-pattern build check. Builds on
release 0.3.0.

## Intent

`dist/scalars.json` already describes every type, but anyone using it from code has to write their own reader, and the
handoff's "Rules that are easy to break" show how easy that is to get wrong (`fullmatch`, the trim set, Go case folding,
code-point lengths). This work turns `dist/scalars.json` into one source file per language that an app copies in and
uses directly, with the hard parts done once, correctly and fast.

Success looks like: a developer copies one file, types `scalars.` and the IDE lists every type with its label on hover;
`scalars.email.validate(" User@Example.com ")` returns the cleaned value or raises an error carrying the type's
friendly message.

## Goals

- **Python, TypeScript, Go, Rust**: one generated file each, committed in `dist/`.
- **Best-in-class autocomplete**: every type is a statically named member; nothing is created at runtime by name.
- **DRY**: logic is written once per language in a hand-written engine; the generator emits only data.
- **Very simple API**: a type object with a handful of members, the same in every language (modulo naming rules).
- **Linear time, guaranteed**: `validate` is O(n) in the length of the input, in all four languages, for every type,
  including hostile input. Everything else is O(1) or O(length of its argument). The full table is in
  [Complexity guarantees](#complexity-guarantees).

## Non-goals (wait until needed)

- Published packages (PyPI, npm, crates.io, Go module proxy). Copy-in files only; packages can wrap them later.
- "Checked value" types per scalar (`NewType`, branded types, newtypes).
- Field `params` (`length`, `precision`, `scale`, `fractional_seconds`, `values`). `enum` therefore accepts any text.
- Checking the JSON Schema `format` keyword (unchanged from today: rules come from `pattern` and lengths only).
- HTML and Postgres data in the generated code (those blocks serve other tools).
- Plain-JavaScript output (`.js` + `.d.ts`); TypeScript only.
- New length caps on types (for example `email` ≤ 254). They would change which values are accepted, and the linear
  guarantee does not need them.

## Anti-goals

- A file that is slow to import, or compiles 88 regexes at startup.
- Dynamic access (`types["email"]`, `__getattr__`) as the main way in: it kills autocomplete.
- A second copy of a rule anywhere: patterns, messages and steps come only from `dist/scalars.json`.
- Different behaviour between languages for the same input.
- Any input, however long or hostile, that makes `validate` take more than time proportional to its length.

## Approaches considered

**How people get the code**

1. **Copy-in file per language in `dist/`** (picked). Keeps the "nothing to install" spirit, versioned with the JSON,
   tested the same way as `dist/`. Cost: users re-copy to update.
2. **Published packages.** Easiest install, but four registries and four release flows. Deferred; can wrap approach 1.
3. **Runtime loader** (a small library that reads `scalars.json` at startup). Least generated code, but no
   autocomplete, which is the point of the work. Rejected.

**API shape**: type first, then the tool (`scalars.email.validate`), not flat helpers (`scalars.validate_email`): flat
helpers put ~440 names in one popup and add 88 names per new tool.

**How linear time is guaranteed in Python and TypeScript** (their regex engines backtrack; Go's and Rust's do not)

1. **Prove every pattern linear at build time, and rewrite the ones that are not** (picked). Fixes the cause, keeps
   zero dependencies, changes no accepted value, and protects every future type.
2. **Cap the length of every type.** Bounds the damage but changes accepted values, and types like `text` or
   `json_pointer` have no natural cap.
3. **Use a linear-time regex library** (`google-re2`, the `re2` addon). Adds a native dependency to the two languages
   that have none. Rejected.

## The API

Each type is one instance of a single engine class/struct. Members (Python spelling; other languages follow their
naming rules):

| Member | Meaning |
|---|---|
| `name`, `label`, `hint`, `error`, `level`, `primitive`, `aliases`, `examples` | Copied from dist. |
| `normalize(s)` | Apply the type's `normalize` steps, in order. Only meaningful for text types; identity otherwise. |
| `validate(v)` | Normalize (text), then check kind, length, pattern, min/max. Returns the cleaned value, or fails with `error`. Text that is not well-formed Unicode fails first (see below). |
| `is_valid(v)` | `True` exactly when `validate(v)` would succeed. Never builds an error. |

Module level: `get(word)` implements `$meta.lookup` (name, then alias) and returns the type or nothing; `all` is a
fixed sequence of every type; the type-name set is exposed as a static type (`Literal[...]` / string union) so
`get("mail")` also autocompletes.

Docs on hover come from `label`, `hint` and `details`, emitted as each language's doc comment on the member.

### Per language

| | Declared as | Call | Fails with |
|---|---|---|---|
| Python ≥ 3.10 | module-level `email: Final[Scalar[str]] = Scalar(...)` + attribute docstring | `scalars.email.validate(s)` | `ScalarError(ValueError)` with `.scalar` |
| TypeScript | one exported object `scalars` (`as const`), also the default export | `scalars.email.validate(s)` | `ScalarError extends Error` with `.scalar` |
| Go ≥ 1.21 | package-level `var Email = &Scalar[string]{...}` | `scalars.Email.Validate(s)` → `(string, error)` | `*ScalarError` |
| Rust ≥ 1.80 | `pub static EMAIL: Scalar<str>` (or equivalent) | `scalars::EMAIL.validate(s)` → `Result<Cow<str>, ScalarError>`, borrowed when nothing changed | `ScalarError` |

TypeScript uses one object because `enum`, `any`, `string`, `boolean`, `object` are type names in dist and `enum` is a
reserved word: it can't be an exported `const`, but `scalars.enum` is a valid property.

### Native value per primitive

The engine is generic over the value, so `validate` returns the right native type:

| dist `schema.type` | Python | TypeScript | Go | Rust |
|---|---|---|---|---|
| `string` (incl. `int64`, `decimal`, dates: text in JSON) | `str` | `string` | `string` | `Cow<str>` |
| `integer` | `int` (not `bool`) | `number` (`Number.isInteger`) | `int64` | `i64` |
| `number` | `float` (finite) | `number` (finite) | `float64` | `f64` |
| `boolean` | `bool` | `boolean` | `bool` | `bool` |
| `object` / `array` / none (`any`) | `dict` / `list` / `object` | `Record<string, unknown>` / `unknown[]` / `unknown` | `map[string]any` / `[]any` / `any` | metadata only: no `validate` (avoids a JSON crate) |

In Python and TypeScript `validate` also checks the value's kind, since callers may pass anything. In Go and Rust the
compiler does that.

### Text must be well-formed Unicode

A text value is valid only if it is a sequence of Unicode scalar values: the WHATWG `USVString` and RFC 7493 (I-JSON)
rule. Anything else fails `validate` with the type's normal `error`, and `is_valid` is false; `normalize` does not
check. It is one linear pass that allocates nothing on valid text, except in Python, which encodes non-ASCII text once
(CPython has no cheaper check without a regex).

Order in the text check: trim → over-length gate → well-formed check → `remove_*` steps → length gate → case steps →
full length check → pattern.

- **After trim.** Trim strips only listed white space, never part of a malformed unit, and cannot bring two halves of
  a pair together, so trimming first gives the same result. Text that is too long is then refused from its length
  alone (Python `len(s)`, TypeScript `ceil(length / 2)`, Go `len(s) / 4`), before the check reads it. This early gate
  is skipped for types with `remove_*` steps, since those can shorten the text.
- **Before `remove_*`.** Removing a space or `-` could join two stray halves into valid text in TypeScript
  (`"\ud83d \ude00"`) and Go (`"\xc3 \xa9"`), but not in Python, whose `str` keeps two lone surrogates. Checking
  first keeps every language the same.
- **Before case steps,** so case mapping never sees malformed text.

| Language | Malformed text it can hold | Check |
|---|---|---|
| Python | lone surrogates (U+D800–U+DFFF) | `str.isascii()` (O(1)), else strict `s.encode("utf-8")` |
| TypeScript | lone surrogates | `String.prototype.isWellFormed()` (ES2024); where it is missing (Node < 20, Safari < 16.4), a char-code loop |
| Go | bytes that are not UTF-8 | `utf8.ValidString` (skips ASCII eight bytes at a time) |
| Rust | none: `&str` is always valid UTF-8 | nothing to check |

### Naming rules

- Python, TypeScript: the dist name as is (`scalars.uuid_v7`, `scalars.any`).
- Go: PascalCase of the snake name, no initialism rules (`UuidV7`, `Ipv4Cidr`, `Iban`). Simple and predictable.
- Rust: SCREAMING_SNAKE (`UUID_V7`).
- The generator fails the build if two types map to the same identifier, or a name is reserved in the target.

## Complexity guarantees

n = length of the input, w = length of a looked-up word, T = number of types (88). These are worst-case bounds and
hold for hostile input.

| Operation | Time | Extra memory | What makes it hold |
|---|---|---|---|
| Loading the file | Go, Rust: O(1), no startup code. Python, TypeScript: O(T) small records | O(T) | The table is plain data. No regex is compiled and no map is built at load. |
| `scalars.email` | O(1) | none | A named member, never a search. |
| `normalize(s)` | O(n) | none when nothing changes, else one copy per step that changes the text | No regex in any step. |
| `validate(s)`, text | O(n) | same as `normalize` | Every pattern is proven linear by the build; lengths are checked before the pattern. The well-formed check is one linear pass (Python's copies non-ASCII text once). |
| `validate(s)`, text longer than the type can ever be | O(1) once trimmed; O(n) for types with `remove_*` steps | none, or one copy per `remove_*` step that changes the text | The longest possible value is known per type. A type with no `remove_*` step refuses it right after trimming, from the length alone, before the well-formed check reads it. Otherwise the gate runs after any `remove_*` steps (which can shorten text), immediately before the first case step, and always again before the pattern. A type with `remove_*` steps scans the text once before the gate. |
| `validate(v)`, number or boolean | O(1) | none | |
| `is_valid(v)` | same as `validate` | none, even on failure | Shares one internal check with `validate`; never raises and catches. |
| `get(word)` | O(w) expected | at most one short key | One hash lookup in a map built once on first use; never a scan over the types. |
| `all` | O(1) | none | A fixed sequence, not rebuilt per call. |
| First use of a type | one regex compile, once | the compiled regex, kept | Cached on the type; later calls only read it. |

O(n) is the best possible for `validate`: deciding whether text is valid requires reading it.

## Complexity audit

Measured on 2026-11-12 with throwaway scripts (Python 3.14, Node 24) that pump repeated chunks into every valid example
of all 50 patterns and time the result at growing sizes.

1. **The `email` pattern is quadratic in Python and JavaScript.** `^C+@C+\.C+$` (C = any character except `@` and
   whitespace, so C includes the dot) can split the domain at every dot. On `a@` + dots + `@`, doubling the input
   quadruples the time: 16,000 characters take 2.0 s in Python, 32,000 take 0.9 s in Node. Go and Rust are unaffected:
   their engines do not backtrack.
2. **A regex-based trim is quadratic in Python and JavaScript.** `^[ws]+|[ws]+$`, the form today's Python and
   TypeScript runners use, retries from every position of an inner run of spaces. `x` + 16,000 spaces + `x` takes
   1.7 s in Python; 32,000 spaces take 0.9 s in Node. A plain scan from both ends takes under a microsecond.
3. **The other 49 patterns grow linearly** in both engines at up to 512,000 characters.

Smaller gaps in the first version of this design, all fixed below: Go lazy regexes via `sync.OnceValue` would have run
88 function calls at program start; code points were counted by building an array of the whole string; `is_valid` could
have been built on raise-and-catch; case mapping ran before any length check; lookup always built a cleaned key.

## Changes to the source data and the build

### `email` pattern rewrite

In `src/scalar.json`, with D = C without the dot:

- today: `^C+@C+\.C+$`
- new: `^C+@CD*\.C+$`

Both accept exactly the same values: a domain of three or more C characters with a dot that is neither first nor last.
The new form names one split point (the first such dot) instead of leaving the engine to try them all. Checked on all
349,525 strings of up to 9 characters over the four kinds of character the pattern can tell apart (dot, `@`,
whitespace, other): 0 differences. The rewrite takes 0.9 ms on 512,000 characters in Node.

It also regenerates the Postgres CHECK. (No HTML `pattern` attribute is generated for `email`: its input is
`type="email"`.) Gets a CHANGELOG entry as a fix: the string changes, the accepted values do not.

### New build check: every pattern is provably linear

Next to `dev/lib/portable.mjs`. The build fails, naming the type, unless a pattern has a bounded number of ways to
match any input prefix. In automaton terms: no nested repeat that yields the same step twice, no exponential ambiguity
(EDA) and no polynomial ambiguity (IDA) in the pattern's position automaton. This is decidable for the portable subset
because it has no backreferences or lookaround.

The position automaton keeps edge multiplicities (each distinct way a transition arises), so a nested repeat that
yields the same step twice, like `^(a+)+$`, is caught as exponential ambiguity.

- Fixtures that must fail: `^(a+)+$`, `^(a|a)*$`, `^(a|aa)+$`, `^a*a*$`, and today's `email` pattern.
- Fixtures that must pass: every pattern in dist after the `email` rewrite, including the ambiguous-but-bounded ones
  (`base64`, `hostname`, `duration`, `semver`, `media_range`).
- Large counted repeats (`{0,61}`) may be widened to `*` for the proof: that can only add ways to match, so a pass
  stays sound.

The small parser this needs also yields each pattern's shortest and longest possible match, which the generator uses
for the length gate below.

## Engine requirements

These replace the efficiency list from the first version.

**Loading**

- No regex compiled and no lookup map built at load. Steps are resolved once, when each record is built (at import in
  Python and TypeScript, at compile time in Go and Rust), never per call.
- Go: the table is static data. No function calls and no closures in package-level initializers; the lazy regex is a
  zero-value `sync.Once` plus a pointer inside the struct, not `sync.OnceValue`; steps are a slice of small constants.
- Rust: `static` items with `OnceLock`/`LazyLock` fields, which the language guarantees are built at compile time.
- Python: `__slots__` records; `from __future__ import annotations` so annotations cost nothing at import; the engine
  must not rely on builtins that type names shadow at module level (`object`, `any`).

**Normalize**

- Trim is never a regex. Python `str.strip(WS)` with the full character set; TypeScript a char-code scan from both
  ends; Go `strings.Trim`/`TrimFunc`; Rust `trim_matches`.
- No allocation when a step changes nothing: trim returns the input (or a slice of it), and case steps take an ASCII
  fast path (all-ASCII text is case-mapped byte-wise, identical to the full mapping).
- Go: a `golang.org/x/text/cases` `Caser` is not safe to share between goroutines; use the ASCII fast path, and a
  `sync.Pool` (or a per-call caser) for non-ASCII text.

**Lengths**

- Each text type carries a shortest and longest length in code points: the tighter of `schema.minLength`/`maxLength`
  and what its pattern can match. They are derived by the generator, never stored in source, and never change a result.
- The gate runs before every case step and before the pattern. Case mapping never lowers the code-point count, so text
  that is already too long after trimming is rejected without being copied.
- Counting is O(1) in the common case. Use the cheap length first (UTF-16 units in TypeScript, bytes in Go and Rust):
  code points are at most that, and at least half (UTF-16) or a quarter (UTF-8) of it. Only when that leaves the answer
  open, count without allocating and stop as soon as the limit is passed. Python's `len` is already code points.

**Pattern**

- Compiled at most once per type, on first use, and cached on the type.
- Python `fullmatch`; TypeScript the `u` flag and never `g` or `y` (they carry state between calls); Go `MatchString`;
  Rust `is_match`.

**Results and errors**

- `validate` and `is_valid` share one internal check that returns a plain yes/no. Only `validate` turns a no into an
  error; `is_valid` never constructs one.
- Rust returns `Cow<str>` so clean input is validated with zero allocation. Go returns a substring of the input when
  only trimming applied.

**Lookup**

- `get` tries the word exactly as given first, since an exact name is the common case and needs no cleanup. Only on a
  miss does it build the cleaned key, in one pass, and look again.
- One map holds every name and alias, built once on first `get`. TypeScript uses a `Map`: a plain object would also
  answer for inherited members such as `constructor`.

## Dependencies

- Python, TypeScript: none.
- Go: `golang.org/x/text` (case steps). Rust: `regex`. Both stated in the file header with the tested version.

## Layout and build

- Engines, hand-written and lintable: `dev/codegen/engine.py`, `engine.ts`, `engine.go`, `engine.rs`.
- Generator: `dev/codegen/generate.mjs`, run by `npm run build`. It writes engine + generated table into one file:
  `dist/python/scalars.py`, `dist/ts/scalars.ts`, `dist/go/scalars.go`, `dist/rust/scalars.rs`, each with a
  "generated, do not edit" header carrying the version.
- The linear-pattern check lives in `dev/lib/` beside `portable.mjs` and runs in the same place.
- The existing stale-dist test covers the new files.
- Generated TypeScript uses erasable syntax only (no `enum`, no parameter properties), so Node runs it directly.
- README: "Which file do I use?" gains a row per language; the JSON stays the source of truth.

## Testing

- **Runners become consumers of the generated code**: `dev/langs/check.{py,ts}`, `go/`, `rust/` import the generated
  file instead of re-implementing normalize/lookup/match, and keep checking every dist example plus `cases.json`. This
  removes today's four duplicate readers, and with them the quadratic trim.
- New cases in `cases.json` for: `validate` returning the normalized value, the error message, non-text kinds
  (integer bounds, `bool` not accepted as integer in Python, non-finite numbers), and `get` by alias.
- **Hostile cases** in `cases.json`, written as a recipe (prefix, repeated chunk, count, suffix) so the file stays
  small: the `email` and trim inputs from the audit and a long value for each unbounded type, at 200,000 characters.
  Every runner must return the expected answer within 2 seconds. Linear code needs under 0.1 s; quadratic code needs
  minutes, so the margin is wide enough not to flake.
- The linear-pattern check has its own test with the fixtures listed above.
- The derived lengths are tested against every dist example, and by checking that the pattern itself rejects text one
  character longer than the derived maximum.
- A test that importing each file compiles no regex. For Go, `GODEBUG=inittrace=1` shows no allocations for the
  package.
- A small benchmark script per language in `dev/` (not a pass/fail gate) to confirm the fast paths.

## Left to the builder

- Exact engine internals per language within the requirements above.
- The algorithm for the linear-pattern check (product-automaton tests for EDA and IDA are the standard route), and
  the size at which a counted repeat is widened.
- How the Go runner references the generated package (copy at test time, or a `replace` in `go.mod`).
- Header wording, ordering of members in the generated table (suggest dist order: alphabetical).
