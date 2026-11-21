// Dev-only: runs every language runner against dist/scalars.json (or the file given) and cases.json.
// Needs node, python (3), go and cargo on PATH. Run: npm run check:langs [-- path/to/scalars.json]
import path from "node:path";
import { CASES, DIST, runAll } from "./runners.mjs";

const dist = path.resolve(process.argv[2] ?? DIST);
process.exit(runAll(dist, CASES) ? 1 : 0);
