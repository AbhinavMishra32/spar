import { useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { ChevronDown, ChevronUp } from "lucide-react";
import { ThinkingOrb, type OrbState } from "thinking-orbs";
import type { SessionDetail } from "@spar/domain";
import type { SparApi } from "../../../shared/api";
import { cn } from "@/lib/utils";
import { message } from "@/lib/format";
import { Toolbar, ToolbarButton } from "../shell/Toolbar";
import { AgentThread } from "../agent/AgentThread";
import { Composer } from "../agent/Composer";
import { RuntimeConsole, type RuntimeLog } from "../agent/RuntimeConsole";
import { AskUserQuestion } from "../agent/AskUserQuestion";
import type { AgentRun } from "../agent/agentRun";

const STAGES = ["History retrieval", "Target selection", "Challenge compilation", "Deterministic validation"];

function planningOrbState(run: AgentRun | null): OrbState {
  const tool = [...(run?.parts ?? [])].reverse().find((part) => part.kind === "tool" && part.phase === "running");
  if (!tool || tool.kind !== "tool") return "working";
  if (tool.tool.startsWith("search_") || tool.tool.startsWith("read_")) return "searching";
  if (tool.tool === "create_question") return "shaping";
  if (tool.tool === "ask_user_question") return "listening";
  return "composing";
}

function PlanningPresence({ run }: { run: AgentRun }) {
  const state = planningOrbState(run);
  const active = [...run.parts].reverse().find((part) => part.kind === "tool" && part.phase === "running");
  const label = active?.kind === "tool"
    ? active.tool === "create_question" ? "Compiling and testing a challenge" : "Working through your learning evidence"
    : "Deciding the next verified step";
  return (
    <div className="relative mb-3 overflow-hidden rounded-xl border border-border/80 bg-card/75 px-3.5 py-3 shadow-[var(--app-shadow-soft)] backdrop-blur-xl">
      <div className="pointer-events-none absolute -left-10 -top-14 size-36 rounded-full bg-[var(--accent)]/8 blur-3xl" />
      <div className="relative flex items-center gap-3">
        <div className="relative grid size-12 shrink-0 place-items-center">
          <div className="absolute inset-1 rounded-full bg-[var(--accent)]/10 blur-lg" />
          <ThinkingOrb aria-label="Spar is working" size={64} state={state} style={{ width: 42, height: 42 }} />
          <span className="absolute -right-0.5 top-0 opacity-45"><ThinkingOrb aria-hidden size={20} state="searching" style={{ width: 14, height: 14 }} /></span>
          <span className="absolute -bottom-0.5 left-0 opacity-35"><ThinkingOrb aria-hidden size={20} state="shaping" style={{ width: 11, height: 11 }} /></span>
        </div>
        <div className="min-w-0">
          <p className="text-ui font-medium text-foreground">{label}</p>
          <p className="mt-0.5 text-ui-sm text-muted-foreground">Only a sandbox-verified challenge will be published.</p>
        </div>
        <span className="ml-auto hidden shrink-0 rounded-full border border-border bg-background/55 px-2 py-1 text-ui-sm text-muted-foreground sm:inline">Live agent</span>
      </div>
    </div>
  );
}

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
  api: SparApi | undefined;
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

  const send = async (answer?: string) => {
    const body = (answer ?? draft).trim();
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
  const transcriptMessages = pending
    ? detail.messages.filter((item) => item.role !== "agent" || !pending.questions.some((question) => question.question === item.body))
    : detail.messages;

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
              header={streaming && run ? <PlanningPresence run={run} /> : undefined}
              empty={
                <div className="flex flex-col items-center pt-10 text-center">
                  <span className="relative mb-5 grid size-16 place-items-center">
                    <span className="pointer-events-none absolute inset-0 rounded-full bg-[var(--accent)]/10 blur-xl" />
                    <span className="pointer-events-none absolute inset-1 rounded-full border border-border/70 [animation:agent-orbit_12s_linear_infinite]" />
                    <ThinkingOrb aria-label="Spar agent" size={64} state="working" style={{ width: 52, height: 52 }} />
                    <span className="absolute -right-1 top-1 opacity-45"><ThinkingOrb aria-hidden size={20} state="searching" style={{ width: 16, height: 16 }} /></span>
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
              messages={transcriptMessages}
              run={run}
            />

            <div className="shrink-0 px-4 pb-4">
              <div className="transcript-column">
                {pending ? (
                  <AskUserQuestion busy={busy || streaming} onSubmit={(answer) => void send(answer)} request={pending} />
                ) : (
                  <Composer
                    busy={busy || streaming}
                    onChange={setDraft}
                    onSubmit={() => void send()}
                    placeholder="Send the agent a note…"
                    value={draft}
                  />
                )}
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
