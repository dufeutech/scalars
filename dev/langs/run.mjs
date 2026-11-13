// Dev-only: runs every language runner against dist/scalars.json (or the file given) and cases.json.
// Needs node, python (3), go and cargo on PATH. Run: npm run check:langs [-- path/to/scalars.json]
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(process.argv[2] ?? path.join(here, "../../dist/scalars.json"));
const cases = path.join(here, "cases.json");
const python = spawnSync("python3", ["--version"]).status === 0 ? "python3" : "python";

const runners = [
    ["ts", process.execPath, ["check.ts", dist, cases], here],
    ["python", python, ["-I", "-X", "utf8", "check.py", dist, cases], here],
    ["go", "go", ["run", ".", dist, cases], path.join(here, "go")],
    ["rust", "cargo", ["run", "--quiet", "--", dist, cases], path.join(here, "rust")],
];

let failed = 0;
for (const [name, cmd, args, cwd] of runners) {
    const r = spawnSync(cmd, args, { cwd, encoding: "utf8" });
    const out = (r.stdout + r.stderr).trim() || r.error?.message || "";
    if (r.status !== 0) failed++;
    console.log(r.status === 0 ? out : `${name}: FAILED\n${out}`);
}
process.exit(failed ? 1 : 0);
