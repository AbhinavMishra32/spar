/**
 * Which challenge intros have already played.
 *
 * The intro is an announcement — "here is the problem the agent just wrote for
 * you" — and an announcement is only true once. Keeping the answer in component
 * state made it true once *per mount*, so walking back into a challenge you had
 * already read replayed the whole two-second reveal over a problem you were in
 * the middle of solving.
 *
 * Keyed by attempt rather than by question, because restarting an attempt is a
 * fresh run at the problem and is worth marking; and stored in localStorage
 * rather than in a ref, because "I have seen this" has to survive a reload the
 * same way the learner's memory of it does.
 *
 * Bounded: the list is trimmed to the most recent ids, so a long-lived install
 * does not carry every attempt it ever opened. Anything trimmed away is an
 * attempt from hundreds of challenges ago, where replaying the reveal is not
 * the failure the user reported.
 */
const KEY = "spar.intro.seen";
const LIMIT = 400;

function read(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    /* A private window, cleared site data, or a browser that throws on access.
       Forgetting is the safe direction: the worst case is one extra reveal. */
    return [];
  }
}

export function introSeen(attemptId: string): boolean {
  return read().includes(attemptId);
}

export function markIntroSeen(attemptId: string): void {
  const seen = read();
  if (seen.includes(attemptId)) return;
  try {
    localStorage.setItem(KEY, JSON.stringify([...seen, attemptId].slice(-LIMIT)));
  } catch {
    /* Nothing to do — see above. */
  }
}
