// Dev-only: reads a source file (src/*.yaml, src/targets/*.yaml) as YAML 1.2.
import fs from "node:fs";
import YAML from "yaml";

/** Parses a YAML source file. */
export const readSource = (p) => YAML.parse(fs.readFileSync(p, "utf8"));
