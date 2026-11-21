// Turns the built catalogue into generated source files, one emitter per language.
import { toModel } from "./model.mjs";
import { emitPython } from "./python.mjs";
import { emitTypeScript } from "./ts.mjs";
import { emitGo } from "./go.mjs";
import { emitRust } from "./rust.mjs";
import { emitPostgres } from "./postgres.mjs";

/** Each emitter is (models, version, $meta) => { "<path under dist/>": text }. Tasks add theirs here. */
const EMITTERS = [emitPython, emitTypeScript, emitGo, emitRust, emitPostgres];

export function generate(scalars) {
    const models = toModel(scalars);
    const files = {};
    for (const emit of EMITTERS) Object.assign(files, emit(models, scalars.version, scalars.$meta));
    return files;
}
