import { useState } from "react";
import { Plus } from "lucide-react";
import { DEFAULT_PROBLEM_SOURCES, type ChallengeHistorySummary, type ProblemSource, type SessionSummary, type Track } from "@spar/domain";
import type { SparApi } from "../../../shared/api";
import type { AgentRun } from "../agent/agentRun";
import { SessionsPage } from "./SessionsPage";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { ProblemSourcesPicker, problemSourcesNote } from "../common/ProblemSources";

/** A Track is the workspace around the original Sessions experience. The list,
 * filters, cards, and session workspace remain unchanged; only their ownership
 * boundary is explicit now. */
export function TrackPage({ api, track, sessions, challenges, runs, busy, onCreate, onOpen }: {
  api: SparApi | undefined;
  track: Track;
  sessions: SessionSummary[];
  challenges: ChallengeHistorySummary[];
  runs: Record<string, AgentRun>;
  busy: boolean;
  onCreate(goal: string, sources: ProblemSource[]): Promise<void>;
  onOpen(session: SessionSummary): void;
}) {
  const [open, setOpen] = useState(false);
  const [goal, setGoal] = useState("");
  const [sources, setSources] = useState<ProblemSource[]>(DEFAULT_PROBLEM_SOURCES);
  const create = async () => {
    const value = goal.trim();
    if (value.length < 3) return;
    await onCreate(value, sources);
    setGoal("");
    setSources(DEFAULT_PROBLEM_SOURCES);
    setOpen(false);
  };

  const action = <Dialog onOpenChange={setOpen} open={open}>
    <DialogTrigger asChild><Button><Plus data-icon="inline-start" />New Session</Button></DialogTrigger>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>New session</DialogTitle>
        <DialogDescription>In {track.title}. Spar picks up from what this Track already knows about you.</DialogDescription>
      </DialogHeader>
      <Textarea
        autoFocus
        className="min-h-20 resize-none"
        onChange={(event) => setGoal(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void create(); } }}
        placeholder="What do you want to work on?"
        value={goal}
      />
      <div className="flex flex-col gap-2">
        <span className="text-ui-sm font-medium text-muted-foreground">Challenges from</span>
        <ProblemSourcesPicker onChange={setSources} value={sources} />
        <p className="text-ui-sm leading-[1.5] text-muted-foreground">{problemSourcesNote(sources)}</p>
      </div>
      <DialogFooter><Button disabled={busy || goal.trim().length < 3} onClick={() => void create()}>Start session <kbd className="font-sans text-[10px] opacity-60">⌘↵</kbd></Button></DialogFooter>
    </DialogContent>
  </Dialog>;

  return <SessionsPage action={action} api={api} challenges={challenges} description={track.goal} onOpen={onOpen} runs={runs} sessions={sessions} title={track.title} />;
}
