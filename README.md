# Scalars

**One definition per data type that works the same in HTML forms, JSON / OpenAPI and Postgres.**

Pick `phone` once and you get the form input (`<input type="tel">`), the JSON rule (`^\+[1-9]\d{1,14}$`), the database column with a matching `CHECK`, a friendly label, a hint, an error message, and examples, all agreeing with each other.

The whole release is plain JSON. You don't need to install anything to use it.

## Which file do I use?

**The shape is stable from 0.3.0:** new releases add or fix types, but never rename or move a field.

**Use what's in `dist/`. Edit what's in `src/`.** The two hold the same types. `src/` is short and has no repeats, so it's easy to edit. `dist/` is generated from it with every value written out, so tools can read it directly.

| You want to… | Use |
|---|---|
| Build a tool, form generator or code generator | [`dist/scalars.json`](dist/scalars.json): every type fully resolved, nothing to look up |
| Reference the types from an OpenAPI document | [`dist/openapi.json`](dist/openapi.json): one JSON Schema per type under `components.schemas` |
| Change or add a type | [`src/scalar.json`](src/scalar.json) plus [`src/targets/html.json`](src/targets/html.json) and [`src/targets/postgres.json`](src/targets/postgres.json) (then rebuild, see below) |
| Check a file in your editor | [`schema/`](schema/): schemas for every file above |

## Pick a type

Start with the **core** types below; they cover almost everything. Each one also has **aliases**, so if you think "url" or "money", that works too (`url` → `uri`, `money` → `decimal`). The rule for matching a word to a type is in `dist/scalars.json` → `$meta.lookup`.

| What are you storing? | Type | Also called | Example |
|---|---|---|---|
| **Words** | | | |
| Short text (a name, a title) | `string` | `short_text` | `"hello"` |
| Long text (as many lines as you need) | `text` | `long_text`, `paragraph` | `"unbounded multi-line body"` |
| A secret, like a password | `secret` | `password`, `api_key` | `"••••••••"` |
| **Numbers** | | | |
| Whole number | `int32` | `int`, `integer` | `42` |
| Big whole number | `int64` | `bigint`, `long` | `"9007199254740993"` |
| Any number | `float64` | `number`, `float` | `3.141592653589793` |
| Exact number, like money | `decimal` | `money` | `"1234.56"` |
| **Choices** | | | |
| Yes or no | `boolean` | `bool`, `yes_no` | `true` |
| One option from a list | `enum` | `choice`, `select` | `"active"` |
| **Dates and times** | | | |
| Date | `date` | `day` | `"2026-08-16"` |
| Time of day | `time_local` | `time_of_day` | `"14:30:00"` |
| Exact moment (with time zone) | `date_time` | `datetime`, `timestamp` | `"2026-08-16T14:30:00Z"` |
| Date and time on the clock (no zone) | `date_time_local` | `local_datetime` | `"2026-08-16T14:30:00"` |
| Length of time | `duration` | `interval` | `"P3DT4H30M"` |
| Time zone | `timezone` | `tz` | `"America/New_York"` |
| **People and the web** | | | |
| Email address | `email` | `email_address` | `"user@example.com"` |
| Phone number | `phone` | `tel`, `mobile` | `"+14155552671"` |
| Web link | `uri` | `url`, `link` | `"https://example.com/a/b?c=1"` |
| Website name | `hostname` | `domain` | `"api.example.com"` |
| Web address name | `slug` | `permalink` | `"getting-started"` |
| IP address | `ipv4`, `ipv6` | `ip` | `"192.0.2.1"` |
| Network range | `cidr` | `subnet` | `"192.0.2.0/24"` |
| **Places and money** | | | |
| Country | `country` | `country_code` | `"US"` |
| Currency | `currency` | `currency_code` | `"USD"` |
| Language and region | `locale` | `lang` | `"en-US"` |
| **Things and IDs** | | | |
| Unique ID | `uuid` | `guid` | `"f81d4fae-7dec-11d0-a765-00a0c91e6bf6"` |
| Color | `color` | `colour` | `"#1a2b3c"` |
| File | `binary` | `file`, `bytes` | `"SGVsbG8gd29ybGQ="` |
| File type | `media_type` | `mime_type` | `"application/json"` |
| **Shapes** | | | |
| Group of fields | `object` | `map`, `dict` | `{"key": "value"}` |
| List | `array` | `list` | `[1, 2, 3]` |
| Anything at all | `any` | `json` | `{"anything": [1, "two", true]}` |

Need something more specific? There are 55 more **advanced** and **domain** types (like `uuid_v7`, `semver`, `iban`, `isbn`). Every one of them names the core type to fall back to in its `alternative` field.

## What one type looks like

From `dist/scalars.json` (shortened):

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

- `primitive` is one of 16 basic types. It's all a language needs to choose a native type (`int64` → `int64` / `i64` / `int` / `bigint`).
- `schema` is the rule as plain JSON Schema. Its `pattern` reads the same in Go, Python, Rust, JS and Postgres (in Python, use `re.fullmatch`).
- `params` (on types like `string`, `decimal`, `enum`) lists the settings a field can take, like `length` or `values`. Each one is defined once in `$meta.params`.
- `normalize` lists cleanup steps to run on what a person typed *before* checking it. Each step is defined in `$meta.normalize_steps`.
- `{column}` in `postgres.check` is replaced with your column name.
- `examples.db_invalid` holds values that pass the JSON rule but that only the database can reject, like `2026-02-30`.

## Editing the types

The files in `src/` avoid repeating themselves. A type can say `"base": "string"` and then list only what differs. Three hidden building blocks (`_token`, `_json`, `_bytes`) hold settings that many types share. The HTML `pattern`, the Postgres `CHECK`s and the `docs_link`s are never written by hand; they're generated from the type's one `pattern`.

After editing, rebuild and test. This is development tooling only, and the release doesn't need it:

```sh
cd dev
npm install
npm run build   # rewrites dist/
npm test        # every example runs through JSON Schema, the browser's regex engine and real Postgres
npm run check:langs   # the same examples, normalize and lookup in TypeScript, Python, Go and Rust
```

`check:langs` needs Python 3, Go and Cargo installed. Each runner in [`dev/langs/`](dev/langs/) is a short, standalone example of reading `dist/scalars.json` in that language.

## License

See [LICENSE](LICENSE).
