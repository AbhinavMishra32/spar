import { useState } from "react";
import { NotebookPen } from "lucide-react";
import type { ActiveQuestion, SessionDetail } from "@spar/domain";
import { cn } from "@/lib/utils";
import { AgentThread } from "../agent/AgentThread";
import { Composer, ComposerPill } from "../agent/Composer";
import type { AgentRun } from "../agent/agentRun";
import { DifficultyPill, ProblemCard } from "./ProblemCard";

/**
 * The session surface. The challenge, the agent's live reasoning, and the
 * conversation are one continuous stream — the problem is something the agent
 * handed over, not a static reference panel sitting beside a chat.
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
}) {
  const [remarkOpen, setRemarkOpen] = useState(false);
  const busy = run?.status === "streaming";

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--color-background-surface)]">
      {/* Always-visible identity for the problem, even when the card is scrolled away. */}
      <div className="hairline-b flex h-8 shrink-0 items-center gap-2 px-3">
        <span className="shrink-0 font-mono text-ui-sm tabular-nums text-muted-foreground/70">
          #{question.ordinal}
        </span>
        <span className="min-w-0 flex-1 truncate text-ui font-medium">{question.title}</span>
        <DifficultyPill difficulty={question.difficulty} />
      </div>

      <AgentThread
        className="[--transcript-width:46rem]"
        header={<ProblemCard question={question} />}
        messages={detail.messages}
        run={run}
      />

      {remarkOpen && (
        <div className="shrink-0 border-t border-border px-4 py-2">
          <div className="mx-auto w-full max-w-[46rem]">
            <label className="mb-1.5 block text-ui-sm font-medium text-muted-foreground" htmlFor="learner-remark">
              Learner remark — recorded on the attempt, not sent to the agent
            </label>
            <textarea
              className="app-scroll block h-16 w-full resize-none rounded-lg border border-border bg-background px-2 py-1.5 text-ui outline-none transition-colors placeholder:text-muted-foreground/70 focus-visible:border-[var(--border-strong)]"
              id="learner-remark"
              onChange={(event) => onRemark(event.target.value)}
              placeholder="What are you thinking or uncertain about?"
              value={remark}
            />
            <button
              className="mt-1.5 h-6 rounded-md px-2 text-ui text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-45"
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
                  icon={NotebookPen}
                  onClick={() => setRemarkOpen((value) => !value)}
                  title="Attach a private remark to this attempt"
                >
                  <span className={cn(remarkOpen && "text-foreground")}>Remark</span>
                </ComposerPill>
              </>
            }
            onChange={onDraft}
            onSubmit={onSend}
            placeholder="Ask for a hint, or explain your approach…"
            value={draft}
          />
        </div>
      </div>
    </div>
  );
}
