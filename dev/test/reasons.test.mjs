// Every validate failure carries one reason from $meta.reasons; the reference defines which, and the shared cases pin it.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "../build.mjs";
import { validate } from "../lib/reference.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { scalars } = build(root);
const cases = JSON.parse(fs.readFileSync(path.join(root, "dev/langs/cases.json"), "utf8"));
const REASONS = ["wrong_kind", "malformed", "too_long", "too_short", "pattern", "out_of_range", "check", "not_in_list"];

/** Every scalar case with ok: false, with its input built as the runners build it. */
const failing = [
    ...cases.validate.filter((c) => !c.ok).map((c) => ({ ...c, value: "special" in c ? { NaN, Infinity }[c.special] : c.in })),
    ...cases.hostile.filter((c) => !c.ok).map((c) => ({ ...c, value: c.prefix + c.repeat.repeat(c.count) + c.suffix })),
];
const label = (c) => `${c.type} ${JSON.stringify(c.value).slice(0, 40)}`;

test("$meta.reasons keys are exactly the eight, in order", () => {
    assert.deepEqual(Object.keys(scalars.$meta.reasons), REASONS);
});

test("every ok:false case names a reason", () => {
    for (const c of failing) assert.ok(Object.hasOwn(scalars.$meta.reasons, c.reason ?? ""), label(c));
});

test("reference gives each shared case's reason", () => {
    for (const c of failing) {
        const r = validate(scalars.types[c.type], c.value);
        assert.equal(r.ok, false, label(c));
        assert.equal(r.reason, c.reason, label(c));
    }
});

test("every reason except not_in_list has a shared case", () => {
    const seen = new Set(failing.map((c) => c.reason));
    assert.deepEqual(REASONS.filter((r) => r !== "not_in_list" && !seen.has(r)), []);
});
