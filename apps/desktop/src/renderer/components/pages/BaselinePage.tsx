import { useState } from "react";
import { ArrowRight, CheckCircle2, Gauge, ShieldCheck } from "lucide-react";
import type { SessionDetail } from "@spar/domain";
import type { BootstrapData, SparApi } from "../../../shared/api";
import { message } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { SparDots } from "../common/SparDots";
import { AskUserQuestion } from "../agent/AskUserQuestion";
import type { AgentRun } from "../agent/agentRun";
import { Toolbar } from "../shell/Toolbar";
import { Workspace } from "../workspace/Workspace";

/** Baseline is a product flow, not a session transcript. The agent still makes
 *  the adaptive decisions underneath it, but the learner sees only the context
 *  question that is genuinely needed and the coding probe it selected. */
export function BaselinePage({ api, data, detail, run, dark, busy, onStart, onRefresh, onBack, onProgress, onError, onAbandon, onExpandSidebar, onOpenSettings }: {
  api: SparApi | undefined;
  data: BootstrapData;
  detail: SessionDetail | null;
  run: AgentRun | null;
  dark: boolean;
  busy: boolean;
  onStart(): Promise<void>;
  onRefresh(): Promise<void>;
  onBack(): void;
  onProgress(): void;
  onError(value: string): void;
  onAbandon(reason: string): Promise<void>;
  onExpandSidebar?: (() => void) | undefined;
  onOpenSettings?: (() => void) | undefined;
}) {
  const [answering, setAnswering] = useState(false);
  const baseline = data.baseline;

  if (baseline.status === "complete") return (
    <div className="flex h-full min-h-0 flex-col">
      <Toolbar onBack={onBack} onExpandSidebar={onExpandSidebar} subtitle="Calibration complete" title="Build your baseline" />
      <div className="app-scroll grid min-h-0 flex-1 place-items-center overflow-y-auto px-8 py-12">
        <div className="w-full max-w-[32rem] text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-full border border-border bg-card"><CheckCircle2 className="size-5 text-[var(--success)]" /></span>
          <h1 className="mt-5 text-[1.55rem] font-semibold tracking-[-0.03em]">Spar has enough evidence to begin</h1>
          <p className="mx-auto mt-2 max-w-[28rem] text-content leading-7 text-muted-foreground">Your baseline is not a permanent score. It is the first evidence-backed learner state, and it will keep changing as you solve real work.</p>
          <div className="mx-auto mt-6 flex max-w-[25rem] items-center justify-between border-y border-border py-3 text-ui">
            <span className="text-muted-foreground">Direct probes</span><span>{baseline.directEvidenceCount}</span>
            <span className="text-muted-foreground">Spar Rating</span><span>{data.progress.rating.rating}{data.progress.rating.provisional ? " provisional" : ""}</span>
          </div>
          <Button className="mt-6" onClick={onProgress}>See what Spar learned<ArrowRight data-icon="inline-end" /></Button>
        </div>
      </div>
    </div>
  );

  if (detail?.question) return <Workspace api={api} context="baseline" dark={dark} detail={detail} onAbandon={onAbandon} onBack={onBack} onError={onError} onExpandSidebar={onExpandSidebar} onOpenSettings={onOpenSettings} onRefresh={onRefresh} question={detail.question} run={run} />;

  const pending = detail?.pendingLearnerQuestion;
  const send = async (answer: string) => {
    if (!api || !detail) return;
    setAnswering(true);
    try { await api.sendAgentMessage({ sessionId: detail.summary.id, message: answer }); await onRefresh(); }
    catch (cause) { onError(message(cause)); }
    finally { setAnswering(false); }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Toolbar onBack={onBack} onExpandSidebar={onExpandSidebar} subtitle={detail ? "Choosing the next probe" : "Adaptive calibration"} title="Build your baseline" />
      <div className="app-scroll grid min-h-0 flex-1 place-items-center overflow-y-auto px-8 py-12">
        <div className="w-full max-w-[34rem]">
          {pending ? (
            <>
              <div className="mb-5 text-center">
                <Gauge className="mx-auto size-6 text-muted-foreground" />
                <h1 className="mt-3 text-[1.25rem] font-semibold tracking-[-0.02em]">One thing before the next probe</h1>
                <p className="mt-1.5 text-content leading-6 text-muted-foreground">Spar only asks when the answer changes what a fair diagnostic should test.</p>
              </div>
              <AskUserQuestion busy={answering || run?.status === "streaming"} onSubmit={(answer) => void send(answer)} request={pending} />
            </>
          ) : detail ? (
            <div className="text-center">
              <SparDots pattern="wave" size={30} />
              <h1 className="mt-4 text-[1.25rem] font-semibold tracking-[-0.02em]">Shaping your next probe</h1>
              <p className="mx-auto mt-2 max-w-[27rem] text-content leading-7 text-muted-foreground">Spar is comparing your existing evidence, choosing one diagnostic target, and validating the challenge before it reaches you.</p>
              <p className="mt-5 text-ui text-muted-foreground">{baseline.directEvidenceCount} direct probe{baseline.directEvidenceCount === 1 ? "" : "s"} completed</p>
            </div>
          ) : (
            <div className="text-center">
              <span className="mx-auto grid size-12 place-items-center rounded-full border border-border bg-card"><Gauge className="size-5 text-muted-foreground" /></span>
              <h1 className="mt-5 text-[1.55rem] font-semibold tracking-[-0.03em]">Let Spar build an initial read</h1>
              <p className="mx-auto mt-2 max-w-[29rem] text-content leading-7 text-muted-foreground">You will solve a small sequence of real coding probes. Each result changes the next one; this is not a fixed questionnaire or a permanent exam.</p>
              <div className="mx-auto mt-6 flex max-w-[29rem] gap-3 text-left text-ui leading-5 text-muted-foreground">
                <ShieldCheck className="mt-0.5 size-4 shrink-0" /><p>Imported LeetCode or Codeforces history can shorten calibration, but Spar still needs direct evidence from how you work here.</p>
              </div>
              <Button className="mt-7" disabled={busy} onClick={() => void onStart()}>Start first probe<ArrowRight data-icon="inline-end" /></Button>
              <p className="mt-3 text-ui text-muted-foreground">Untimed · pause whenever you want</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
