// Dev-only: how a test or runner hands a JSON value to the generated Postgres functions, as an app would.
import { modelOf } from "../codegen/model.mjs";
import { normalize } from "../lib/reference.mjs";

const JSONB_KINDS = new Set(["object", "array", "any"]);

/**
 * The argument for `scalars.<type>_reason` and its SQL type, or null when Postgres can't be handed the value.
 * Text is normalized first (the app's job; the database takes only canonical text); a non-string can't reach a text
 * function. Other kinds get the value's JSON text (so the string "5" reaches an integer function as `"5"`, a
 * wrong_kind); object, array and any take jsonb.
 */
export function pgInput(t, v) {
    const { kind } = modelOf(t);
    if (kind === "text") return typeof v === "string" ? { arg: normalize(t, v), sqlType: "text" } : null;
    if (v === undefined) return null;
    return { arg: JSON.stringify(v), sqlType: JSONB_KINDS.has(kind) ? "jsonb" : "text" };
}

/** Calls `scalars.<type>_reason` on one input from pgInput: null when valid, else the reason. */
export async function pgReason(db, t, input) {
    const r = await db.query(`SELECT scalars.${t.name}_reason($1::${input.sqlType}) AS reason`, [input.arg]);
    return r.rows[0].reason;
}
