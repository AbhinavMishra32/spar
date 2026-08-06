import { useRef, useState } from "react";
import { MessageSquare, SquareCode } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { ActiveQuestion, SessionDetail } from "@spar/domain";
import { ViewSwitch } from "@/components/ui/view-switch";
import { AgentThread } from "../agent/AgentThread";
import { Composer, ComposerPill } from "../agent/Composer";
import { ComposerModelPicker } from "../agent/ModelPicker";
import type { AgentRun } from "../agent/agentRun";
import { LanguageGlyph, LANGUAGE_LABEL } from "../common/LanguageGlyph";
import { DifficultyPill } from "./Difficulty";
import { ProblemView } from "./ProblemView";

type View = "problem" | "chat";
const ORDER: View[] = ["problem", "chat"];

/**
 * The session surface. Reading the problem and talking to the agent are the two
 * things you do here, and they compete for the same column — so they take turns
 * in it rather than stacking, and the composer stays put underneath both so a
 * question is always one click away from the statement.
 */
export function AgentPanel({
  detail,
  question,
  run,
  draft,
  onDraft,
  onSend,
  onOpenSettings,
  onOpenExternal,
  testFiles,
}: {
  detail: SessionDetail;
  question: ActiveQuestion;
  run: AgentRun | null;
  draft: string;
  onDraft(value: string): void;
  onSend(): void;
  onOpenSettings?: (() => void) | undefined;
  /** Opens a sourced challenge's problem page in the real browser. */
  onOpenExternal?: ((url: string) => void) | undefined;
  testFiles: Record<string, string>;
}) {
  const [view, setView] = useState<View>("problem");
  const busy = run?.status === "streaming";

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
        <DifficultyPill difficulty={question.difficulty} />
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
              <ProblemView onOpenExternal={onOpenExternal} question={question} testFiles={testFiles} />
            ) : (
              <AgentThread className="[--transcript-width:46rem]" messages={detail.messages} run={run} />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="shrink-0 px-4 pb-3 pt-1">
        <div className="mx-auto w-full max-w-[46rem]">
          <Composer
            busy={busy}
            leading={
              <ComposerPill title={LANGUAGE_LABEL[question.language]}>
                <LanguageGlyph className="size-3.5" language={question.language} />
              </ComposerPill>
            }
            onChange={onDraft}
            {...(onOpenSettings ? { onOpenSettings } : {})}
            // Answering lands in the transcript, so go where the answer will be.
            onSubmit={() => {
              setView("chat");
              onSend();
            }}
            placeholder="Ask for a hint, or explain your approach…"
            trailing={<ComposerModelPicker {...(onOpenSettings ? { onOpenSettings } : {})} />}
            value={draft}
          />
        </div>
      </div>
    </div>
  );
}
