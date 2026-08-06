import type { ChallengeSource } from "@spar/domain";
import { judgeInputBlock } from "@spar/practice";

/**
 * The cases a run at the source has to be posted with.
 *
 * A remote run is only a run because it names what it is running. LeetCode
 * answers an empty case block with status 10, `correct_answer: true` and no
 * cases at all — so a solution that returned 0 for everything came back green,
 * with nothing to show for it. Nothing downstream can recover from that: there
 * are no cases to draw, so the result panel has a verdict and no evidence.
 *
 * The challenge is asked first and the source second. A challenge mounted before
 * its cases travelled on it carries none, and there are real ones open on
 * learners' screens; falling back to the source heals those in place rather than
 * making somebody re-mount the problem to get a working Run.
 *
 * An empty answer is a refusal, not a request to send nothing.
 */
export async function judgeCaseBlock(
  source: Pick<ChallengeSource, "slug" | "cases">,
  fromSource: (slug: string) => Promise<string>,
): Promise<string> {
  const carried = judgeInputBlock(source.cases ?? []).trim();
  if (carried) return carried;
  return (await fromSource(source.slug).catch(() => "")).trim();
}
