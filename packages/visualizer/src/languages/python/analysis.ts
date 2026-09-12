import type { InputSpec } from "../../inputs.js";
import { specFromAnalysis, type PythonAnalysis } from "./shapes.js";

/** What the host does with whatever the tracer's `analyze` mode printed.
 *  A thin name for it so the service does not import the adapter's internals. */
export function pythonSpecFromAnalysis(analysis: PythonAnalysis): InputSpec {
  return specFromAnalysis(analysis);
}
