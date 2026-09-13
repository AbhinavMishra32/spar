/**
 * How many cases a challenge's suites turned out to have, last time they ran.
 *
 * The dot grid is the loader, so it has to be the right size *before* the run
 * that would tell it — a grid that learns its size from its results can only be
 * drawn once they are in, which is too late to have been the thing you were
 * watching. For a visible run the size is already known: the test file is on the
 * learner's disk and the panel parses it. For a submission it is not, and cannot
 * be. Hidden suites are generated sweeps — a seeded loop over inputs against a
 * brute-force oracle, twenty-four cases minimum and usually many more — so the
 * count exists only once the loop has run. There is nothing to parse.
 *
 * So the panel remembers instead. After a submission the real number is known
 * for good, and every later run of that challenge draws its grid at the right
 * size from the first frame. The number is a property of the challenge rather
 * than of a session, which is why it is in localStorage and not a ref: closing
 * the app is not a reason to have to watch the grid guess again.
 *
 * Kept apart per mode, because they are different suites. Running the visible
 * cases and submitting to the hidden ones are three dots and thirty-five, and
 * remembering one number for both means every run redraws at the other's size.
 */
/* Versioned, and deliberately started over once. The first version of the panel
   around this wrote sizes from runs that were still in flight and from mounts
   that had not run anything at all, so an install that saw those builds is
   carrying numbers that were never a suite's size — a partial count filed as the
   whole, or a hidden sweep's total filed under the examples. There is no way to
   tell a bad entry from a good one by looking at it, and the cost of discarding
   them all is one run per challenge with an honest loader. */
const KEY = "spar.suite.size.v2";
const LIMIT = 400;

type Sizes = Record<string, number>;

function read(): Sizes {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    return Object.fromEntries(
      Object.entries(raw as Record<string, unknown>).filter(
        (entry): entry is [string, number] => Number.isInteger(entry[1]) && (entry[1] as number) > 0,
      ),
    );
  } catch {
    /* A private window, cleared site data, or a browser that throws on access.
       Forgetting is the safe direction: the worst case is one run whose loader
       has no grid, which is exactly where this started. */
    return {};
  }
}

const slot = (questionId: string, hidden: boolean) => `${questionId}:${hidden ? "hidden" : "visible"}`;

/** The remembered size, or 0 for a suite that has never finished a run here. */
export function knownSuiteSize(questionId: string, hidden: boolean): number {
  return read()[slot(questionId, hidden)] ?? 0;
}

export function rememberSuiteSize(questionId: string, hidden: boolean, count: number): void {
  if (!Number.isInteger(count) || count <= 0) return;
  const sizes = read();
  const key = slot(questionId, hidden);
  if (sizes[key] === count) return;
  try {
    /* Bounded the same way the intro list is: oldest entries fall off, and an
       entry that falls off is a challenge from hundreds ago whose next run pays
       one gridless loader to learn its size again. */
    const trimmed = Object.entries({ ...sizes, [key]: count }).slice(-LIMIT);
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(trimmed)));
  } catch {
    /* Nothing to do — see above. */
  }
}
