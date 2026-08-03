import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChallengeCodePreview, ChallengeHistorySummary } from "@spar/domain";
import type { SparApi } from "../../shared/api";

/**
 * The code excerpt a session card plates, looked up by session.
 *
 * Two rules are worth stating because both pages depend on them. The excerpt is
 * the session's *newest* challenge — the file the learner would land in on
 * opening it, rather than the one they started with. And a session with no
 * compiled challenge yet resolves to `undefined`, which is what leaves its card
 * as text alone: a plate of placeholder lines would be inventing work that does
 * not exist.
 *
 * Excerpts are fetched here rather than carried on the bootstrap. They are a page
 * of code per challenge, every launch would pay for them, and both pages render
 * perfectly well in the moment before they land.
 */
export function useSessionPreviews(api: SparApi | undefined, challenges: ChallengeHistorySummary[]) {
  const [previews, setPreviews] = useState<Record<string, ChallengeCodePreview>>({});

  useEffect(() => {
    if (!api || !challenges.length) return;
    let cancelled = false;
    void api.listChallengePreviews().then((value) => {
      if (!cancelled) setPreviews(value);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [api, challenges.length]);

  const latest = useMemo(() => {
    const bySession = new Map<string, { id: string; ordinal: number }>();
    for (const challenge of challenges) {
      const held = bySession.get(challenge.sessionId);
      if (!held || challenge.ordinal > held.ordinal) bySession.set(challenge.sessionId, { id: challenge.id, ordinal: challenge.ordinal });
    }
    return bySession;
  }, [challenges]);

  return useCallback(
    (sessionId: string) => {
      const challengeId = latest.get(sessionId)?.id;
      return challengeId ? previews[challengeId] : undefined;
    },
    [latest, previews],
  );
}
