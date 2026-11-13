import { sqlString } from "../../lib/derive.mjs";

/** SQL expression that inserts one JSON example value into the type's Postgres column. */
export function pgLiteral(t, value) {
    if (t.postgres.type === "bytea") {
        let s = String(value);
        if (t.name === "sha256") return `decode(${sqlString(s)}, 'hex')`;
        if (t.name === "sf_binary") s = s.slice(1, -1);
        if (t.name === "base64url") {
            s = s.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
            s += "=".repeat((4 - (s.length % 4)) % 4);
        }
        return `decode(${sqlString(s)}, 'base64')`;
    }
    if (value !== null && typeof value === "object") return sqlString(JSON.stringify(value));
    if (["jsonb", "json"].includes(t.postgres.type)) return sqlString(JSON.stringify(value));
    return sqlString(String(value));
}
