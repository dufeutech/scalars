# Scalars

**One definition per data type that works the same in HTML forms, JSON / OpenAPI and Postgres.**

Pick `phone` once and you get the form input (`<input type="tel">`), the JSON rule (`^\+[1-9]\d{1,14}$`), the database column with a matching `CHECK`, a friendly label, a hint, an error message, and examples, all agreeing with each other.

## Quick start

Download one file into your project and use it. There's no package to install.

**Python** (3.10 or newer, no dependencies)

```sh
curl -O https://raw.githubusercontent.com/dufeutech/scalars/main/dist/python/scalars.py
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
curl -O https://raw.githubusercontent.com/dufeutech/scalars/main/dist/ts/scalars.ts
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
curl --create-dirs -o scalars/go.mod     https://raw.githubusercontent.com/dufeutech/scalars/main/dist/go/go.mod
curl --create-dirs -o scalars/scalars.go https://raw.githubusercontent.com/dufeutech/scalars/main/dist/go/scalars.go
go mod edit -require=scalars@v0.0.0 -replace=scalars=./scalars
go mod tidy
```

```go
import "scalars"

s, _ := scalars.Country.Validate(" us ")        // "US"
ok := scalars.Email.IsValid("user@example.com") // true
_, err := scalars.Phone.Validate("4155552671")  // err.Error() is the type's error text
```

**Rust** (1.80 or newer, needs the `regex` crate)

```sh
curl -o src/scalars.rs https://raw.githubusercontent.com/dufeutech/scalars/main/dist/rust/scalars.rs
cargo add regex
```

```rust
mod scalars;

let s = scalars::COUNTRY.validate(" us ").unwrap(); // "US"
let ok = scalars::EMAIL.is_valid("user@example.com"); // true
let err = scalars::PHONE.validate("4155552671"); // Err(ScalarError): displays the type's error text
```

That's it. Every type in the table below is there the same way: `scalars.uuid`, `scalars.date`, `scalars.decimal`, and so on.

## What each type gives you

|                         | Python                     | TypeScript                 | Go                          | Rust                       |
| ----------------------- | -------------------------- | -------------------------- | --------------------------- | -------------------------- |
| Clean up, then check    | `validate(v)` (raises)     | `validate(v)` (throws)     | `Validate(v)` → `(v, err)`  | `validate(v)` → `Result`   |
| Just check              | `is_valid(v)`              | `isValid(v)`               | `IsValid(v)`                | `is_valid(v)`              |
| Only clean up           | `normalize(s)`             | `normalize(s)`             | `Normalize(s)` (text types) | `normalize(s)` (text types) |
| Find a type by any name | `scalars.get("money")`     | `scalars.get("money")`     | `scalars.Get("money")`      | `scalars::get("money")`    |
| Every type              | `scalars.all`              | `scalars.all`              | `scalars.All`               | `scalars::ALL`             |

Each type also carries its `label`, `hint` and `error` text, ready to show in a form.

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
| Web link                              | `uri`             | `url`, `link`            | `"https://example.com/a/b?c=1"`          |
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

Need something more specific? There are 56 more **advanced** and **domain** types (like `uuid_v7`, `semver`, `iban`, `isbn`, `gln`). Every one of them names the core type to fall back to in its `alternative` field.

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
    "postgres": { "type": "text", "check": "CHECK ({column} ~ '^\\+[1-9][0-9]{1,14}$')" }
}
```

- `html` is the form field: put `attrs` on an `<input>` (or the named `element`).
- `postgres` is the column: use `type`, and replace `{column}` in `check` with your column name.
- `schema` is the rule as plain JSON Schema. Its `pattern` reads the same in Go, Python, Rust, JS and Postgres (in Python, use `re.fullmatch`).
- `normalize` lists cleanup steps to run on what a person typed _before_ checking it. Each step is defined in `$meta.normalize_steps`.
- `primitive` is one of 16 basic types. It's all a language needs to choose a native type (`int64` → `int64` / `i64` / `int` / `bigint`).
- `params` (on types like `string`, `decimal`, `enum`) lists the settings a field can take, like `length` or `values`. Each one is defined once in `$meta.params`.
- `examples.invalid` values break the rule in `schema` before any cleanup. A few become valid once `normalize` has run: `country` lists `"us"`, which `validate` turns into `"US"`.
- `examples.db_invalid` holds values that pass the JSON rule but that only the database can reject, like `2026-02-30`.
- `check` (on a few types) names a rule beyond the pattern, defined in `$meta.checks`: a check digit or a 64-bit range. `examples.check_invalid` holds values that match the pattern but fail it, like a barcode with a wrong last digit.
- The rule for matching a word to a type (as `get` does) is in `$meta.lookup`.

**The shape is stable from 0.3.0:** new releases add or fix types, but never rename or move a field.

## Good to know

- **Fast on any input.** `validate` takes time proportional to the input length, in all four languages. The build rejects any pattern that isn't provably linear, so no input can make a regex run for seconds.
- **Check digits and 64-bit ranges are checked.** `validate` rejects a `gtin`, `gln`, `iban`, `lei`, `isbn` or `orcid` with a wrong check digit, and an `int64` or `uint64` too big for 64 bits, in all four languages. JSON Schema and HTML only check the pattern; Postgres catches the 64-bit range but not check digits.
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

- **Go and Rust only `normalize` text types**, and in Rust `object`, `array` and `any` are metadata only. Rust's `Meta` has no examples, and Go's leaves out the four that are or hold a JSON object, so nothing runs at start-up. Every example is in `dist/scalars.json`.

## Changing or adding a type

**Use what's in `dist/`. Edit what's in `src/`.** Both hold the same types. `src/` is short and has no repeats; `dist/` is generated from it with every value written out.

Edit [`src/scalar.json`](src/scalar.json), plus [`src/targets/html.json`](src/targets/html.json) and [`src/targets/postgres.json`](src/targets/postgres.json). A type can say `"base": "string"` and then list only what differs. Three hidden building blocks (`_token`, `_json`, `_bytes`) hold settings that many types share. The HTML `pattern`, the Postgres `CHECK`s and the `docs_link`s are never written by hand; they're generated from the type's one `pattern`.

Then rebuild and test (Node 22 or newer; this is dev tooling only, the release doesn't need it):

```sh
cd dev
npm install
npm run build         # rewrites dist/, including the four language files
npm test              # every example runs through JSON Schema, the browser's regex engine and real Postgres
npm run check:langs   # every example, normalize and lookup through the generated TypeScript, Python, Go and Rust files
```

`check:langs` needs Python 3, Go and Cargo installed. The language files are generated by [`dev/codegen/`](dev/codegen/) (one runtime per language plus the type data), and the test runners in [`dev/langs/`](dev/langs/) import them.

## License

See [LICENSE](LICENSE).
