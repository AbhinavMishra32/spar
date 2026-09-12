import { useState } from "react";
import { Plus } from "lucide-react";
import type { ChallengeHistorySummary, SessionSummary, Track } from "@spar/domain";
import type { SparApi } from "../../../shared/api";
import type { AgentRun } from "../agent/agentRun";
import { SessionsPage } from "./SessionsPage";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

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
  onCreate(goal: string): Promise<void>;
  onOpen(session: SessionSummary): void;
}) {
  const [open, setOpen] = useState(false);
  const [goal, setGoal] = useState("");
  const create = async () => {
    const value = goal.trim();
    if (value.length < 3) return;
    await onCreate(value);
    setGoal("");
    setOpen(false);
  };

  const action = <Dialog onOpenChange={setOpen} open={open}>
    <DialogTrigger asChild><Button><Plus data-icon="inline-start" />New Session</Button></DialogTrigger>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Start a session in {track.title}</DialogTitle>
        <DialogDescription>Spar will use this Track’s learner model, memory, and prior sessions to decide the next useful training action.</DialogDescription>
      </DialogHeader>
      <Textarea autoFocus className="min-h-28" onChange={(event) => setGoal(event.target.value)} placeholder="What do you want to work on in this session?" value={goal} />
      <DialogFooter><Button disabled={busy || goal.trim().length < 3} onClick={() => void create()}>Start Session</Button></DialogFooter>
    </DialogContent>
  </Dialog>;

  return <SessionsPage action={action} api={api} challenges={challenges} description={track.goal} onOpen={onOpen} runs={runs} sessions={sessions} title={track.title} />;
}
