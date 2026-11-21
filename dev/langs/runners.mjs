// Dev-only: the four language runners, shared by run.mjs (the shared cases) and fuzz.mjs (generated cases).
// Needs node, python (3), go and cargo on PATH.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const DIST = path.join(here, "../../dist/scalars.json");
export const CASES = path.join(here, "cases.json");

/** [name, command, args, cwd] for each runner, checking `dist` against `cases`. */
export function runners(dist, cases) {
    const python = spawnSync("python3", ["--version"]).status === 0 ? "python3" : "python";
    return [
        ["ts", process.execPath, ["check.ts", dist, cases], here],
        ["python", python, ["-I", "-X", "utf8", "check.py", dist, cases], here],
        ["go", "go", ["run", ".", dist, cases], path.join(here, "go")],
        ["rust", "cargo", ["run", "--quiet", "--", dist, cases], path.join(here, "rust")],
    ];
}

/** Runs every runner, printing each one's output (at most `maxLines` lines of it); returns how many failed. */
export function runAll(dist, cases, maxLines = Infinity) {
    let failed = 0;
    for (const [name, cmd, args, cwd] of runners(dist, cases)) {
        const r = spawnSync(cmd, args, { cwd, encoding: "utf8", maxBuffer: 1 << 28 });
        let out = (r.stdout + r.stderr).trim() || r.error?.message || "";
        const lines = out.split("\n");
        if (lines.length > maxLines) out = [...lines.slice(0, maxLines), `... ${lines.length - maxLines} more lines`].join("\n");
        if (r.status !== 0) failed++;
        console.log(r.status === 0 ? out : `${name}: FAILED\n${out}`);
    }
    return failed;
}
