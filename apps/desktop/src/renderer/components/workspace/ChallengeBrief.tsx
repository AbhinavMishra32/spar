import { useMemo, type ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import type { ChallengeSource, ConceptTag, Language, Question } from "@spar/domain";
import { presentSourcedStatement } from "@/lib/sourcedStatement";
import { ChallengeEmblem } from "./ChallengeEmblem";
import { ProblemStatement } from "./ProblemStatement";
import { SourceHints } from "./SourceHints";
import { ConceptChip, conceptChipProps, type ConceptContext } from "../concepts/ConceptChip";
import { SourceBadge } from "../common/SourceBadge";

/**
 * One challenge, presented the same way wherever it is opened.
 *
 * This exists because the live challenge and a past one used to be two different
 * screens for the same thing. The workspace panel set the title at 17px over a
 * 40px emblem and went straight into the statement; the standalone page set it at
 * 1.3rem under a "CHALLENGE 4" eyebrow over a 64px emblem, and reached the
 * statement four labelled sections later. Stepping between them was a route swap
 * between two layouts, which is why it read as the screen being rebuilt rather
 * than as travel through a session — no transition could have fixed that, because
 * the two views never had a shape in common to interpolate.
 *
 * So the shape lives here and the pages own only what genuinely differs: the
 * workspace adds its sample cases, the practice page adds its session card and its
 * not-recorded notice. Anything that would look different between the two belongs
 * in `children` — which is after the statement, so the two views are identical
 * from the top of the page down to the end of the problem — and anything that
 * would not belongs in this file.
 *
 * What is deliberately *not* here is why the challenge was set. This used to end
 * with a "Why this problem" disclosure holding the training target's own
 * `specificGap` and `desiredEvidence` — Spar's internal note about what it is
 * trying to find out, shown to the learner in the vocabulary of a test plan
 * ("Evidence wanted: correctly implements and explains a typed array
 * transformation"). It read as generated because it was: the same two sentences
 * the target already held, in the same shape, under every problem. The reason a
 * problem was set for *this* learner lives in what the agent says when it hands
 * it over, where it can name the moment in their own last solve that produced it
 * — see `completionInstruction` in the worker's agent policy.
 */

/** What any surface needs to present a challenge, named rather than taken whole
 *  from one caller's model: the live challenge and a history row are different
 *  records and neither should have to pretend to be the other. */
export type ChallengeBriefData = {
  id: string;
  ordinal: number;
  title: string;
  difficulty: Question["difficulty"];
  language: Language;
  /** What Spar is using the problem to test. */
  abilityTitle: string;
  statement: string;
  source: ChallengeSource | null;
  concepts: ConceptTag[];
};

export function ChallengeBrief({
  brief,
  children,
  conceptContext,
  onOpenExternal,
}: {
  brief: ChallengeBriefData;
  /** Whatever the surface adds after the statement. */
  children?: ReactNode;
  /** What the concept chips need to preview and open. */
  conceptContext?: ConceptContext | undefined;
  /** Opens the problem at its source in the real browser. */
  onOpenExternal?: ((url: string) => void) | undefined;
}) {
  const presented = useMemo(
    () => presentSourcedStatement(brief.statement, brief.source),
    [brief.source, brief.statement],
  );

  return (
    <>
      <div className="flex items-center gap-3">
        <ChallengeEmblem className="shrink-0" question={brief} size={40} />
        <div className="min-w-0 flex-1">
          {/* The problem's name, and under it what Spar is using the problem to
              test. The eyebrow that used to sit above this said "CHALLENGE SET
              FOR YOU", which is true of every challenge in the app and so told
              nobody anything — and it pushed the title down a line to make room
              for itself. The standalone page kept a numbered version of that same
              eyebrow long after this one dropped it; the stepper in the toolbar
              already says which challenge you are on.

              Back to the display setting. The positive 0.4px this replaces was
              for a 17px title in a narrow panel, where pulling the letters
              together closed counters that were already small. The title is
              larger now and shared by both surfaces, and at this size the same
              pull is what keeps a semibold line from falling apart — the setting
              `ChallengeIntro` has always used. */}
          <p className="truncate text-content-title font-semibold tracking-[-0.015em]">{brief.title}</p>
          {brief.abilityTitle && (
            <p className="mt-0.5 truncate text-content-sm leading-[1.35] text-muted-foreground">Testing: {brief.abilityTitle}</p>
          )}
        </div>
        {brief.source && (
          <SourceBadge source={brief.source} {...(onOpenExternal ? { onOpen: onOpenExternal } : {})} />
        )}
      </div>

      {/* What it is training. These carry the same preview and the same opener as
          every other chip in the app: a chip that behaves one way in history and
          another way here is two controls wearing one face, and the moment you
          most want to know what you have already done under a concept is while
          you are stuck on a problem about it. The practice page used to draw its
          own flat chips here, which is exactly that split. */}
      {brief.concepts.length > 0 && (
        <div className="mt-3.5 flex flex-wrap gap-1.5">
          {brief.concepts.map((concept) => (
            <ConceptChip key={concept.slug} showArea tag={concept} {...conceptChipProps(conceptContext, concept.slug)} />
          ))}
        </div>
      )}

      <div className="mt-5">
        <ProblemStatement language={brief.language} source={presented.statement} />
      </div>

      {brief.source?.localRunNote && (
        <div className="mt-4 flex items-start gap-2 rounded-[var(--radius-lg)] border border-[color-mix(in_oklab,var(--warning)_30%,var(--border))] bg-[color-mix(in_oklab,var(--warning)_6%,transparent)] px-3 py-2 text-ui leading-[1.55] text-muted-foreground">
          <TriangleAlert className="mt-[0.15em] size-3.5 shrink-0 text-[var(--warning)]" />
          <p><span className="font-medium text-foreground">Local run unavailable. </span>{brief.source.localRunNote}</p>
        </div>
      )}

      {brief.source?.source === "leetcode" && (
        <SourceHints className="mt-4" hints={presented.hints} language={brief.language} />
      )}

      {children}
    </>
  );
}
