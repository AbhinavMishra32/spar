import { useState } from "react";
import { Flag, Sparkles } from "lucide-react";
import type { SessionDetail } from "@spar/domain";
import type { SparApi } from "../../../shared/api";
import { message } from "@/lib/format";
import { Toolbar } from "../shell/Toolbar";
import { AgentThread } from "../agent/AgentThread";
import { Composer } from "../agent/Composer";
import { ComposerModelPicker } from "../agent/ModelPicker";
import type { AgentRun } from "../agent/agentRun";

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
  onBack,
  onExpandSidebar,
  onOpenSettings,
}: {
  detail: SessionDetail;
  api: SparApi | undefined;
  run: AgentRun | null;
  onRefresh(): Promise<void>;
  onError(value: string): void;
  onBack(): void;
  onExpandSidebar?: (() => void) | undefined;
  onOpenSettings?: (() => void) | undefined;
}) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const streaming = run?.status === "streaming";

  const send = async () => {
    const body = draft.trim();
    if (!api || !body) return;
    setBusy(true);
    setDraft("");
    try {
      await api.sendAgentMessage({ sessionId: detail.summary.id, message: body });
      await onRefresh();
    } catch (error) {
      onError(message(error));
    } finally {
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
        onBack={onBack}
        onExpandSidebar={onExpandSidebar}
        subtitle="no active challenge"
        title={detail.summary.title}
      />

      <AgentThread
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
        run={run}
      />

      <div className="shrink-0 px-4 pb-4">
        <div className="transcript-column">
          <Composer
            busy={busy || streaming}
            onChange={setDraft}
            {...(onOpenSettings ? { onOpenSettings } : {})}
            onSubmit={() => void send()}
            placeholder="Ask the agent anything…"
            trailing={<ComposerModelPicker {...(onOpenSettings ? { onOpenSettings } : {})} />}
            value={draft}
          />
        </div>
      </div>
    </div>
  );
}
