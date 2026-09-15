/** File maps are patched by path; every other supplied top-level field replaces
 * its retained value. This is the small edit boundary used after compilation. */
const QUESTION_FILE_MAPS = new Set(["starterFiles", "referenceFiles", "visibleTests", "hiddenTests"]);

export function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
}

export function mergeQuestionChanges(candidate: Record<string, unknown>, changes: Record<string, unknown>): Record<string, unknown> {
  const merged = { ...candidate };
  for (const [key, next] of Object.entries(changes)) {
    if (QUESTION_FILE_MAPS.has(key) && next && typeof next === "object" && !Array.isArray(next)) {
      merged[key] = { ...objectRecord(merged[key]), ...objectRecord(next) };
    } else {
      merged[key] = next;
    }
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
