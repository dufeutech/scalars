# Models: entities, values and links

Status: agreed with the owner in conversation on 2026-11-22, who asked for the plan next. Read once by a builder; its one open question (the `uri` alias `link`) went to the owner, the rest are settled below.

## Why

Models today can only **nest**: `"to": "address"` puts a whole address inside an invoice, and `"status": "billing:invoice.status"` copies another field's type. Nothing can say "this order belongs to that customer". The owner wants the models file to be the layer where entities and the relationships between them are designed, an abstraction above SQL. Storage (tables, migrations, indexes) is someone else's job, built later by tools that read the file (AstrolaDB, a generator, a person).

So models **describe themselves**: the file says what the entities are and how they link, `models()` guarantees that description is coherent, and `validate` checks only what a single payload can show (an id has the right shape). Nothing reaches a database.

The owner asked that the design follow established practice, with **domain-driven design as a priority**.

## Grounding

Every rule below has a well-known source; the words are ours, kept few.

| Rule | Source |
|---|---|
| Entities (have identity) vs values (defined by their contents, embedded) | DDD entities vs value objects (Evans, 2003); OData CSDL `EntityType` vs `ComplexType`; Ecto `schema` vs `embedded_schema` |
| Embed only values; reach another entity by its id | DDD aggregate rule, "reference other aggregates by identity" (Vernon, 2013) |
| Every entity has an implicit `id`, a uuid v7 | EdgeDB/Gel's implicit `id`; surrogate keys; RFC 9562 recommends v7 for database keys (time-ordered) |
| `link`, `many` | EdgeDB `link` / `multi link`; OData `NavigationProperty` with `Collection(...)` |
| Many-to-many direct, or through a model of its own when the pairing has data | Django `ManyToManyField(through=...)`; Rails `has_and_belongs_to_many` vs `has_many :through` |
| Only the side holding the id declares the link; the reverse is derived | Django `ForeignKey` + `related_name`, Rails `belongs_to`, EdgeDB backlinks |
| One-to-one is a link that is unique | Django `OneToOneField` (a foreign key plus unique); EdgeDB `constraint exclusive` |
| `id` may be missing in a payload | JSON:API: a create request may leave out `id` |
| Self-links are normal | every ORM (`category.parent`, `employee.manager`) |

## Goals

- A models file can declare **entities**, **values** and **links** between entities: many-to-one, one-to-one and many-to-many, including links to the entity's own model.
- `models()` refuses an incoherent description: a link to a value, an embedded entity, a link without a target.
- `validate` checks a link value as a uuid v7 (and a `many` list for repeats), the same in all four languages.
- Still one way to do each thing, still O(file) to load and O(payload) to validate.

## Non-goals (deferred or left to readers of the file)

- Tables, migrations, indexes, column names, delete rules (`ON DELETE`). Storage concerns, for tools that read the file.
- Checking that a linked record exists. That needs a database.
- An API that hands back the resolved description (links with full names, the reverse directions). The file is the description; `models()` only guarantees it's coherent. Additive later.
- Declaring the reverse side of a link (`user.posts`). Readers derive it.
- Entities with local identity inside an aggregate (DDD's inner entities). Model them as values, or as entities linking to their root.
- Data on a link itself (EdgeDB's link properties). Use a model in between (below).

## Anti-goals

- **Polymorphic links** (one link to several kinds of model, Rails' `polymorphic: true`): no foreign key can enforce them, and they're widely regretted.
- Model inheritance.
- Two ways to say one thing. A link is always a `link` field: never a field reference to another model's `id`, never an `array` of links.

## Approaches considered

For how a link is written:

1. **`link` is a type, with settings, like `enum` and `array` (picked).** `{ "type": "link", "to": "auth:user" }`. Keeps the one rule fields have today, a type plus its settings, so `nullable`, field references and overrides work unchanged.
2. **`link` as a field form with no type**, `{ "link": "auth:user" }`. A little shorter, but breaks "every field has a type" (a shared case pins it), so every engine needs a second kind of field.
3. **A field reference to the target's id plus a marker**, `"author": "auth:user.id"`. Dropped: renaming a key would break every link, and it reads as "copy the type", not "points at".

For many-to-many: **direct (`many: true`) by default, with an in-between model when the pairing needs its own fields (picked).** The in-between model is just an entity with two ordinary links, so it needs nothing new. Only the in-between model was rejected as the default: it's verbose for the plain case.

For the key: the owner chose **an implicit `id`, uuid v7, on every entity**, over a `key: true` setting on a field of the user's choice.

For which models get an `id`: **entity by default, a value model says so** (`"$value": true`). The owner's default ("all have an id") with DDD's split. Rejected: an id on every model, embedded ones too (noise on data with no identity), and inferring the kind from use (a model would change kind as soon as something links to it).

## The file

```json
{
  "auth": {
    "user":    { "email": "email" },
    "profile": { "user": { "type": "link", "to": "user", "one": true }, "bio": "text" }
  },
  "shop": {
    "address":   { "$value": true, "street": { "type": "string", "length": 200 }, "country": "country" },
    "line_item": { "$value": true, "product": { "type": "link", "to": "product" }, "qty": "int32" },
    "product":   { "name": "string", "category": { "type": "link", "to": "category" } },
    "category":  { "name": "string", "parent": { "type": "link", "to": "category", "nullable": true } },
    "tag":       { "name": "string" },
    "order": {
      "customer": { "type": "link", "to": "auth:user" },
      "ship_to":  "address",
      "items":    { "type": "array", "items": "line_item" },
      "tags":     { "type": "link", "to": "tag", "many": true }
    },
    "review": {
      "product":  { "type": "link", "to": "product" },
      "author":   { "type": "link", "to": "auth:user" },
      "stars":    "int8"
    }
  }
}
```

### Entities and values

- **Every model is an entity unless it has `"$value": true`.** `$value` is the only `$` key a model may hold (field names can't start with `$`, so it can't collide). Its value must be `true`; `false` or anything else is `bad_setting` at `/<domain>/<model>/$value`, so there's one spelling of "entity" (leave it out).
- **An entity has an implicit field `id`**: type `uuid_v7`, may be missing or `null` in a payload (a record not saved yet), checked when present. It comes first in the cleaned payload; a missing one comes back as `null`, like any missing nullable field.
- **`id` is reserved** in every model, entity or value: declaring a field named `id` is a load error (`reserved`). Values have no identity, so an `id` on one would mislead.
- `id` is not a written field, so a field reference can't copy it (`"auth:user.id"` is `unresolved`). To point at an entity, link to it.
- **Embedding takes values only.** A model reference to an entity (`"owner": "auth:user"`) is `not_value` at load. This is the DDD aggregate rule. It applies wherever a model is embedded: a field, `items`, or a field reference that resolves to one.
- A value model can hold links (`line_item.product`), as a DDD value object can hold another entity's id.
- `get` returns values and entities alike; both validate.

### Links

A link field is `{ "type": "link", "to": <model>, ...settings }`.

| Setting | Meaning | Checked by `validate` |
|---|---|---|
| `to` (required) | The entity it points at, `[domain:]model`, resolved in the domain where it's written, like any reference | — |
| `many` | `true`: many-to-many. The value is a list of ids | each entry a uuid v7, never `null`; no id twice (`duplicate`) |
| `one` | `true`: one-to-one, at most one record links to each target | no (it spans records) |
| `nullable` | as for any field: the link (or the whole list) may be missing or `null` | yes |

- With neither `many` nor `one`, a link is many-to-one: each order has one customer, a customer has many orders.
- `many` and `one` together are a load error (`conflicting_setting`). Each must be a boolean (`bad_setting`).
- `to` naming a value model, a type, or a field is `not_entity`; a name that resolves to nothing is `unresolved`. A missing `to` is `missing_setting` with `setting: "to"`.
- A link value is checked and cleaned exactly as a `uuid_v7` field would be: same normalize, same reasons, `params.type` is `"uuid_v7"`. A `many` list that isn't a list is `not_list`. Repeats are compared after normalize, so `"018F…"` and `"018f…"` are the same id; the problem is reported at the second occurrence, `/tags/3`.
- **Links aren't edges** for cycles or depth: a link value is an id, not the target's contents. So `category.parent → category` is fine, as is any loop of links. Embedding cycles are still refused.
- A field reference to a link copies the link, and settings written next to it override, as today (`{ "type": "shop:order.customer", "nullable": true }`).
- **`link` can't be `items`** (`misplaced` at `/…/items`). A list of links is `many: true`.
- `link` is a reserved word in models: no model may be named `link` (`reserved`), so `"type": "link"` always means the link.
- **`link` stops being an alias of `uri`** (owner, 2026-11-22), so the word means one thing everywhere. `uri` keeps `url` and `website` and its "Web link" label. This touches the catalogue: `src/scalar.yaml`, a rebuild of `dist/`, the README type table, and a changelog line (`scalars.get("link")` now finds nothing). The alias-collision test in `dev/test/human.test.mjs` also fails if any alias equals a models keyword (`link`).
- `link` is a models keyword, not a type in the catalogue: `scalars.get("link")` and `dist/scalars.json` know nothing of it.
- The in-between form for a many-to-many with data is an ordinary entity: `post_tag: { post: {type: link, to: post}, tag: {type: link, to: tag}, added_at: date_time }`. It needs nothing new.

### New codes

Load (`ModelsError`), with templates added to `$meta.errors` (`src/scalar.yaml` `$defs.errors`):

| Code | Params | Template |
|---|---|---|
| `reserved` | | `This name is reserved.` |
| `not_value` | | `Only a value model can be embedded; link to an entity instead.` |
| `not_entity` | | `A link must point at an entity.` |
| `conflicting_setting` | `setting` | `Can't be used with "{setting}".` (reported on `one`, with `setting: "many"`) |
| `misplaced` | | `Not allowed here.` |

Payload (`ModelError`): `duplicate`, no params, `Listed twice.`

Every existing code keeps its meaning. `type_name` still covers a model named like a type.

## Constraints

- Four engines (`dev/codegen/models.{py,ts,go,rs}`) and the reference (`dev/lib/models.mjs`) change; Postgres has no models engine. As before: **the reference first, with shared cases in `dev/langs/cases.json`, then each engine**, and a planted bug per engine caught by a shared case.
- The names `id`, `uuid_v7`, `link` and `$value` live once in `dev/lib/models.mjs` and are emitted into the generated files next to `MAX_DEPTH`; a codegen test fails if an engine spells them itself (the rule the models constants already follow).
- Load stays O(file): links add no edges, `to` resolves once per written link. Validate stays O(payload): the repeat check in a `many` list uses a hash set (Go `map`, Rust `HashSet`, a `Set`, a `set`), O(k) for k ids.
- `schema/models.schema.json` gains `$value` on a model and `to`, `many`, `one` on a field object.
- Breaking changes don't matter (no users yet, owner, 2026-11-22): an embedded model now says `"$value": true`, and a field named `id` is refused. The changelog lists them. Released as **0.9.0**.
- Existing shared cases are updated, not deleted: the embedded models in them gain `$value`, and entity payload results gain `"id": null`.
- `docs/HANDOFF.md` drops "models emitting `CREATE TABLE`" from the Postgres follow-ups: the owner decided on 2026-11-22 that storage stays out of scalars.

## Calls made without the owner (open to change)

- `id` reserved in value models too, not only in entities.
- A field reference can't reach `id`; linking is the only way to point at an entity.
- `one` is descriptive only; `validate` doesn't check it.
- Repeats in a `many` list are refused (`duplicate`), because a join table's key would refuse them.
- `$value: false` is refused rather than meaning "entity".
- The new code names and templates above.
- A `many` list adds no depth level: it holds ids, never nested contents.
- A copy of a link may override `to`, `many` and `one`, like any setting. `conflicting_setting` is judged on the result (both `true`; `many: false` with `one: true` is fine) and reported on whichever of the two is written next to the copy, `one` if both are.
- A bad `$value` is reported once, and that model then counts as both kinds, so embedding it or linking to it adds no further problems.
- `duplicate` carries `params.type: "uuid_v7"`, like every other problem on a typed field.
- `to`, `many` and `one` stay models-only settings, handled like `items`, not added to `$meta.params`.
- `id` first in the cleaned payload holds where the language keeps key order (Python, TypeScript); Go and Rust maps have none.
- The random models test (`dev/langs/fuzz.mjs`) learns to generate `$value`, links, `many` and `one`, so it keeps exercising embedding instead of failing most files on `not_value`.

## Left to the builder

- Where each check sits in each engine's load passes, as long as problems match the shared cases.
- The shared cases themselves: at least one per new code, self-links, a loop of links across domains, a link inside a value inside an entity, a copied link with an override, repeats after normalize, and an `id` present, missing and `null`.
- The README's models section: entities and values, the link table, an example, and the new codes in the code lists.
