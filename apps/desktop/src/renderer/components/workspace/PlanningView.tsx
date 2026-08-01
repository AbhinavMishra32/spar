import { useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { ChevronDown, ChevronUp, Sparkles } from "lucide-react";
import type { SessionDetail } from "@pracai/domain";
import type { PracticeApi } from "../../../shared/api";
import { cn } from "@/lib/utils";
import { message } from "@/lib/format";
import { Toolbar, ToolbarButton } from "../shell/Toolbar";
import { AgentThread } from "../agent/AgentThread";
import { Composer } from "../agent/Composer";
import { RuntimeConsole, type RuntimeLog } from "../agent/RuntimeConsole";
import type { AgentRun } from "../agent/agentRun";

const STAGES = ["History retrieval", "Target selection", "Challenge compilation", "Deterministic validation"];

/** Shown while a session has no playable challenge — the agent is still deciding what to test. */
export function PlanningView({
  detail,
  api,
  logs,
  run,
  onRefresh,
  onError,
  onBack,
  onExpandSidebar,
}: {
  detail: SessionDetail;
  api: PracticeApi | undefined;
  logs: RuntimeLog[];
  run: AgentRun | null;
  onRefresh(): Promise<void>;
  onError(value: string): void;
  onBack(): void;
  onExpandSidebar?: (() => void) | undefined;
}) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [traceOpen, setTraceOpen] = useState(false);
  const pending = detail.pendingLearnerQuestion;

  const send = async () => {
    const body = draft.trim();
    if (!api || !body) return;
    setBusy(true);
    try {
      setDraft("");
      await api.sendAgentMessage({ sessionId: detail.summary.id, message: body });
      await onRefresh();
    } catch (error) {
      onError(message(error));
    } finally {
      setBusy(false);
    }
  };

  const streaming = run?.status === "streaming";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Toolbar
        actions={
          <ToolbarButton
            active={traceOpen}
            icon={traceOpen ? ChevronDown : ChevronUp}
            label="Trace"
            onClick={() => setTraceOpen((value) => !value)}
          />
        }
        onBack={onBack}
        onExpandSidebar={onExpandSidebar}
        subtitle={detail.summary.status}
        title={detail.summary.title}
      />

      <PanelGroup className="min-h-0 flex-1" direction="vertical">
        <Panel minSize={30} order={1}>
          <div className="flex h-full min-h-0 flex-col">
            <AgentThread
              empty={
                <div className="flex flex-col items-center pt-10 text-center">
                  <span className="relative mb-4 grid size-12 place-items-center rounded-full border border-border bg-card">
                    <Sparkles className="size-5 text-muted-foreground" />
                    <span className="pointer-events-none absolute -inset-1.5 rounded-full border border-dashed border-border [animation:agent-orbit_12s_linear_infinite]" />
                  </span>
                  <h2 className="max-w-[34rem] text-[1.15rem] font-semibold tracking-[-0.02em]">
                    {detail.summary.objective || detail.summary.originalGoal}
                  </h2>
                  <p className="mt-1.5 max-w-[32rem] text-content leading-[1.6] text-muted-foreground">
                    The agent is retrieving relevant learner evidence, defining one target, generating a challenge, and running
                    deterministic checks before you see it.
                  </p>
                  <div className="mt-5 flex flex-wrap justify-center gap-1.5">
                    {STAGES.map((stage) => (
                      <span
                        key={stage}
                        className="rounded-md border border-border bg-card px-2 py-1 text-ui-sm text-muted-foreground"
                      >
                        {stage}
                      </span>
                    ))}
                  </div>
                </div>
              }
              messages={detail.messages}
              run={run}
            />

            <div className="shrink-0 px-4 pb-4">
              <div className="transcript-column">
                {pending && (
                  <div className="mb-2 rounded-xl border border-border bg-[var(--color-background-elevated-secondary)] px-3 py-2.5">
                    <p className="text-ui-sm font-medium tracking-[0.06em] text-muted-foreground/80">PLACEMENT CHECK</p>
                    <p className="mt-1 text-content leading-[1.6]">{pending}</p>
                    <p className="mt-1.5 text-ui text-muted-foreground">
                      Your goal says what you want to learn, not what you already know. This answer sets the first challenge&apos;s
                      assumptions.
                    </p>
                  </div>
                )}
                <Composer
                  autoFocus={Boolean(pending)}
                  busy={busy || streaming}
                  onChange={setDraft}
                  onSubmit={() => void send()}
                  placeholder={pending ? "Describe what you know, or just say “none yet”." : "Send the agent a note…"}
                  value={draft}
                />
              </div>
            </div>
          </div>
        </Panel>

        {traceOpen && (
          <>
            <PanelResizeHandle className="h-px shrink-0 cursor-row-resize bg-border transition-colors hover:bg-[var(--border-strong)]" />
            <Panel defaultSize={28} maxSize={60} minSize={12} order={2}>
              <div className="flex h-full flex-col bg-[var(--color-background-surface-under)]">
                <div className="hairline-b flex h-7 shrink-0 items-center justify-between px-3">
                  <span className="text-ui-sm font-medium tracking-[0.06em] text-muted-foreground/70">
                    UTILITY PROCESS TRACE
                  </span>
                  <span className={cn("text-ui-sm tabular-nums", streaming ? "text-[var(--success)]" : "text-muted-foreground/60")}>
                    {logs.length} lines
                  </span>
                </div>
                <RuntimeConsole className="flex-1" logs={logs} />
              </div>
            </Panel>
          </>
        )}
      </PanelGroup>
    </div>
  );
}
