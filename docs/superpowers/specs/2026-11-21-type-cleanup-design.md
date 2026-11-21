# Type cleanup (0.7.0)

## Intent

The owner wants the data trimmed of types that won't be useful: every type is something a user has to read past, and
a type that checks nothing or never appears in a form or table is noise. The new identifier types from the handoff
(`sscc`, `un_locode`, `gpc_brick`, `spdx_license`) are dropped too, not added.

## Approaches

- **Remove types outright (picked).** There is no compatibility promise, so there's no reason to keep dead weight.
- Deprecate first (a flag, removal later). Rejected: there are no users to protect, and it adds a field to the shape.
- Move them to an "extras" file. Rejected: the same noise in a second place, and a second file to build and test.

## What goes (14 types)

- HTTP wire formats, not field data: `sf_integer`, `sf_decimal`, `sf_string`, `sf_token`, `sf_binary`, `sf_boolean`,
  `http_date`, `media_range`.
- Niche, or checks almost nothing: `relative_json_pointer`, `iri`, `iri_reference`, `idn_hostname`, `double_int`.
- `idn_email`: it has no pattern, so it checks length only. `email`'s pattern already accepts international
  addresses (`用户@例子.广告`, `ñoño@ejemplo.es` and `δοκιμή@παράδειγμα.δοκιμή` all pass) while still checking the
  `local@domain.tld` shape, so `email` is the type for global addresses. Its `details` will say so, and its examples
  gain one non-ASCII address so the shared cases pin it.

Their aliases go with them, along with their `html`/`postgres` target entries and any `$meta.docs` link no remaining type
uses.

## Constraints

- Tests that use a removed type as a sample (`params.test.mjs`, `codegen.test.mjs`, `linear.test.mjs`,
  `helpers/pg.mjs`, `dev/langs/cases.json`) switch to a remaining type that covers the same thing, or drop the case
  when nothing does. Coverage must not silently shrink: if a removed type was the only one exercising a path (a
  `float64` with `precision`/`scale`, say), the builder keeps a case on another type or says why the path is gone.
- README type tables and examples lose the removed types.
- Release 0.7.0 (breaking): the changelog lists every removed type and what to use instead.

## Left to the builder

Which remaining type replaces each test sample, and the exact replacement wording in the changelog.
