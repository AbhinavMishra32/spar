import { useState } from "react";
import { Flag, Sparkles } from "lucide-react";
import type { SessionDetail } from "@spar/domain";
import type { SparApi } from "../../../shared/api";
import { message } from "@/lib/format";
import { Toolbar } from "../shell/Toolbar";
import { AgentThread, type OptimisticLearnerMessage } from "../agent/AgentThread";
import { useStopTurn } from "@/hooks/use-stop-turn";
import { useEditMessage } from "@/hooks/use-edit-message";
import { Composer } from "../agent/Composer";
import { AskUserQuestion } from "../agent/AskUserQuestion";
import { ComposerModelPicker } from "../agent/ModelPicker";
import type { AgentRun } from "../agent/agentRun";
import { expandMentions } from "../agent/Mentions";

/**
 * Between challenges. The session is open and the agent still remembers
 * everything, but nothing is being graded — so the surface is just a
 * conversation, with one way back into a challenge.
 */
export function ChatView({
  detail,
  api,
  run,
  onRefresh,
  onError,
  nav,
  onExpandSidebar,
  onOpenSettings,
}: {
  detail: SessionDetail;
  api: SparApi | undefined;
  run: AgentRun | null;
  onRefresh(): Promise<void>;
  onError(value: string): void;
  /** The window's back and forward, for the toolbar to draw while the sidebar is hidden. */
  nav?: { canBack: boolean; canForward: boolean; onBack(): void; onForward(): void } | undefined;
  onExpandSidebar?: (() => void) | undefined;
  onOpenSettings?: (() => void) | undefined;
}) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [optimisticMessages, setOptimisticMessages] = useState<OptimisticLearnerMessage[]>([]);
  const pending = detail.pendingLearnerQuestion;
  const streaming = run?.status === "streaming";
  const stop = useStopTurn(detail.summary.id, onError);
  const { undoable, edit } = useEditMessage(detail, streaming, onRefresh, onError);

  const send = async (answer?: string) => {
    const raw = (answer ?? draft).trim();
    /* The tags in the field are words; what goes out is what they stand for. */
    const body = expandMentions(raw);
    if (!api || !body) return;
    const optimistic={id:crypto.randomUUID(),body,createdAt:Date.now()};
    setOptimisticMessages((current)=>[...current,optimistic]);
    setBusy(true);
    setDraft("");
    try {
      if (answer !== undefined) await api.answerAgentQuestion({ sessionId: detail.summary.id, answer: body });
      else await api.sendAgentMessage({ sessionId: detail.summary.id, message: body });
      await onRefresh();
    } catch (error) {
      if(answer===undefined)setDraft((current)=>current||raw);
      onError(message(error));
    } finally {
      setOptimisticMessages((current)=>current.filter((item)=>item.id!==optimistic.id));
      setBusy(false);
    }
  };

  const nextChallenge = async () => {
    if (!api) return;
    setBusy(true);
    try {
      await api.requestNextChallenge({ sessionId: detail.summary.id });
      await onRefresh();
    } catch (error) {
      onError(message(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Toolbar
        actions={
          <button
            className="inline-flex h-6 items-center gap-1.5 rounded-md bg-primary px-2 text-ui font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:pointer-events-none disabled:opacity-45"
            disabled={busy || streaming}
            onClick={() => void nextChallenge()}
            type="button"
          >
            <Sparkles className="size-3" />
            New challenge
          </button>
        }
        nav={nav}
        onExpandSidebar={onExpandSidebar}
        subtitle="no active challenge"
        title={detail.summary.title}
      />

      <AgentThread
        onEditMessage={edit}
        undoable={undoable}
        header={
          <div className="rounded-xl border border-border bg-card px-3 py-2.5 shadow-[var(--app-shadow-card)]">
            <div className="flex items-center gap-2">
              <span className="grid size-6 shrink-0 place-items-center rounded-md bg-[var(--color-background-elevated-secondary)] text-muted-foreground">
                <Flag className="size-3" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-ui-sm font-medium tracking-[0.06em] text-muted-foreground/80">BETWEEN CHALLENGES</span>
                <span className="block truncate text-ui font-medium">{detail.summary.objective || detail.summary.originalGoal}</span>
              </span>
              <button
                className="shrink-0 rounded-md border border-border px-2 py-1 text-ui-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-45"
                disabled={busy || streaming}
                onClick={() => void nextChallenge()}
                type="button"
              >
                Start the next one
              </button>
            </div>
            <p className="mt-2 text-ui leading-[1.6] text-muted-foreground">
              Nothing is being graded right now. The agent still has your full history — ask it why an approach failed,
              what to read, or what it plans to test next.
            </p>
          </div>
        }
        empty={
          <div className="flex flex-col items-center px-6 text-center">
            <span className="mb-3 grid size-9 place-items-center rounded-lg border border-border bg-card text-muted-foreground">
              <Sparkles className="size-4" />
            </span>
            <p className="text-content font-medium">No challenge running</p>
            <p className="mt-1 max-w-[28rem] text-ui leading-[1.6] text-muted-foreground">
              Ask the agent anything about what you have been practising, or start your next challenge when you are ready.
            </p>
          </div>
        }
        messages={detail.messages}
        optimisticMessages={optimisticMessages}
        run={run}
      />

      <div className="shrink-0 px-4 pb-4">
        <div className="transcript-column">
          {pending ? (
            /* The agent asked something, so the question takes the composer's
               place here exactly as it does while planning. Without this the
               question was drawn as a tool row in the transcript and nowhere
               else: visible, unanswerable, and holding the turn open. */
            <AskUserQuestion busy={busy} onSubmit={(answer) => void send(answer)} request={pending} />
          ) : <Composer
            busy={busy || streaming}
            steerable={streaming && !busy}
            onChange={setDraft}
            {...(onOpenSettings ? { onOpenSettings } : {})}
            onStop={stop}
            onSubmit={() => void send()}
            placeholder="Ask the agent anything…"
            trailing={<ComposerModelPicker sessionId={detail.summary.id} {...(onOpenSettings ? { onOpenSettings } : {})} />}
            value={draft}
          />}
        </div>
      </div>
    </div>
  );
}
