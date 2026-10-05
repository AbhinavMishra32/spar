/** File maps are patched by path. A null patch value removes an old path, which
 * is required when a repair renames a test; every other field replaces its
 * retained value. */
const QUESTION_FILE_MAPS = new Set(["starterFiles", "referenceFiles", "visibleTests", "hiddenTests"]);

export function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
}

/**
 * Merge a repair patch into a candidate.
 *
 * `owned` is what the coach's brief decided — language, kind, difficulty,
 * concepts, the training target and the like. A repair is there to make the
 * design agree with itself, not to change what was asked for, so those fields
 * are put back after the patch whatever it said about them. An owned key whose
 * value is undefined is one the brief left unset, and stays unset.
 */
export function mergeQuestionChanges(candidate: Record<string, unknown>, changes: Record<string, unknown>, owned: Record<string, unknown> = {}): Record<string, unknown> {
  const merged = { ...candidate };
  for (const [key, next] of Object.entries(changes)) {
    if (QUESTION_FILE_MAPS.has(key) && next && typeof next === "object" && !Array.isArray(next)) {
      const files = { ...objectRecord(merged[key]) };
      for (const [path, source] of Object.entries(objectRecord(next))) {
        if (source === null) delete files[path];
        else files[path] = source;
      }
      merged[key] = files;
    } else {
      merged[key] = next;
    }
  }
  for (const [key, value] of Object.entries(owned)) {
    if (value === undefined) delete merged[key];
    else merged[key] = value;
  }
  return merged;
}

/** Accept a bare JSON object and tolerate the two common wrappers models add
 * despite being asked not to: a fenced block and a `changes` envelope. */
export function parseRepairChanges(text: string): Record<string, unknown> | null {
  const clean = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(clean.slice(start, end + 1));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    return objectRecord(record.changes ?? record);
  } catch {
    return null;
  }
}

/** Keep one rejected tool call alive while the model repairs its candidate.
 * Invalid JSON is feedback for the next repair attempt, not a terminal result. */
export async function repairQuestionUntilValid(
  initialInput: unknown,
  initialResult: unknown,
  options: {
    limit: number;
    signal: AbortSignal;
    failedChecks(value: unknown): string[];
    playable(value: unknown): boolean;
    complete(candidate: Record<string, unknown>, failures: string[], feedback: string): Promise<string>;
    validate(candidate: Record<string, unknown>): Promise<unknown>;
    progress(detail: string): void;
    /** Brief-owned fields re-applied after every merge; see mergeQuestionChanges. */
    owned?: Record<string, unknown>;
  },
): Promise<{ input: Record<string, unknown>; value: unknown; attempts: number; repairError: string | null; providerError: string | null }> {
  let candidate = objectRecord(initialInput);
  let value = initialResult;
  let attempts = 0;
  let repairError: string | null = null;
  /* The repair model's call itself failed — the provider, not the design. Kept
     apart from repairError so the coach can be told which of the two it was. */
  let providerError: string | null = null;
  let responseFeedback = "";
  while (attempts < options.limit && !options.playable(value)) {
    if (options.signal.aborted) throw options.signal.reason;
    const failures = options.failedChecks(value);
    if (!failures.length || failures.some((failure) => failure.startsWith("session lifecycle:"))) break;
    attempts += 1;
    try {
      options.progress(attempts === 1 ? "Repairing one failed validation" : `Repairing validation issue ${attempts}`);
      let answer: string;
      try {
        answer = await options.complete(candidate, failures, responseFeedback);
      } catch (error) {
        if (options.signal.aborted) throw error;
        providerError = error instanceof Error ? error.message : String(error);
        repairError = providerError;
        break;
      }
      const changes = parseRepairChanges(answer);
      if (!changes || !Object.keys(changes).length) {
        responseFeedback = "It contained no usable JSON changes";
        repairError = responseFeedback;
        continue;
      }
      const revised = mergeQuestionChanges(candidate, changes, options.owned);
      if (JSON.stringify(revised) === JSON.stringify(candidate)) {
        responseFeedback = "It did not change the rejected candidate";
        repairError = responseFeedback;
        continue;
      }
      candidate = revised;
      responseFeedback = "";
      repairError = null;
      options.progress(attempts === 1 ? "Validating the repaired challenge" : `Validating repair ${attempts}`);
      value = await options.validate(candidate);
    } catch (error) {
      if (options.signal.aborted) throw error;
      repairError = error instanceof Error ? error.message : String(error);
      break;
    }
  }
  return { input: candidate, value, attempts, repairError, providerError };
}
