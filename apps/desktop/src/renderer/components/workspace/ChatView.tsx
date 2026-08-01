import { useState } from "react";
import { Flag, Sparkles } from "lucide-react";
import type { SessionDetail } from "@pracai/domain";
import type { PracticeApi } from "../../../shared/api";
import { message } from "@/lib/format";
import { Toolbar } from "../shell/Toolbar";
import { AgentThread } from "../agent/AgentThread";
import { Composer } from "../agent/Composer";
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
}: {
  detail: SessionDetail;
  api: PracticeApi | undefined;
  run: AgentRun | null;
  onRefresh(): Promise<void>;
  onError(value: string): void;
  onBack(): void;
  onExpandSidebar?: (() => void) | undefined;
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
        empty={
          <div className="flex flex-col items-center px-6 text-center">
            <span className="mb-3 grid size-9 place-items-center rounded-lg border border-border bg-card text-muted-foreground">
              <Sparkles className="size-4" />
            </span>
            <p className="text-content font-medium">No challenge running</p>
            <p className="mt-1 max-w-[28rem] text-ui leading-[1.6] text-muted-foreground">
              Ask the agent anything about what you have been practising, or start the next challenge when you are ready.
            </p>
          </div>
        }
        messages={detail.messages}
        run={run}
      />

      <div className="shrink-0 px-4 pb-4">
        <div className="transcript-column">
          {detail.messages.some((item) => item.body.startsWith("The learner gave up")) && (
            <div className="mb-2 flex items-center gap-2 px-1.5 text-ui-sm text-muted-foreground">
              <Flag className="size-3 shrink-0" />
              That challenge was set aside. The agent keeps it as evidence when choosing the next one.
            </div>
          )}
          <Composer
            busy={busy || streaming}
            onChange={setDraft}
            onSubmit={() => void send()}
            placeholder="Ask the agent anything…"
            value={draft}
          />
        </div>
      </div>
    </div>
  );
}
