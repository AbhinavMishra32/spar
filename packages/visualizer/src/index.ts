/**
 * Spar's code visualiser: the parts that belong to no process and no language.
 *
 * Three models live here and nothing else does. `trace` is what a run looks
 * like once a tracer has flattened it. `inputs` is how a call is described
 * before it is written. `language`/`dialect` is the seam a runtime plugs into.
 * The canvas, the input form, the main-process service and the tracer programs
 * all sit outside this package and agree only through these three.
 */
export * from "./trace.js";
export * from "./inputs.js";
export * from "./language.js";
export * from "./dialect.js";
export * from "./explain.js";
