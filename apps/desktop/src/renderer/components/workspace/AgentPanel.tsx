import { useRef, useState } from "react";
import { MessageSquare, NotebookPen, SquareCode } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { ActiveQuestion, SessionDetail } from "@spar/domain";
import { ViewSwitch } from "@/components/ui/view-switch";
import { AgentThread } from "../agent/AgentThread";
import { Composer, ComposerPill } from "../agent/Composer";
import { ComposerModelPicker } from "../agent/ModelPicker";
import type { AgentRun } from "../agent/agentRun";
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
  remark,
  onRemark,
  onAttachRemark,
  onOpenSettings,
  testFiles,
}: {
  detail: SessionDetail;
  question: ActiveQuestion;
  run: AgentRun | null;
  draft: string;
  onDraft(value: string): void;
  onSend(): void;
  remark: string;
  onRemark(value: string): void;
  onAttachRemark(): void;
  onOpenSettings?: (() => void) | undefined;
  testFiles: Record<string, string>;
}) {
  const [remarkOpen, setRemarkOpen] = useState(false);
  const [view, setView] = useState<View>("problem");
  const busy = run?.status === "streaming";

  // The incoming view enters from the side it sits on in the switch, so the
  // motion agrees with the thumb instead of fighting it.
  const previous = useRef<View>(view);
  const direction = ORDER.indexOf(view) >= ORDER.indexOf(previous.current) ? 1 : -1;
  previous.current = view;

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--color-background-surface)]">
      {/* Identity stays put while the body swaps: which problem you are on is
          not a property of the view you happen to be reading it in. */}
      <div className="hairline-b flex h-10 shrink-0 items-center gap-2 px-2.5">
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
          finish reads as lag. Blur carries the swap; opacity alone looks like a
          dropped frame at this duration. */}
      <div className="relative min-h-0 flex-1">
        <AnimatePresence initial={false}>
          <motion.div
            key={view}
            animate={{ opacity: 1, filter: "blur(0px)", x: 0 }}
            className="absolute inset-0 flex flex-col"
            exit={{ opacity: 0, filter: "blur(10px)", x: direction * -10 }}
            initial={{ opacity: 0, filter: "blur(10px)", x: direction * 10 }}
            transition={{ duration: 0.26, ease: [0.22, 0.61, 0.36, 1] }}
          >
            {view === "problem" ? (
              <ProblemView question={question} testFiles={testFiles} />
            ) : (
              <AgentThread className="[--transcript-width:46rem]" messages={detail.messages} run={run} />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {remarkOpen && (
        <div className="shrink-0 border-t border-border px-4 py-2">
          <div className="mx-auto w-full max-w-[46rem]">
            <label className="mb-1.5 block text-ui-sm font-medium text-muted-foreground" htmlFor="learner-remark">
              Learner remark — recorded on the attempt, not sent to the agent
            </label>
            <textarea
              className="app-scroll block h-16 w-full resize-none rounded-[var(--radius-lg)] border border-border bg-background px-2 py-1.5 text-ui outline-none transition-colors placeholder:text-muted-foreground/70 focus-visible:border-[var(--border-strong)]"
              id="learner-remark"
              onChange={(event) => onRemark(event.target.value)}
              placeholder="What are you thinking or uncertain about?"
              value={remark}
            />
            <button
              className="mt-1.5 h-6 rounded-[var(--radius-md)] px-2 text-ui text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-45"
              disabled={!remark.trim()}
              onClick={onAttachRemark}
              type="button"
            >
              Attach to attempt
            </button>
          </div>
        </div>
      )}

      <div className="shrink-0 px-4 pb-3 pt-1">
        <div className="mx-auto w-full max-w-[46rem]">
          <Composer
            busy={busy}
            hint={busy ? "The agent is working…" : undefined}
            leading={
              <>
                <ComposerPill>{question.language}</ComposerPill>
                <ComposerPill
                  active={remarkOpen}
                  icon={NotebookPen}
                  onClick={() => setRemarkOpen((value) => !value)}
                  title="Attach a private remark to this attempt"
                >
                  Remark
                </ComposerPill>
              </>
            }
            onChange={onDraft}
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
