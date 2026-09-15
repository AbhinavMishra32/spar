/**
 * An eval framework, with no idea what Spar is.
 *
 * Everything here is about runs, traces, checks and statistics; nothing here
 * knows about abilities, ratings or challenges. That split is deliberate and it
 * is load-bearing: the Spar-specific half lives beside the host it has to drive
 * (`apps/desktop/src/eval`), because scenarios that exercise the store, the
 * policy and the agent worker cannot honestly be written anywhere else — and if
 * the framework could reach into the app, it would, and within a month the
 * statistics would have Spar's vocabulary baked into them.
 *
 * What is here is the part that would be the same for any agent: how a run is
 * recorded, how two runs are aligned, what a rate means when you have eight of
 * them, and what has to be true before a number is allowed to fail a build.
 */
export { canonicalJson, digest } from "./hash.js";
export {
  cassetteKey, describeRequest, installCassette,
  type Cassette, type CassetteCall, type CassetteDeck, type CassetteEntry, type CassetteMiss, type CassetteMode,
} from "./cassette.js";
export {
  TRACE_SCHEMA_VERSION, TraceWriter, eventsOfKind, parseTrace, runFingerprint, runHeaderSchema, traceEventSchema,
  type RunHeader, type Trace, type TraceEvent, type TraceEventKind,
} from "./trace.js";
export {
  checkSamples, measureSamples, passRate, runVerifiers,
  type CheckOutcome, type CheckResult, type Measures, type Scorecard, type Verifier,
} from "./score.js";
export {
  Z_95, flakiness, mcnemar, mean, mulberry32, pairedBootstrap, passAtK, percentile, rate, stdev, wilson,
  type Flakiness, type Interval, type PairedComparison, type Rate,
} from "./stats.js";
export { diffTraces, renderTraceDiff, shapeKey, type DiffStep, type TraceDiff } from "./diff.js";
export {
  compare, gate, summarize,
  type CheckComparison, type CheckSummary, type Comparison, type GatePolicy, type GateVerdict, type MeasureComparison, type MeasureSummary, type Summary,
} from "./report.js";
