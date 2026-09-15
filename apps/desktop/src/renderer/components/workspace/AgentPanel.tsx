import { useEffect, useMemo, useRef, useState } from "react";
import { MessageSquare, SquareCode } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { ActiveQuestion, RatingPoint, SessionDetail } from "@spar/domain";
import { ViewSwitch } from "@/components/ui/view-switch";
import { AgentThread, type OptimisticLearnerMessage } from "../agent/AgentThread";
import { Composer, ComposerPill } from "../agent/Composer";
import { AskUserQuestion } from "../agent/AskUserQuestion";
import { ComposerModelPicker } from "../agent/ModelPicker";
import type { AgentRun } from "../agent/agentRun";
import { useStopTurn } from "@/hooks/use-stop-turn";
import { LanguageGlyph, LANGUAGE_LABEL } from "../common/LanguageGlyph";
import { ChallengeRatingBadge } from "./ChallengeCalibration";
import { ProblemView } from "./ProblemView";
import type { ConceptContext } from "../concepts/ConceptChip";
import { ComplexityCheckpoint, type ComplexityCheckpointState } from "./ComplexityCheckpoint";
import type { ChallengeTrail } from "./ChallengeStepper";
import { ChallengeComposerContext } from "../agent/ChallengeCardMeta";

type View = "problem" | "chat";
const ORDER: View[] = ["problem", "chat"];

/**
 * The session surface. Reading the problem and talking to the agent are the two
 * things you do here, and they compete for the same column — so they take turns
 * in it rather than stacking, and the composer stays put underneath both so a
 * question is always one click away from the statement.
 */
export function AgentPanel({
  answering,
  concepts,
  detail,
  learnerRating,
  question,
  run,
  draft,
  onDraft,
  onSend,
  onAnswer,
  onEditMessage,
  undoable,
  onOpenSettings,
  onOpenExternal,
  testFiles,
  complexityCheckpoint,
  onComplexityChange,
  onComplexityReview,
  onComplexityAcknowledge,
  optimisticMessages,
  trail,
}: {
  answering: boolean;
  concepts?: ConceptContext | undefined;
  detail: SessionDetail;
  /** The learner's rating, for pitching this problem against them. */
  learnerRating?: RatingPoint | null | undefined;
  question: ActiveQuestion;
  run: AgentRun | null;
  draft: string;
  onDraft(value: string): void;
  onSend(contextQuestionId?: string): void;
  /** Answering the agent's question, which is a message like any other — but
   *  one the composer never held, so it cannot come from the draft. */
  onAnswer(answer: string): void;
  /** Rewriting one of the learner's own messages; see `useEditMessage`. */
  onEditMessage(messageId: string, body: string): void;
  undoable: ReadonlySet<string>;
  onOpenSettings?: (() => void) | undefined;
  /** Opens a sourced challenge's problem page in the real browser. */
  onOpenExternal?: ((url: string) => void) | undefined;
  testFiles: Record<string, string>;
  complexityCheckpoint: ComplexityCheckpointState | null;
  onComplexityChange(next: Pick<ComplexityCheckpointState, "time" | "space">): void;
  onComplexityReview(): void;
  onComplexityAcknowledge(): void;
  optimisticMessages: OptimisticLearnerMessage[];
  trail?: ChallengeTrail | undefined;
}) {
  const [view, setView] = useState<View>("problem");
  const [focusRequest, setFocusRequest] = useState(0);
  const [challengeContext, setChallengeContext] = useState<ChallengeTrail["stops"][number] | null>(null);
  const actionableTrail = useMemo(() => trail ? {
    ...trail,
    onAsk: (challenge: ChallengeTrail["stops"][number]) => {
      setChallengeContext(challenge);
      setView("chat");
      setFocusRequest((value) => value + 1);
    },
  } : undefined, [trail]);
  /* Upgrade a draft produced by the first version of this action into the real
     attachment without discarding anything the learner typed after its prefix. */
  useEffect(() => {
    if (challengeContext || !trail || !draft) return;
    const legacy = trail.stops.find((challenge) => draft.startsWith(`About challenge #${challenge.ordinal}, "${challenge.title}" (question ID: ${challenge.id}): `));
    if (!legacy) return;
    const prefix = `About challenge #${legacy.ordinal}, "${legacy.title}" (question ID: ${legacy.id}): `;
    setChallengeContext(legacy);
    onDraft(draft.slice(prefix.length));
  }, [challengeContext, draft, onDraft, trail]);
  const busy = run?.status === "streaming";
  const pending = detail.pendingLearnerQuestion;
  const stop = useStopTurn(detail.summary.id);

  // The incoming view enters from the side it sits on in the switch, so the
  // motion agrees with the thumb instead of fighting it.
  const previous = useRef<View>(view);
  const direction = ORDER.indexOf(view) >= ORDER.indexOf(previous.current) ? 1 : -1;
  previous.current = view;

  // How far off resting size each view sits at the ends of the swap. Signed by
  // direction so going forward brings the arriving view down onto the surface
  // and pushes the leaving one behind it, and going back runs that inverted —
  // the pair reads as one stack, not two unrelated fades.
  const depth = direction * 0.045;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Identity stays put while the body swaps: which problem you are on is
          not a property of the view you happen to be reading it in. */}
      <div className="flex h-10 shrink-0 items-center gap-2 px-3">
        <span className="shrink-0 font-mono text-ui-sm tabular-nums text-muted-foreground/70">#{question.ordinal}</span>
        <span className="min-w-0 flex-1 truncate text-ui font-medium">{question.title}</span>
        <ChallengeRatingBadge
          conceptContext={concepts}
          concepts={question.concepts}
          difficulty={question.difficulty}
          learnerRating={learnerRating}
          source={question.source}
        />
        <ViewSwitch<View>
          ariaLabel="Panel view"
          className="ml-1 w-[12.5rem]"
          onChange={setView}
          options={[
            { value: "problem", label: "Problem", icon: SquareCode },
            {
              value: "chat",
              label: "Chat",
              icon: MessageSquare,
              // A live pulse only while the agent is working somewhere you
              // cannot see it — on the Chat tab the transcript says so itself.
              badge:
                busy && view !== "chat" ? (
                  <span className="relative flex size-1.5 shrink-0">
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-[var(--success)] opacity-75" />
                    <span className="relative inline-flex size-1.5 rounded-full bg-[var(--success)]" />
                  </span>
                ) : undefined,
            },
          ]}
          value={view}
        />
      </div>

      {/* Both views are absolutely stacked so they cross-dissolve rather than
          waiting for one another — a tab switch that takes two animations to
          finish reads as lag. The arriving view resolves out of a blur at
          slightly-too-large and settles onto its resting size, which is what
          makes it feel like it came forward instead of being swapped in. Scale
          carries the swap now, so the lateral nudge drops to a hint — just
          enough to say which way the switch went. Size and position ride a
          flat spring so they arrive without a bounce, while blur and opacity
          stay on tweens: the leaving view clears out early and fast so the two
          never sit half-visible on top of each other. */}
      <div className="relative min-h-0 flex-1">
        <AnimatePresence initial={false}>
          <motion.div
            key={view}
            animate={{ opacity: 1, filter: "blur(0px)", scale: 1, x: 0 }}
            className="absolute inset-0 flex flex-col will-change-[transform,filter,opacity]"
            exit={{
              opacity: 0,
              filter: "blur(12px)",
              scale: 1 - depth,
              x: direction * -4,
              transition: {
                default: { duration: 0.28, ease: [0.32, 0, 0.67, 0] },
                opacity: { duration: 0.16, ease: [0.4, 0, 1, 1] },
                filter: { duration: 0.22, ease: [0.4, 0, 1, 1] },
              },
            }}
            initial={{ opacity: 0, filter: "blur(12px)", scale: 1 + depth, x: direction * 4 }}
            transition={{
              default: { type: "spring", visualDuration: 0.38, bounce: 0 },
              opacity: { duration: 0.24, ease: [0.22, 0.61, 0.36, 1] },
              filter: { duration: 0.34, ease: [0.22, 0.61, 0.36, 1] },
            }}
          >
            {view === "problem" ? (
              <ProblemView concepts={concepts} learnerRating={learnerRating} onOpenExternal={onOpenExternal} question={question} testFiles={testFiles} />
            ) : (
              <AgentThread className="[--transcript-width:46rem]" currentQuestionId={question.id} messages={detail.messages} onEditMessage={onEditMessage} optimisticMessages={optimisticMessages} run={run} trail={actionableTrail} undoable={undoable} />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="shrink-0 px-4 pb-3 pt-1">
        <div className="mx-auto w-full max-w-[46rem]">
          {pending ? (
            /* A question asked while a challenge is open is asked *about* that
               challenge, and it was the one place the answer could not be given:
               the workspace drew the ask as a tool row and left the composer
               underneath it, so the turn sat waiting on an answer the learner
               had no way to send. It takes the composer's slot here as it does
               everywhere else. */
            <AskUserQuestion busy={answering} onSubmit={(answer) => { setView("chat"); onAnswer(answer); }} request={pending} />
          ) : complexityCheckpoint ? <ComplexityCheckpoint
            onAcknowledge={onComplexityAcknowledge}
            onChange={onComplexityChange}
            onReview={onComplexityReview}
            state={complexityCheckpoint}
          /> : <Composer
            focusRequest={focusRequest}
            busy={busy}
            steerable={busy}
            context={challengeContext && <ChallengeComposerContext onRemove={() => setChallengeContext(null)} stop={challengeContext} />}
            leading={
              <ComposerPill title={LANGUAGE_LABEL[question.language]}>
                <LanguageGlyph className="size-3.5" language={question.language} />
              </ComposerPill>
            }
            onChange={onDraft}
            {...(onOpenSettings ? { onOpenSettings } : {})}
            // Answering lands in the transcript, so go where the answer will be.
            onStop={stop}
            onSubmit={() => {
              setView("chat");
              onSend(challengeContext?.id);
              setChallengeContext(null);
            }}
            placeholder={challengeContext ? `Ask about ${challengeContext.title}…` : "Ask for a hint, or explain your approach…"}
            trailing={<ComposerModelPicker {...(onOpenSettings ? { onOpenSettings } : {})} />}
            value={draft}
          />}
        </div>
      </div>
    </div>
  );
}
