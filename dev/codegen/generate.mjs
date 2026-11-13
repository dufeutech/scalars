// Turns the built catalogue into generated source files, one emitter per language.
import { toModel } from "./model.mjs";
import { emitPython } from "./python.mjs";
import { emitTypeScript } from "./ts.mjs";
import { emitGo } from "./go.mjs";

/** Each emitter is (models, version) => { "<path under dist/>": text }. Tasks add theirs here. */
const EMITTERS = [emitPython, emitTypeScript, emitGo];

export function generate(scalars) {
    const models = toModel(scalars);
    const files = {};
    for (const emit of EMITTERS) Object.assign(files, emit(models, scalars.version));
    return files;
}
