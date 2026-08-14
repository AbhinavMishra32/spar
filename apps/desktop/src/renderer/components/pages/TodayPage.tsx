import { useState } from "react";
import { ArrowRight, CheckCircle2, CircleHelp, Compass, Gauge, Sparkles, Target } from "lucide-react";
import type { SessionSummary, TrainingMode } from "@spar/domain";
import type { BootstrapData } from "../../../shared/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SourceGlyph } from "../common/SourceGlyph";

export function TodayPage({ data, busy, onOpen, onCreateTrack, onMode, onBaseline }: {
  data: BootstrapData;
  busy: boolean;
  onOpen(session: SessionSummary): void;
  onCreateTrack(): void;
  onMode(mode: TrainingMode): Promise<void>;
  onBaseline(): void;
}) {
  const recommendation = data.recommendation;
  const session = recommendation?.sessionId ? data.sessions.find((item) => item.id === recommendation.sessionId) : undefined;
  const [focusOpen, setFocusOpen] = useState(false);
  const [focus, setFocus] = useState(data.trainingMode.kind === "focus" ? data.trainingMode.focus : "");

  const chooseMode = (value: string) => {
    if (value === "focus") { setFocusOpen(true); return; }
    const mode: TrainingMode = value === "recommended" ? { kind: "recommended" }
      : value === "explore" ? { kind: "explore" }
      : value === "quick" ? { kind: "quick" }
      : { kind: "source", source: value as "leetcode" | "codeforces" | "spar" };
    void onMode(mode);
  };

  return (
    <div className="app-scroll h-full overflow-y-auto">
      <main className="mx-auto flex min-h-full w-full max-w-[48rem] flex-col px-8 pb-16 pt-10">
        <header className="flex items-center justify-between gap-4">
          <div>
            <p className="text-ui font-medium text-muted-foreground">{greeting()}</p>
            <h1 className="mt-0.5 text-[1.75rem] font-medium tracking-[-0.035em]">What should you practice right now?</h1>
          </div>
          <Select onValueChange={chooseMode} value={modeValue(data.trainingMode)}>
            <SelectTrigger aria-label="Training mode" className="shrink-0" size="sm">
              <span className="text-muted-foreground">Training mode:</span>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="recommended">Recommended</SelectItem>
                <SelectItem value="focus">Focus on…</SelectItem>
                <SelectItem value="explore">Explore something new</SelectItem>
                <SelectItem value="leetcode">LeetCode only</SelectItem>
                <SelectItem value="codeforces">Codeforces only</SelectItem>
                <SelectItem value="spar">Spar challenges only</SelectItem>
                <SelectItem value="quick">Quick practice</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </header>

        {data.baseline.status !== "complete" && (
          <section className="mt-8 flex items-center gap-4 rounded-xl border border-border bg-card px-4 py-3 shadow-[var(--app-shadow-card)]">
            <Gauge className="size-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <h2 className="text-content font-medium">Build your baseline</h2>
              <p className="mt-0.5 text-ui text-muted-foreground">Spar needs a little direct evidence before personalized training can fully begin.</p>
            </div>
            <Button disabled={busy} onClick={onBaseline} size="sm" variant="outline">{data.baseline.status === "in-progress" ? "Continue" : "Begin"}</Button>
          </section>
        )}

        <section className="mt-8 overflow-hidden rounded-2xl border border-border bg-card shadow-[var(--app-shadow-sheet)]">
          {recommendation ? (
            <>
              <div className="px-6 pb-5 pt-6">
                <div className="flex items-center gap-2 text-ui font-medium text-muted-foreground">
                  <Sparkles className="size-4" /> Recommended next
                  <span aria-hidden>·</span>
                  <span>{recommendation.trackTitle}</span>
                </div>
                <h2 className="mt-4 text-[1.55rem] font-semibold tracking-[-0.03em]">{recommendation.challengeTitle}</h2>
                <div className="mt-2 flex items-center gap-2">
                  <span className="inline-flex h-6 items-center gap-1.5 rounded-lg border border-border bg-background/60 px-2 text-ui text-muted-foreground">
                    {recommendation.source === "spar" ? <Sparkles className="size-3.5" /> : <SourceGlyph className="size-3.5" source={recommendation.source} />}
                    {recommendation.source === "spar" ? "Spar" : recommendation.source === "leetcode" ? "LeetCode" : "Codeforces"}
                  </span>
                  <span className="text-ui text-muted-foreground">{intentLabel(recommendation.intent)} · {recommendation.abilityTitle}</span>
                </div>
                <p className="mt-5 max-w-[40rem] text-content leading-7 text-foreground/80">{recommendation.reason}</p>
              </div>
              <div className="flex items-center justify-between border-t border-border bg-muted/25 px-6 py-3.5">
                <WhyDialog reasoning={recommendation.reasoning} />
                <Button disabled={busy || !session} onClick={() => session && onOpen(session)}>
                  {session?.activeQuestion ? "Continue" : "Start"}<ArrowRight data-icon="inline-end" />
                </Button>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center px-8 py-14 text-center">
              <Compass className="size-7 text-muted-foreground" />
              <h2 className="mt-4 text-[1.2rem] font-semibold">Create your first Track</h2>
              <p className="mt-2 max-w-[29rem] text-content text-muted-foreground">Tell Spar what you want to become better at. It will establish an initial direction, then change it as evidence arrives.</p>
              <Button className="mt-5" onClick={onCreateTrack}>Create Track</Button>
            </div>
          )}
        </section>

        {data.progress.notices.length > 0 && (
          <section className="mt-9">
            <h2 className="text-ui font-medium text-muted-foreground">Spar noticed</h2>
            <div className="mt-2 flex flex-col divide-y divide-border rounded-xl border border-border bg-card px-4">
              {data.progress.notices.slice(0, 3).map((notice) => (
                <div className="flex gap-3 py-3.5" key={notice.id}>
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div><p className="text-ui font-medium">{notice.title}</p><p className="mt-0.5 text-ui leading-5 text-muted-foreground">{notice.body}</p></div>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>

      <Dialog onOpenChange={setFocusOpen} open={focusOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Focus training</DialogTitle><DialogDescription>Spar will still personalize within this area instead of choosing a random tagged problem.</DialogDescription></DialogHeader>
          <Input autoFocus onChange={(event) => setFocus(event.target.value)} placeholder="Graphs, TypeScript types, dynamic programming…" value={focus} />
          <DialogFooter><Button disabled={!focus.trim()} onClick={() => { void onMode({ kind: "focus", focus: focus.trim() }); setFocusOpen(false); }}>Apply focus</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function WhyDialog({ reasoning }: { reasoning: string[] }) {
  return <Dialog><DialogTrigger asChild><Button size="sm" variant="ghost"><CircleHelp data-icon="inline-start" />Why this?</Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>Why Spar chose this</DialogTitle><DialogDescription>The persisted training decision behind today’s recommendation.</DialogDescription></DialogHeader><div className="flex flex-col gap-3">{reasoning.map((line) => <div className="flex gap-2.5 text-ui leading-5" key={line}><Target className="mt-0.5 size-4 shrink-0 text-muted-foreground" /><span>{line}</span></div>)}</div></DialogContent></Dialog>;
}

function modeValue(mode: TrainingMode) { return mode.kind === "source" ? mode.source : mode.kind === "focus" ? "focus" : mode.kind; }
function intentLabel(intent: string) { return ({ diagnose: "Diagnose", teach: "Build prerequisite", practise: "Practice", transfer: "Transfer", retain: "Retention", advance: "Advance" } as Record<string, string>)[intent] ?? intent; }
function greeting() { const hour = new Date().getHours(); return hour < 5 ? "Still up" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"; }
