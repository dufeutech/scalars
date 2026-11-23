# Scalars

**One definition per data type that works the same in HTML forms, JSON / OpenAPI and Postgres.**

Pick `phone` once and you get the form input (`<input type="tel">`), the JSON rule (`^\+[1-9]\d{1,14}$`), the database column type (`scalars.phone`, enforcing the same rule), a friendly label, a hint, an error message, and examples, all agreeing with each other.

## Quick start

Download one file into your project and use it. There's no package to install.

**Python** (3.10 or newer, no dependencies)

```sh
curl -O https://raw.githubusercontent.com/dufeutech/scalars/v0.8.1/dist/python/scalars.py
```

```python
import scalars

scalars.country.validate(" us ")           # "US": cleans up, then checks
scalars.email.is_valid("user@example.com")  # True
try:
    scalars.phone.validate("4155552671")
except scalars.ScalarError as e:
    print(e)  # "Start with + and the country code, no spaces, like +14155552671."
```

**TypeScript** (5.6 or newer, or Node 22.18 or newer; no dependencies)

```sh
curl -O https://raw.githubusercontent.com/dufeutech/scalars/v0.8.1/dist/ts/scalars.ts
```

```ts
import { scalars, ScalarError } from "./scalars.ts";

scalars.country.validate(" us "); // "US"
scalars.email.isValid("user@example.com"); // true
try {
  scalars.phone.validate("4155552671");
} catch (e) {
  if (e instanceof ScalarError) console.log(e.message);
}
```

**Go** (1.21 or newer, needs `golang.org/x/text`)

```sh
curl --create-dirs -o scalars/go.mod     https://raw.githubusercontent.com/dufeutech/scalars/v0.8.1/dist/go/go.mod
curl --create-dirs -o scalars/scalars.go https://raw.githubusercontent.com/dufeutech/scalars/v0.8.1/dist/go/scalars.go
go mod edit -require=scalars@v0.0.0 -replace=scalars=./scalars
go mod tidy
```

```go
import "scalars"

s, _ := scalars.Country.Validate(" us ")        // "US"
ok := scalars.Email.IsValid("user@example.com") // true
_, err := scalars.Phone.Validate("4155552671")  // err.Error() is the type's error text
```

**Rust** (1.80 or newer, needs the `regex` and `serde_json` crates)

```sh
curl -o src/scalars.rs https://raw.githubusercontent.com/dufeutech/scalars/v0.8.1/dist/rust/scalars.rs
cargo add regex serde_json
```

```rust
mod scalars;

let s = scalars::COUNTRY.validate(" us ").unwrap(); // "US"
let ok = scalars::EMAIL.is_valid("user@example.com"); // true
let err = scalars::PHONE.validate("4155552671"); // Err(ScalarError): displays the type's error text
```

**Postgres** (16 or newer, plain SQL, no extensions, so it runs on managed hosts too)

```sh
curl -O https://raw.githubusercontent.com/dufeutech/scalars/v0.8.1/dist/postgres/scalars.sql
psql -v ON_ERROR_STOP=1 -1 -f scalars.sql  # creates the scalars schema in one transaction; run it again to upgrade
```

```sql
CREATE TABLE payment (account scalars.iban NOT NULL, country scalars.country);
INSERT INTO payment VALUES ('DE89370400440532013001', 'DE');  -- refused: wrong check digit
SELECT scalars.iban_reason('DE89370400440532013001');           -- 'check'
SELECT scalars.is_email('user@example.com');                    -- true
```

That's it. Every type in the table below is there the same way: `scalars.uuid`, `scalars.date`, `scalars.decimal`, and so on.

## What each type gives you

|                         | Python                     | TypeScript                 | Go                          | Rust                       | Postgres                       |
| ----------------------- | -------------------------- | -------------------------- | --------------------------- | -------------------------- | ------------------------------ |
| Clean up, then check    | `validate(v)` (raises)     | `validate(v)` (throws)     | `Validate(v)` → `(v, err)`  | `validate(v)` → `Result`   | column type `scalars.<type>` (no clean-up) |
| Just check              | `is_valid(v)`              | `isValid(v)`               | `IsValid(v)`                | `is_valid(v)`              | `scalars.is_<type>(v)`         |
| Why it failed           | `e.reason` (`Reason.*`)    | `e.reason` (`Reason`)      | `e.Reason` (`Reason*`)      | `e.reason` (`Reason`, `.as_str()`) | `scalars.<type>_reason(v)` (NULL when valid) |
| Only clean up           | `normalize(s)`             | `normalize(s)`             | `Normalize(s)` (text types) | `normalize(s)` (text types) | in the app                    |
| Find a type by any name | `scalars.get("money")`     | `scalars.get("money")`     | `scalars.Get("money")`      | `scalars::get("money")`    | —                              |
| Every type              | `scalars.all`              | `scalars.all`              | `scalars.All`               | `scalars::ALL`             | —                              |

Each type also carries its `label`, `hint` and `error` text, ready to show in a form.

A failed `validate` says why with one reason from a fixed set: `wrong_kind`, `malformed`, `too_long`, `too_short`, `pattern`, `out_of_range`, `check`, `not_in_list`. When a value breaks several rules you get the first one checked, in that order, the same in all five languages. The set, its order and each meaning are `$meta.reasons` in `dist/scalars.json`. The error's message stays the type's `error` text.

## Models: check a whole payload

A form or request body has several fields, some with settings (`length`, `values`), some nested. Write them once as data, then check a payload against a model. Same file, same rules, same errors in all four languages.

Always three levels: domain → model → field. A field is a type name, another model, or `{ "type": …, ...settings }`.

```json
{
  "billing": {
    "address": { "street": { "type": "string", "length": 200 }, "country": "country" },
    "invoice": {
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

Load it, get a model, validate. The three lines are the same everywhere; `payload` is a parsed JSON object like `{"bill_to": {"street": "1 Main St", "country": " us "}, "items": [{"sku": "4006381333931", "qty": 2}], "status": "sent"}`.

```python
models = scalars.models(data)            # raises ModelsError listing every problem in the file
order = models.get("shop:order")         # None if there's no such model
clean = order.validate(payload)          # the cleaned payload, or raises ModelError
```

```ts
const models = scalars.models(data); // throws ModelsError
const order = models.get("shop:order"); // undefined if there's no such model
const clean = order!.validate(payload); // throws ModelError
```

```go
models, err := scalars.Models(data)  // *ModelsError listing every problem in the file
order, ok := models.Get("shop:order") // ok is false if there's no such model
clean, err := order.Validate(payload) // *ModelError, or the cleaned payload
```

```rust
let models = scalars::models(&data)?; // Err(ModelsError) listing every problem in the file
let order = models.get("shop:order").unwrap(); // None if there's no such model
let clean = order.validate(&payload)?; // Err(ModelError), or the cleaned payload
```

|                         | Python                  | TypeScript              | Go                         | Rust                      |
| ----------------------- | ----------------------- | ----------------------- | -------------------------- | ------------------------- |
| Load a file             | `scalars.models(data)`  | `scalars.models(data)`  | `scalars.Models(data)`     | `scalars::models(&data)`  |
| Find a model            | `models.get(name)`      | `models.get(name)`      | `models.Get(name)`         | `models.get(name)`        |
| Every model name        | `models.all`            | `models.all`            | `models.All()`             | `models.all()`            |
| Clean up, then check    | `m.validate(p)`         | `m.validate(p)`         | `m.Validate(p)`            | `m.validate(&p)`          |
| Just check              | `m.is_valid(p)`         | `m.isValid(p)`          | `m.IsValid(p)`             | `m.is_valid(&p)`          |
| A bad file              | `ModelsError`           | `ModelsError`           | `*ModelsError`             | `ModelsError`             |
| A bad payload           | `ModelError`            | `ModelError`            | `*ModelError`              | `ModelError`              |
| Each error's problems   | `e.problems`            | `e.problems`            | `e.Problems`               | `e.problems`              |

- `data` is already-parsed JSON. The library never reads files, so write your models file in YAML or anything else and parse it yourself.
- **Go:** payloads and models data must be what `encoding/json` produces: `map[string]any`, `[]any`, `float64`, `string`, `bool`, `nil`. A hand-built `int`, `[]string` or `map[string]string` is refused, and `json.Number` (`Decoder.UseNumber`) isn't supported.
- **Rust:** `cargo add regex serde_json`. Data and payloads are `serde_json::Value`.
- **Python** returns a float for number-kind fields (`3` → `3.0`), as it does for single scalars.
- Values of `object` and `any` fields come back as given, even inside a list: Python, TypeScript and Go return the input's own object, so the cleaned payload shares it with the payload you passed in. Rust returns a copy. Lists themselves are always new.
- On success you get the cleaned payload: normalized values, only the declared keys, missing nullable keys as `null`. A missing key and `null` are the same. A key the model doesn't declare is an error.
- Every bad field is reported, sorted by location. Limits: models nest at most 64 levels (models and `items` combined), and `get` takes the full `domain:model` name only.

### References

| Written as              | Means                                                            |
| ----------------------- | ---------------------------------------------------------------- |
| `email`                 | a built-in type (canonical name, no aliases), else a model in the same domain |
| `invoice.total`         | a field of a model in the same domain (its type and settings, copied) |
| `billing:address`       | a model in another domain                                        |
| `billing:invoice.total` | a field of a model in another domain                             |

Settings written next to a reference override the copied ones: `{ "type": "billing:invoice.note", "nullable": false }`. Names are lowercase snake_case. A model can't share a name with a type, and cycles are refused. A top-level `"$schema"` key is ignored, so an editor can check the file against [`schema/models.schema.json`](schema/models.schema.json).

### Settings

`validate` rejects what the matching Postgres column would refuse, no more.

| Setting                | Rule                                                                              |
| ---------------------- | --------------------------------------------------------------------------------- |
| `length`               | At most this many characters (code points).                                       |
| `values`               | Exactly one of the listed strings (required on `enum`).                           |
| `precision`, `scale`   | Fits Postgres `numeric(p, s)`: extra fraction digits are fine (Postgres rounds), too many integer digits are not. The value comes back unchanged. |
| `nullable`             | `null` or a missing key is accepted only when `true`.                             |
| `items`                | On `array`: a field definition for each entry (required).                         |
| `fractional_seconds`   | Accepted, not checked: Postgres rounds and never refuses.                         |

Loading the file refuses:

- a setting the type doesn't list, like `length` on `text` or `precision` on `float64`;
- `scale` without `precision`;
- `values` entries that aren't strings, repeat, or aren't already clean (the type must return each one unchanged).

### Errors

Each problem is `{ pointer, code, params, message }`: an RFC 6901 JSON Pointer into the payload (`""` is the root), a fixed code, the facts the message needs, and the English text.

| Code              | Params                       | English message                                             |
| ----------------- | ---------------------------- | ----------------------------------------------------------- |
| `required`        |                              | `Required.`                                                 |
| `unknown_field`   |                              | `Not a field of this model.`                                |
| `not_object`      |                              | `Must be an object.`                                        |
| `not_list`        |                              | `Must be a list.`                                           |
| a reason          | `type`                       | the type's own `error` text                                 |
| `too_long`        | `type`, `max`                | `At most {max} characters.`                                 |
| `not_allowed`     | `type`, `values`             | `Must be one of: {values}.`                                 |
| `too_many_digits` | `type`, `precision`, `scale` | `Too many digits for precision {precision}, scale {scale}.` |

A field whose value fails its type reports the reason `validate` gives as its code: `wrong_kind`, `malformed`, `too_short`, `pattern`, `out_of_range`, `check` or `not_in_list` (the list and its order are `$meta.reasons`). The message rule is one: a code with a template in `$meta.errors` uses it, any other uses the type's `error`. So `too_long` reads `At most {max} characters.` whether the limit is the type's own (`char` given `"ab"`: `max` 1) or the field's `length`. Every problem on a type field carries `params.type`.

A bad models file raises `ModelsError` with the same shape, pointing into the file (`/billing/invoice/total/precision`). Its codes are `not_object`, `bad_name`, `type_name` (a model named like a type), `unresolved`, `alias`, `unknown_setting`, `bad_setting`, `missing_setting` and `cycle`, plus `too_deep` for nesting past 64 levels. All the templates are in `$meta.errors` in `dist/scalars.json`.

**Translating:** key a catalogue by `code` and fill in the `{params}`; for a code with no template, key by `params.type` (and the code, if you want a message per reason). Problems drop into an [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) response unchanged:

```json
{
  "type": "https://example.com/problems/validation",
  "title": "Your order has errors",
  "status": 422,
  "errors": [
    { "pointer": "/items/0/qty", "code": "wrong_kind", "params": { "type": "int32" }, "message": "Please use a whole number, like 42." },
    { "pointer": "/status", "code": "not_allowed", "params": { "type": "enum", "values": ["draft", "sent", "paid"] }, "message": "Must be one of: draft, sent, paid." }
  ]
}
```

Each problem turns into that JSON object as is: Python `p._asdict()`, Go `encoding/json` (the fields have JSON tags), Rust `serde_json::Value::from(&p)`, and TypeScript problems are plain objects already.

## Pick a type

Start with the **core** types below; they cover almost everything. Each one also has **aliases**, so if you think "url" or "money", that works too (`url` → `uri`, `money` → `decimal`).

| What are you storing?                 | Type              | Also called              | Example                                  |
| ------------------------------------- | ----------------- | ------------------------ | ---------------------------------------- |
| **Words**                             |                   |                          |                                          |
| Short text (a name, a title)          | `string`          | `short_text`             | `"hello"`                                |
| Long text (as many lines as you need) | `text`            | `long_text`, `paragraph` | `"unbounded multi-line body"`            |
| A secret, like a password             | `secret`          | `password`, `api_key`    | `"••••••••"`                             |
| **Numbers**                           |                   |                          |                                          |
| Whole number                          | `int32`           | `int`, `integer`         | `42`                                     |
| Big whole number                      | `int64`           | `bigint`, `long`         | `"9007199254740993"`                     |
| Any number                            | `float64`         | `number`, `float`        | `3.141592653589793`                      |
| Exact number, like money              | `decimal`         | `money`                  | `"1234.56"`                              |
| **Choices**                           |                   |                          |                                          |
| Yes or no                             | `boolean`         | `bool`, `yes_no`         | `true`                                   |
| One option from a list                | `enum`            | `choice`, `select`       | `"active"`                               |
| **Dates and times**                   |                   |                          |                                          |
| Date                                  | `date`            | `day`                    | `"2026-08-16"`                           |
| Time of day                           | `time_local`      | `time_of_day`            | `"14:30:00"`                             |
| Exact moment (with time zone)         | `date_time`       | `datetime`, `timestamp`  | `"2026-08-16T14:30:00Z"`                 |
| Date and time on the clock (no zone)  | `date_time_local` | `local_datetime`         | `"2026-08-16T14:30:00"`                  |
| Length of time                        | `duration`        | `interval`               | `"P3DT4H30M"`                            |
| Time zone                             | `timezone`        | `tz`                     | `"America/New_York"`                     |
| **People and the web**                |                   |                          |                                          |
| Email address                         | `email`           | `email_address`          | `"user@example.com"`                     |
| Phone number                          | `phone`           | `tel`, `mobile`          | `"+14155552671"`                         |
| Web link                              | `uri`             | `url`, `website`         | `"https://example.com/a/b?c=1"`          |
| Website name                          | `hostname`        | `domain`                 | `"api.example.com"`                      |
| Web address name                      | `slug`            | `permalink`              | `"getting-started"`                      |
| IP address                            | `ipv4`, `ipv6`    | `ip`                     | `"192.0.2.1"`                            |
| Network range                         | `cidr`            | `subnet`                 | `"192.0.2.0/24"`                         |
| **Places and money**                  |                   |                          |                                          |
| Country                               | `country`         | `country_code`           | `"US"`                                   |
| Currency                              | `currency`        | `currency_code`          | `"USD"`                                  |
| Language and region                   | `locale`          | `lang`                   | `"en-US"`                                |
| **Things and IDs**                    |                   |                          |                                          |
| Unique ID                             | `uuid`            | `guid`                   | `"f81d4fae-7dec-11d0-a765-00a0c91e6bf6"` |
| Color                                 | `color`           | `colour`                 | `"#1a2b3c"`                              |
| File                                  | `binary`          | `file`, `bytes`          | `"SGVsbG8gd29ybGQ="`                     |
| File type                             | `media_type`      | `mime_type`              | `"application/json"`                     |
| **Shapes**                            |                   |                          |                                          |
| Group of fields                       | `object`          | `map`, `dict`            | `{"key": "value"}`                       |
| List                                  | `array`           | `list`                   | `[1, 2, 3]`                              |
| Anything at all                       | `any`             | `json`                   | `{"anything": [1, "two", true]}`         |

`country`, `country_alpha3` and `currency` accept only the codes ISO currently assigns (ISO 3166-1, and ISO 4217 List One): `XX`, `QQQ` and withdrawn codes like `HRK` fail with `not_in_list`. `language` accepts only current BCP 47 language codes (the IANA Language Subtag Registry): the 2-letter code where one exists, so `fra` fails (use `fr`), as do deprecated codes like `iw` (now `he`). The list is `schema.enum`, so JSON Schema and HTML `select` options use the same one. Postgres checks it too, and a list update there is a re-run of `scalars.sql`, never a migration.

Need something more specific? There are 42 more **advanced** and **domain** types (like `uuid_v7`, `semver`, `iban`, `isbn`, `gln`). Every one of them names the core type to fall back to in its `alternative` field.

## Forms, OpenAPI and Postgres

The language files only validate. For everything else, read the JSON:

| You want to…                                    | Use                                                                                           |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Build a form, a tool or a code generator        | [`dist/scalars.json`](dist/scalars.json): every type fully resolved, nothing to look up       |
| Reference the types from an OpenAPI document    | [`dist/openapi.json`](dist/openapi.json): one JSON Schema per type under `components.schemas` |
| Check one of these files in your editor         | [`schema/`](schema/): a JSON Schema for each                                                  |

One type in `dist/scalars.json` (shortened):

```json
"phone": {
    "label": "Phone number",
    "hint": "Start with + and your country code",
    "error": "Start with + and the country code, no spaces, like +14155552671.",
    "aliases": ["tel", "telephone", "mobile", "phone_number"],
    "primitive": "string",
    "schema": { "type": "string", "pattern": "^\\+[1-9][0-9]{1,14}$" },
    "normalize": ["trim", "remove_spaces", "remove_hyphens"],
    "examples": { "valid": ["+14155552671", "+442071838750"], "invalid": ["4155552671", "+1 415 555 2671"] },
    "html": { "element": "input", "attrs": { "type": "tel", "autocomplete": "tel", "pattern": "\\+[1-9][0-9]{1,14}", "title": "…", "placeholder": "+14155552671" } },
    "postgres": { "type": "text", "domain": "scalars.phone", "domain_check": "scalars.is_phone(VALUE)" }
}
```

- `html` is the form field: put `attrs` on an `<input>` (or the named `element`).
- `postgres` is the column: declare it as `domain`, which [`dist/postgres/scalars.sql`](dist/postgres/scalars.sql) creates as the native `type` plus `domain_check`.
- `schema` is the rule as plain JSON Schema. Its `pattern` reads the same in Go, Python, Rust, JS and Postgres (in Python, use `re.fullmatch`).
- `normalize` lists cleanup steps to run on what a person typed _before_ checking it. Each step is defined in `$meta.normalize_steps`.
- `primitive` is one of 16 basic types. It's all a language needs to choose a native type (`int64` → `int64` / `i64` / `int` / `bigint`).
- `params` (on types like `string`, `decimal`, `enum`) lists the settings a field can take, like `length` or `values`. Each one is defined once in `$meta.params`.
- `examples.invalid` values break the rule in `schema` before any cleanup. A few become valid once `normalize` has run: `country` lists `"us"`, which `validate` turns into `"US"`.
- `examples.db_invalid` holds values that pass the JSON rule but that only the database can reject, like `2026-02-30`.
- `check` (on a few types) names a rule beyond the pattern, defined in `$meta.checks`: a check digit or a 64-bit range. `examples.check_invalid` holds values that match the pattern but fail it, like a barcode with a wrong last digit.
- `schema.enum` (on `country`, `country_alpha3`, `currency`) is a closed list, checked after everything else. `examples.list_invalid` holds values that match the pattern but aren't on it.
- The rule for matching a word to a type (as `get` does) is in `$meta.lookup`.

**No compatibility promise before 1.0:** a release may rename, move or remove a field when that gives a cleaner design, and the changelog says so (0.8.0 replaced `postgres.check` with `postgres.domain`).

## Good to know

- **Fast on any input.** `validate` (and `scalars.<type>_reason` in Postgres) takes time proportional to the input length, in all five languages. The build rejects any pattern that isn't provably linear, so no input can make a regex run for seconds. Postgres runs the same patterns in its own regex engine; the longest shared test inputs (200,000 characters) take under 15 ms there.
- **Check digits and 64-bit ranges are checked.** `validate` rejects a `gtin`, `gln`, `iban`, `lei`, `isbn` or `orcid` with a wrong check digit, and an `int64` or `uint64` too big for 64 bits, in all five languages. JSON Schema and HTML only check the pattern.
- **Text must be well-formed Unicode** (no lone surrogates, no invalid UTF-8), as the web's `USVString` and RFC 7493 require. Anything else fails `validate` like any other bad value.
- **Go and Rust: `get` returns metadata only.** To validate a type you found by alias, pass its name to `scalars.Lookup` (Go, returns `*TextScalar`, `*IntScalar`, ... as `any`) or `scalars::lookup` (Rust, returns a `Kind`):

  ```go
  m, _ := scalars.Get("money")                         // m.Name is "decimal"
  t := scalars.Lookup(m.Name).(*scalars.TextScalar)
  ```

  ```rust
  let m = scalars::get("money").unwrap(); // m.name is "decimal"
  if let Some(scalars::Kind::Text(t)) = scalars::lookup(m.name) {
      t.is_valid("12.50");
  }
  ```

- **Postgres takes clean values.** Run `normalize` (or `validate`) in the app first: `scalars.iban_reason(' de89 3704 0044 0532 0130 00')` is `pattern`. The cleanup steps stay out of the database because Postgres's `lower()` and `upper()` depend on how the server was set up.
- **Postgres's native types use its own parser.** `scalars.uuid`, `scalars.date`, `scalars.ipv4`, the integers and the other non-text column types are the native type plus only what it misses (a narrower range, the IP family, no `NaN` or `infinity`, the UUID version for `uuid_v7`). So a `scalars.uuid` column accepts `{a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11}` and stores it in Postgres's form; `scalars.is_uuid(text)` checks the exact text when you need it. Number functions take JSON number text; text a double can't hold, like `1e400` or `1e-400`, is `out_of_range` (a `float8` column refuses it too), where Python and TypeScript read those as infinity and 0.
- **Postgres functions return NULL for NULL,** as Postgres functions do: `scalars.iban_reason(NULL)` is NULL, so `WHERE scalars.iban_reason(account) IS NOT NULL` lists the bad rows and leaves out the NULL ones.
- **Postgres domains take no settings.** For a `string` with a length or a `decimal` with a precision, write `varchar(200)` or `numeric(12, 2)`. `enum` has no domain: create a Postgres enum with your values.
- **Upgrade Postgres by running `scalars.sql` again.** It replaces every function and each domain's CHECK, and keeps the domains themselves. New values meet the new rules; rows already stored are not rechecked.
- **Go and Rust only `normalize` text types**, and in Rust `object`, `array` and `any` are metadata only. Rust's `Meta` has no examples, and Go's leaves out the four that are or hold a JSON object, so nothing runs at start-up. Every example is in `dist/scalars.json`.

## Changing or adding a type

**Use what's in `dist/`. Edit what's in `src/`.** Both hold the same types. `src/` is short and has no repeats; `dist/` is generated from it with every value written out.

Edit [`src/scalar.yaml`](src/scalar.yaml), plus [`src/targets/html.yaml`](src/targets/html.yaml) and [`src/targets/postgres.yaml`](src/targets/postgres.yaml). They're YAML 1.2, so comments are fine. Write patterns in single quotes (`'^[0-9]+$'`: no backslash is ever doubled), and quote any value a YAML 1.1 tool would read as a boolean or number, like `'NO'` or `'0'` (a test fails otherwise). A type can say `base: string` and then list only what differs. Three hidden building blocks (`_token`, `_json`, `_bytes`) hold settings that many types share. The HTML `pattern`, the Postgres functions and domain checks, and the `docs_link`s are never written by hand; they're generated from the type's one rule (`domain_check` in `postgres.yaml` covers the few a native column needs, like the IP family).

Then rebuild and test (Node 22 or newer; this is dev tooling only, the release doesn't need it):

```sh
cd dev
npm install
npm run build         # rewrites dist/, including the five language files
npm test              # every example runs through JSON Schema, the browser's regex engine and real Postgres
npm run check:langs   # every example and shared case through the generated TypeScript, Python, Go, Rust and Postgres files
```

`check:langs` needs Python 3, Go and Cargo installed. The language files are generated by [`dev/codegen/`](dev/codegen/) (one runtime per language plus the type data), and the test runners in [`dev/langs/`](dev/langs/) import them.

## License

See [LICENSE](LICENSE).
