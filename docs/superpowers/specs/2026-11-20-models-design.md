# Models: field settings, domains and references

Status: approved by the owner on 2026-11-20. Date: 2026-11-20. Reviewed once by a builder; their questions are answered below.

## Why

Today every type checks one value on its own (`scalars.email.validate(v)`). Real input is a form or a request body: several fields, some with settings (`enum` needs its values, `string` its max length), some nested (an order with an address and a list of items). Users end up writing that layer themselves, differently in each language, which defeats the point of the library: the same rules everywhere.

Models add that layer, declared once as **data** (parsed JSON) and checked the same way in Go, Python, Rust and TypeScript.

## Goals

- One models file, loaded the same way in all four languages, checks a whole payload and reports every bad field by path.
- Field settings (`length`, `values`, `precision`, `scale`, `nullable`) are finally enforced. Today `dist/scalars.json` lists them under `params`, but no language's `validate` reads them.
- **One way to do each thing.** The code looks nearly identical across the four languages, so the README can explain it once.
- Models are data, never code. Nothing is generated from a user's models.
- Validation stays O(n) in the size of the input, worst case.

## Non-goals (deferred on purpose)

- Generating HTML forms, Postgres tables or OpenAPI objects from models. The file shape allows it later.
- A `relationships` section (foreign keys between stored records). That's a storage concern; checking a payload never needs it. It can be added later as a new key without changing anything here.
- Models that contain themselves, directly or through others (comment threads, trees).
- Array length limits (`min_items`, `max_items`), cross-field rules ("end after start"), defaults.
- Shipping translations. Codes and the `$meta.errors` table make them possible; the library ships English only.
- Field documentation and mappings to outside standards (a `description`, or "this is GS1 `netContent`"). These would be new optional keys on a field object, so they're additive.
- A version key for models files. Users version their own files; if one is ever needed it's another `$` key next to `$schema`, so it's additive.
- Quantities (a value plus a UCUM unit). Models make them possible as a two-field model once a unit type exists; that type is separate work.

## Anti-goal added after review

- **No built-in canonical models** (`product`, `invoice`, `address`, …). They're large, industry-specific, and every user would want them different. The library ships types and the model mechanism, and users build their own entities. An example models file in the README shows the pattern.

## Anti-goals

- Two ways to do something: a code API *and* a data API for settings, dot access in some languages but not others, two file shapes.
- Any input that makes validation slower than linear, or recursion depth driven by the input rather than by the models.

## Approaches considered

1. **Models as data, loaded at runtime in all four languages (picked).** One file shape, one API shape. Keeps "download one file, nothing to install" (except Rust; see below).
2. **Generate code from the user's models** (`models.signup` with autocomplete). Rejected: models would become code, users would need our Node build, and it splits into a build step plus a runtime.
3. **Point users at Pydantic / Zod / serde.** Rejected: works in one language at a time and loses the four languages agreeing, which is the library's reason to exist.

Also decided in the conversation:
- **Dot access (`models.signup`) is not offered in any language**, even where it could be. Every language uses `get`.
- **References by name, as OpenAPI `$ref` does**, not a relationships section.
- **Domains are part of the file shape from day one**, so there's only ever one shape. The owner accepted the cost: a one-model app still writes one domain level.

## The file

Always three levels: domain → model → field.

```json
{
  "billing": {
    "address": { "street": { "type": "string", "length": 200 }, "country": "country" },
    "invoice": {
      "to":     "address",
      "status": { "type": "enum", "values": ["draft", "sent", "paid"] },
      "total":  { "type": "decimal", "precision": 12, "scale": 2 },
      "note":   { "type": "text", "nullable": true }
    }
  },
  "shop": {
    "line_item": { "sku": "gtin", "qty": "int32" },
    "order": {
      "bill_to": "billing:address",
      "items":   { "type": "array", "items": "line_item" },
      "status":  "billing:invoice.status"
    }
  }
}
```

- Domain, model and field names are lowercase snake_case (`^[a-z][a-z0-9_]*$`), so `:` and `.` can only ever be separators.
- The one exception: a top-level `"$schema"` key is allowed and ignored, so editors can point at `schema/models.schema.json` the usual way. No other `$` key, at any level.
- A field is either a **reference string** or an **object** `{ "type": <reference>, ...settings }`. The string form is shorthand for `{ "type": <string> }`.

## References

| Written as | Means |
|---|---|
| `email` | a built-in type (by its canonical name), else a model in the same domain |
| `invoice.total` | a field of a model in the same domain |
| `billing:address` | a model in another domain |
| `billing:invoice.total` | a field of a model in another domain |

- A bare name means a type or a model, never a field of the current model, so a name means the same thing wherever it's written.
- **Types are referenced by canonical name only, not aliases** (`decimal`, not `money`). One spelling per type in config. `scalars.get` keeps forgiving aliases for code.
- A model may not have the same name as a built-in type. Loading fails.
- A **model reference** nests that model's fields as an object.
- A **field reference** copies the referenced field's whole definition (type and settings), resolved transitively. **Every name resolves in the domain where it's written**, once, at load. Copying `billing:invoice.to` (written `"address"` in `billing`) into `shop` gives `billing:address`, never `shop:address`. Resolving once per written reference keeps load O(file size). Settings written next to it override the copied ones: `{ "type": "billing:invoice.note", "nullable": false }`.
- `array` takes an `items` setting holding a field definition (string or object). `items` is required when `array` is used in a model. `nullable` inside `items` means a list entry may be `null`; on the field itself it means the whole list may be.
- `enum` requires `values` when used in a model. An enum with no values can't accept anything.
- Cycles through model references, field references or `items` are rejected at load, across domains too. Since nesting is bounded by the models, the depth of validation is too.

## Settings

Allowed on a field: the settings its type lists in `params`, plus `nullable` on every field, plus `items` on `array`. Anything else fails at load. Values are checked at load against `$meta.params` (type, `minimum`, `maximum`, `minItems`; `scale` requires `precision`).

What `validate` enforces, after the type's own normalize and checks:

| Setting | Rule |
|---|---|
| `length` | At most this many code points (the library's existing length unit). |
| `values` | Exactly one of the listed strings, after normalize. A set built at load makes it O(1) per lookup (plus hashing the value). |
| `precision`, `scale` | Reject exactly what Postgres `numeric(p, s)` refuses: round to `s` fraction digits half away from zero, then the integer part may have at most `p - s` digits. Rounding can carry (`9.995` → `10.00` overflows `numeric(3,2)`). Extra fraction digits are not an error, since Postgres rounds them. The value is returned unchanged; rounding is the database's job. Applied to the value's decimal text, in one pass. |
| `fractional_seconds` | Accepted, not checked: Postgres rounds and never refuses. |
| `nullable` | `null` or a missing key is accepted only when `true`. |

The principle, the same one as the 64-bit range fix: **`validate` rejects what the matching Postgres column would refuse**, no more.

## Validating a payload

- Input is parsed JSON: an object for a model.
- Every declared field is required unless `nullable`. **A missing key and `null` are treated the same.**
- Keys the model doesn't declare are errors.
- Each value goes through its type's existing `validate` (normalize, then checks), then its settings. Model values recurse; arrays check each item.
- All errors are collected, none short-circuit. **They're sorted by location**: segment by segment, names by code point, list indices numerically, a parent before its children. Go's `map[string]any` and Rust's default `serde_json::Value` don't keep key order, so input order can't be the contract. Sorting gives the same list in all four languages with no extra dependency, and costs O(k log k) for k errors. `ModelsError` problems are sorted the same way.
- If the root value isn't an object, the single error is at the root pointer `""`.
- On success, the result is the cleaned payload: same shape, normalized values, no extra keys. Missing nullable keys come back as `null`.

## Errors

Every error has a fixed code, so programs can branch on it and translators can key off it. The English sentence is only the default. The shape follows two standards: **RFC 6901 JSON Pointer** for the location, and **RFC 9457 Problem Details**, whose field-error list each error drops into unchanged.

```json
{ "pointer": "/items/2/qty", "code": "invalid", "params": { "type": "int32" },
  "message": "Use a whole number between -2147483648 and 2147483647." }
```

- `pointer`: RFC 6901 (`~` → `~0`, `/` → `~1`), `""` for the root. Into the payload for `ModelError`, into the models file for `ModelsError` (`/billing/invoice/total/precision`).
- `code`: one of the closed lists below. A new code is an addition, never a rename.
- `params`: the facts the message needs, always an object (empty when none).
- `message`: the English default, rendered from the template.

**Payload codes (`ModelError`):**

| Code | Params | English template |
|---|---|---|
| `required` | | `Required.` |
| `unknown_field` | | `Not a field of this model.` |
| `not_object` | | `Must be an object.` |
| `not_list` | | `Must be a list.` |
| `invalid` | `type` | the type's own `error` text |
| `too_long` | `max` | `At most {max} characters.` |
| `not_allowed` | `values` | `Must be one of: {values}.` (`values` joined with `, ` in the message; a list in `params`) |
| `too_many_digits` | `precision`, `scale` | `Too many digits for precision {precision}, scale {scale}.` |

**Models file codes (`ModelsError`):** `not_object`, `bad_name`, `unresolved`, `alias` (params `canonical`), `unknown_setting`, `bad_setting`, `missing_setting` (params `setting`), `cycle`, `too_deep` (params `max`). Their templates follow the same pattern.

- **The templates are data:** a new `$meta.errors` table in `dist/scalars.json`, code → template, with placeholders in ICU MessageFormat syntax (`{max}`), which translation tools read. Adding to `$meta` is an addition, so the stable shape holds. Each language's engine is generated from that table, and a translator copies it.
- Each type's existing `error` text stays where it is. `invalid` carries the `type`, so a translation can be keyed by type.
- Deferred, additive: a `reason` param on `invalid` (pattern, check digit, encoding). It needs changes in all four existing validators.

## API

The same three steps in every language: load, get, validate.

```python
models = scalars.models(data)           # raises ModelsError listing every problem in the file
order = models.get("shop:order")         # None if no such model
order.validate(payload)                  # cleaned payload, or raises ModelError
order.is_valid(payload)                  # bool
models.all                               # every full name ("billing:address", …), sorted
```

```ts
const models = scalars.models(data);
models.get("shop:order")?.validate(payload);
```

```go
models, err := scalars.Models(data)      // data is the any from encoding/json
order, ok := models.Get("shop:order")
clean, err := order.Validate(payload)
```

```rust
let models = scalars::models(&data)?;    // data: serde_json::Value
let order = models.get("shop:order").unwrap();
let clean = order.validate(&payload)?;
```

- `data` is already-parsed JSON, never a path. The library doesn't touch the filesystem.
- **`get` matches the existing `scalars.get`**: `None` / `undefined` / `(nil, false)` / `Option`. (This reverses an earlier "fail loudly" proposal from the conversation; matching the existing `get` is the one-way rule.)
- `get` takes the full `domain:model` name only. No aliases, no case forgiving.
- `ModelError` and `ModelsError` each hold a sorted list of problems, `{pointer, code, params, message}` (see Errors).
- Each language's types and naming follow the existing engine conventions for that language.

## Constraints

- **Field settings are data only.** There's no code API like `scalars.string.of(length=50)`; that would be a second way. (Also a change from the conversation, where it was proposed as step 1.)
- **Rust gains a `serde_json` dependency** for the input and the models data. Every Rust user parsing JSON already uses it. Go uses the standard library (`map[string]any`, `[]any`). Python and TypeScript stay dependency-free.
- Load is O(size of the models file) including reference resolution and cycle detection. Validate is O(size of input): each value is visited once and the models (not the input) bound recursion depth. Back this with a measurement on hostile input, as the existing runners do.
- `dist/scalars.json` doesn't change shape; it only gains `$meta.errors`. Models are a separate file the user writes.
- Ship a JSON Schema for the models file at `schema/models.schema.json` so editors catch mistakes. It can check the shape and names; reference resolution and setting validity are checked at load.
- The reference implementation in `dev/lib/reference.mjs` gets models too, and shared cases in `dev/langs/` run against it and all four languages, as today.

## Left to the builder

- How `precision` / `scale` read the decimal text of `sf_decimal` (a float64): pick the shortest round-trip text, the same in all four languages.

- File and code layout inside `dev/codegen/` (likely a models section in each `engine.*`).
- Exact class and type names per language beyond `models` / `get` / `validate` / `is_valid` / `all` / `ModelError` / `ModelsError`.
- The shared case format for models and the hostile inputs to measure.
- README section and method-table rows, written once and nearly identical across languages.
