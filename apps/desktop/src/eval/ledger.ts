import type { LocalStore } from "../main/store.js";
import type { LedgerSnapshot } from "./types.js";

/**
 * What Spar believes, read off the store.
 *
 * Every read here is guarded, and the guards are the feature rather than
 * defensive habit. The comparison harness runs this same file against an older
 * checkout of Spar where `currentRating` does not exist and patterns are written
 * but never read back — and a snapshot that threw on the missing method would
 * report the baseline as *broken* when the finding is that the baseline was
 * *blind*. Those are different results and only one of them is true.
 *
 * So: a capability that is absent reads as absent, and the verifier that cares
 * says so in its own words. Nothing here decides whether that is good or bad.
 */

type Loose = Record<string, unknown>;

function call<T>(store: LocalStore, method: string, args: unknown[], fallback: T): T {
  const candidate = (store as unknown as Loose)[method];
  if (typeof candidate !== "function") return fallback;
  try {
    return (candidate as (...values: unknown[]) => T).apply(store, args);
  } catch {
    /* A read that throws is treated as a read that is not there. The alternative
       is one bad row in one table taking down a snapshot that twelve verifiers
       were about to read, and none of them would have cared about that row. */
    return fallback;
  }
}

export function snapshot(store: LocalStore): LedgerSnapshot {
  const abilities = call<Array<Loose>>(store, "abilityStates", [], []);
  const patterns = call<Array<Loose>>(store, "listPatterns", [], []);
  const rating = call<Loose | null>(store, "currentRating", [], null) ?? call<Array<Loose>>(store, "ratingHistory", [], []).at(-1) ?? null;
  return {
    abilities: abilities.map((row) => ({
      title: String(row.title ?? ""),
      /* The document's word, which is the agent's judgement, rather than the
         training status the state row derives from it. Both are carried: the
         eval is largely about whether they agree. */
      status: String(call<Loose | null>(store, "readAbility", [String(row.abilityId ?? "")], null)?.status ?? ""),
      proficiency: Number(row.proficiency ?? 0),
      confidence: Number(row.confidence ?? 0),
      evidenceCount: Number(row.evidenceCount ?? 0),
      trainingStatus: String(row.trainingStatus ?? ""),
    })),
    patterns: patterns.map((row) => ({
      title: String(row.title ?? ""),
      status: String(row.status ?? ""),
      abilityTitle: String(row.abilityTitle ?? ""),
      evidenceCount: Number(row.evidenceCount ?? 0),
    })),
    evidence: abilities.flatMap((row) =>
      call<Array<Loose>>(store, "evidenceForAbility", [String(row.abilityId ?? "")], []).map((item) => ({
        abilityTitle: String(row.title ?? ""),
        statement: String(item.statement ?? ""),
        polarity: String(item.polarity ?? ""),
        independence: String(item.independence ?? ""),
        strength: Number(item.strength ?? 0),
      })),
    ),
    rating: rating ? { rating: Number(rating.rating ?? 0), deviation: Number(rating.deviation ?? 0), provisional: Boolean(rating.provisional ?? Number(rating.deviation ?? 0) > 110) } : null,
    notices: call<Array<Loose>>(store, "listNotices", [20], []).map((row) => String(row.title ?? "")),
  };
}

/** Whether this build of Spar can do a thing at all, asked once and recorded on
 *  the run so a report can say *why* an arm scored the way it did rather than
 *  only that it did. */
export function capabilities(store: LocalStore): Record<string, boolean> {
  const has = (method: string) => typeof (store as unknown as Loose)[method] === "function";
  return {
    readsPatternsBack: has("patternsForAbility"),
    searchesBehaviouralMemory: has("searchLearnerMemory"),
    decaysStaleAbilities: has("decayAbilities"),
    ratesAgainstProblems: has("currentRating"),
  };
}
