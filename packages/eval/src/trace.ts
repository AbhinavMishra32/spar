import { z } from "zod";
import { digest } from "./hash.js";

/**
 * What a run did, in enough detail to score it, replay it, and diff it against
 * another run.
 *
 * Three consumers, and they want different things, which is why this is one
 * stream of typed events rather than three purpose-built records:
 *
 * - **Scoring** wants the outcomes — what the host admitted, what the ledger
 *   ended up saying.
 * - **Replay** wants the model exchanges, keyed by request rather than by step
 *   number, so a rerun that takes a different route still finds them.
 * - **Diffing** wants the shape — the sequence of stages and calls — and wants
 *   it stable enough that two runs of the same scenario differ only where they
 *   genuinely behaved differently.
 *
 * The third is the one that constrains the format. Every field that varies
 * between two identical runs is noise in a diff, and noise in a diff is what
 * makes people stop reading diffs. So wall-clock timestamps are kept only on the
 * header, everything else is milliseconds since the run started, and identifiers
 * the host generates at random are never compared directly — they are indexed
 * per run (`#1`, `#2`) so that two runs can be aligned at all.
 *
 * Latency is recorded and deliberately excluded from the structural diff: it is a
 * measurement of the machine rather than of the agent, and folding it in would
 * make every run differ from every other.
 */

export const TRACE_SCHEMA_VERSION = 1;

/** Which side of a comparison a run belongs to. `arm` is free text — a git ref,
 *  a model id, a config name — because the framework has no opinion about what
 *  you are comparing, only that two things are being compared. */
export const runHeaderSchema = z.object({
  schemaVersion: z.literal(TRACE_SCHEMA_VERSION),
  runId: z.string().min(1),
  scenario: z.string().min(1),
  /** The seed every deliberate random choice in this run was drawn from. A run
   *  without one is not reproducible and is marked as such rather than pretending
   *  a number it never used. */
  seed: z.number().int().nonnegative(),
  arm: z.string().min(1),
  /** How the model was obtained: really called, replayed from a recording, or
   *  scripted by the scenario with no model involved at all. Scores from
   *  different modes are not comparable and the mode travels with the run so
   *  nobody has to remember which was which. */
  mode: z.enum(["scripted", "replay", "live"]),
  model: z.string().default(""),
  startedAt: z.string().min(1),
  /** Anything else that would change the result and is not already a field —
   *  provider, temperature, a feature flag. Hashed into the run's identity by
   *  `runFingerprint`, so a comparison can refuse to compare unlike things. */
  config: z.record(z.unknown()).default({}),
});
export type RunHeader = z.infer<typeof runHeaderSchema>;

const base = { seq: z.number().int().nonnegative(), atMs: z.number().int().nonnegative() };

/**
 * One thing that happened.
 *
 * `step` is the controller's phase counter, not a line number: several events
 * share one step, and that grouping is what makes a diff readable — "step 4
 * called a different tool" rather than eleven separate divergences.
 */
export const traceEventSchema = z.discriminatedUnion("kind", [
  z.object({ ...base, kind: z.literal("turn_started"), turnKind: z.string(), session: z.string() }),
  /** The controller's decision, before the model is asked anything. This is the
   *  spine a diff aligns on: Spar's stage sequence is deterministic given the
   *  outcomes so far, so two runs that diverge here diverged for a reason. */
  z.object({ ...base, kind: z.literal("stage"), step: z.number().int(), activeTools: z.array(z.string()), toolChoice: z.string() }),
  z.object({ ...base, kind: z.literal("model_request"), step: z.number().int(), requestHash: z.string(), toolChoice: z.string(), promptChars: z.number().int() }),
  z.object({
    ...base, kind: z.literal("model_response"), step: z.number().int(), requestHash: z.string(), responseHash: z.string(),
    calls: z.array(z.string()), latencyMs: z.number().int(), replayed: z.boolean().default(false),
    usage: z.object({ inputTokens: z.number().int(), outputTokens: z.number().int(), cachedInputTokens: z.number().int().default(0) }).optional(),
  }),
  z.object({ ...base, kind: z.literal("tool_call"), step: z.number().int(), name: z.string(), inputHash: z.string(), input: z.unknown() }),
  /** The host's answer, and the part of it that is a judgement. `checks` is
   *  copied out verbatim because it is the single richest label in Spar: the
   *  host already decides whether a candidate discriminates the misconception,
   *  whether a problem is in the learner's window, whether a pattern may be
   *  promoted — and the eval scores those rather than guessing at them. */
  z.object({
    ...base, kind: z.literal("tool_result"), step: z.number().int(), name: z.string(), ok: z.boolean(),
    status: z.string().default(""), outputHash: z.string(),
    checks: z.array(z.object({ name: z.string(), passed: z.boolean(), detail: z.string().default("") })).default([]),
  }),
  /** The simulated learner doing something. Scripted by the scenario, so its
   *  ground truth — which misconception this submission carries — is known
   *  rather than inferred. */
  z.object({
    ...base, kind: z.literal("attempt"), attempt: z.string(), outcome: z.enum(["passed", "failed", "abandoned", "replaced"]),
    hints: z.number().int().default(0), submissions: z.number().int().default(1), misconception: z.string().default(""),
  }),
  /** What Spar believed at this moment. The trajectory evals are scored on the
   *  sequence of these rather than on the last one: when Spar arrived at the
   *  right reading is as interesting as whether it did. */
  z.object({ ...base, kind: z.literal("ledger"), label: z.string(), snapshot: z.unknown() }),
  z.object({ ...base, kind: z.literal("reply"), chars: z.number().int(), textHash: z.string(), text: z.string().default("") }),
  z.object({ ...base, kind: z.literal("note"), text: z.string() }),
  z.object({ ...base, kind: z.literal("error"), message: z.string(), fatal: z.boolean().default(false) }),
]);
export type TraceEvent = z.infer<typeof traceEventSchema>;
export type TraceEventKind = TraceEvent["kind"];

export type Trace = { header: RunHeader; events: TraceEvent[] };

/**
 * A run's identity for the purpose of "may these be compared".
 *
 * Scenario, seed and mode — deliberately not `arm`, which is the thing that is
 * supposed to differ, and deliberately not the model, because comparing two
 * models on the same scenario is a comparison somebody legitimately wants. Two
 * runs with different fingerprints are not two measurements of the same thing,
 * and `compare` says so rather than subtracting them.
 */
export function runFingerprint(header: RunHeader): string {
  return digest({ scenario: header.scenario, seed: header.seed, mode: header.mode, config: header.config });
}

/**
 * The writer.
 *
 * Sequence and relative time are assigned here rather than by callers, because a
 * caller that assigns its own gets them wrong under concurrency and a trace whose
 * ordering is a lie is worse than one with no ordering at all. The clock is
 * injectable so the framework's own tests produce byte-identical traces.
 */
/** One event as a caller writes it: the whole union, with the two fields the
 *  writer owns removed from each member separately. `Omit` over a union applied
 *  in one go keeps only the keys every member shares, which would reduce this to
 *  `{ kind }` and accept anything. */
type Emitted = TraceEvent extends infer E ? (E extends unknown ? Omit<E, "seq" | "atMs"> : never) : never;

export class TraceWriter {
  private readonly events: TraceEvent[] = [];
  private readonly startedMs: number;
  private seq = 0;

  constructor(readonly header: RunHeader, private readonly now: () => number = Date.now) {
    this.startedMs = this.now();
  }

  emit(event: Emitted): void {
    const parsed = traceEventSchema.parse({ ...(event as object), seq: this.seq, atMs: Math.max(0, this.now() - this.startedMs) });
    this.seq += 1;
    this.events.push(parsed);
  }

  trace(): Trace {
    return { header: this.header, events: [...this.events] };
  }

  /** JSON Lines: header first, then one event per line. Append-only and readable
   *  with `head`, which matters more than compactness for something a person
   *  reaches for when a run went wrong. */
  toJsonl(): string {
    return [JSON.stringify(this.header), ...this.events.map((event) => JSON.stringify(event))].join("\n") + "\n";
  }
}

export function parseTrace(jsonl: string): Trace {
  const lines = jsonl.split("\n").filter((line) => line.trim().length > 0);
  const [first, ...rest] = lines;
  if (!first) throw new Error("A trace needs at least its header line");
  return { header: runHeaderSchema.parse(JSON.parse(first)), events: rest.map((line) => traceEventSchema.parse(JSON.parse(line))) };
}

/** Every event of one kind, typed. Used everywhere a verifier wants "all the tool
 *  results" without restating the discriminated-union narrowing each time. */
export function eventsOfKind<K extends TraceEventKind>(trace: Trace, kind: K): Array<Extract<TraceEvent, { kind: K }>> {
  return trace.events.filter((event): event is Extract<TraceEvent, { kind: K }> => event.kind === kind);
}
