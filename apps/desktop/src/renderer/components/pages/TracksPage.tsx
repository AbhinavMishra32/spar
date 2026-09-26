import { useState } from "react";
import { ArrowRight, CircleDot, Plus, Radar, ShieldCheck, Trash2 } from "lucide-react";
import { DEFAULT_PROBLEM_SOURCES, LANGUAGES, type Language, type ProblemSource, type Track } from "@spar/domain";
import type { BootstrapData } from "../../../shared/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { LANGUAGE_LABEL, LanguageGlyph } from "../common/LanguageGlyph";
import { ProblemSourcesMenu } from "../common/ProblemSources";

export function TracksPage({ data, busy, onCreate, onOpen, onDelete }: {
  data: BootstrapData;
  busy: boolean;
  onCreate(input: { goal: string; title?: string; language?: Language; problemSources?: ProblemSource[] }): Promise<void>;
  onOpen(track: Track): Promise<void>;
  onDelete(track: Track): Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  /* Chosen here rather than inferred from the goal text, because the goal is
     prose and prose is ambiguous: "practice hashmaps for my Python job" and
     "port my Python service to Go" both contain the word Python and want
     different answers. Null means the Track follows the profile default. */
  const [language, setLanguage] = useState<Language | null>(data.profile?.language ?? null);
  /* For the Track's first session, the same choice the Track page offers for
     every session after it. */
  const [sources, setSources] = useState<ProblemSource[]>(DEFAULT_PROBLEM_SOURCES);

  const create = async () => {
    if (goal.trim().length < 3) return;
    await onCreate({ goal: goal.trim(), ...(title.trim() ? { title: title.trim() } : {}), ...(language ? { language } : {}), problemSources: sources });
    setGoal(""); setTitle(""); setSources(DEFAULT_PROBLEM_SOURCES); setOpen(false);
  };

  return <div className="app-scroll h-full overflow-y-auto">
    <main className="mx-auto w-full max-w-[56rem] px-8 pb-16 pt-8">
      <header className="flex items-start justify-between gap-4">
        <div><h1 className="text-[1.35rem] font-semibold tracking-[-0.03em]">Tracks</h1><p className="mt-1 max-w-[38rem] text-content text-muted-foreground">Separate workspaces for distinct goals. Each keeps its own sessions, learner model, memory, and training direction.</p></div>
        <Dialog onOpenChange={setOpen} open={open}>
          <DialogTrigger asChild><Button disabled={busy}><Plus data-icon="inline-start" />New Track</Button></DialogTrigger>
          <DialogContent className="sm:max-w-[30rem]">
            <DialogHeader><DialogTitle>Create a Track</DialogTitle><DialogDescription>Describe what you want to get better at. Spar chooses an initial direction, not a fixed syllabus.</DialogDescription></DialogHeader>
            <div className="flex flex-col gap-3">
              <Textarea autoFocus className="min-h-28 resize-none" onChange={(event) => setGoal(event.target.value)} placeholder="I want to become extremely strong at TypeScript and understand the language deeply…" value={goal} />
              <div className="divide-y divide-border rounded-xl border border-border">
                <Row label="Name">
                  <input className="h-7 w-44 bg-transparent pr-1.5 text-right text-ui outline-none placeholder:text-muted-foreground/70" onChange={(event) => setTitle(event.target.value)} placeholder="From the goal" value={title} />
                </Row>
                <Row label="Language">
                  <Select onValueChange={(next) => setLanguage(next as Language)} value={language ?? ""}>
                    <SelectTrigger aria-label="Language for this Track" className="h-7 border-transparent bg-transparent pr-1.5 text-ui shadow-none hover:bg-accent dark:bg-transparent" size="sm">
                      <SelectValue placeholder="Choose" />
                    </SelectTrigger>
                    <SelectContent>
                      {LANGUAGES.map((option) => (
                        <SelectItem key={option} value={option}>
                          <span className="inline-flex items-center gap-2">
                            <LanguageGlyph className="size-3.5" language={option} />
                            {LANGUAGE_LABEL[option]}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Row>
                <Row label="Challenges from">
                  <ProblemSourcesMenu onChange={setSources} value={sources} />
                </Row>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => setOpen(false)} variant="secondary">Cancel</Button>
              <Button disabled={busy || goal.trim().length < 3} onClick={() => void create()}>Create Track<ArrowRight data-icon="inline-end" /></Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </header>

      <div className="mt-6 flex flex-col gap-3">
        {data.tracks.map((track) => <TrackRow busy={busy} onDelete={onDelete} data={data} key={track.id} onOpen={onOpen} track={track} />)}
        {!data.tracks.length && <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center"><Radar className="mx-auto size-6 text-muted-foreground" /><p className="mt-3 text-content font-medium">No Tracks yet</p><p className="mt-1 text-ui text-muted-foreground">Create one from a goal; Spar will establish an independent learner workspace and initial direction.</p></div>}
      </div>
    </main>
  </div>;
}

function TrackRow({ data, track, onOpen, onDelete, busy }: { data: BootstrapData; track: Track; busy: boolean; onDelete(track: Track): Promise<boolean>; onOpen(track: Track): Promise<void> }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const active = data.activeTrack?.id === track.id;
  const sessions = data.sessions.filter((session) => session.trackId === track.id).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
  const states = data.trackProgress[track.id]?.abilities ?? [];
  const training = states.filter((state) => state.trainingStatus === "training" || state.trainingStatus === "diagnosing");
  const monitoring = states.filter((state) => state.trainingStatus === "monitoring");
  return <article className="rounded-xl border border-border bg-card px-5 py-4 shadow-[var(--app-shadow-card)]">
    <div className="flex items-start gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2"><h2 className="truncate text-[1.05rem] font-semibold">{track.title}</h2>{active && <span className="rounded-md bg-accent px-1.5 py-0.5 text-ui-sm font-medium">Active</span>}</div>
        <p className="mt-1 line-clamp-2 text-ui leading-5 text-muted-foreground">{track.goal}</p>
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-ui text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><CircleDot className="size-3.5" />{training.length} being investigated or trained</span>
          <span className="inline-flex items-center gap-1.5"><ShieldCheck className="size-3.5" />{monitoring.length} monitored in this Track</span>
          <span>{sessions.length} work session{sessions.length === 1 ? "" : "s"}</span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Dialog open={confirmOpen} onOpenChange={(open) => { if (!busy) setConfirmOpen(open); }}>
          <DialogTrigger asChild><Button aria-label={`Delete ${track.title}`} disabled={busy} size="icon" variant="ghost"><Trash2 className="size-4" /></Button></DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete {track.title}?</DialogTitle>
              <DialogDescription>This permanently deletes this Track, its {sessions.length} work session{sessions.length === 1 ? "" : "s"}, workspace files, and learning history. This cannot be undone.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button autoFocus disabled={busy} variant="outline" onClick={() => setConfirmOpen(false)}>Cancel</Button>
              <Button disabled={busy} variant="destructive" onClick={async () => { if (await onDelete(track)) setConfirmOpen(false); }}>{busy ? "Deleting…" : "Delete Track"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Button disabled={busy} onClick={() => void onOpen(track)} size="sm" variant={active ? "default" : "outline"}>Open<ArrowRight data-icon="inline-end" /></Button>
      </div>
    </div>
  </article>;
}

/** One setting in the create dialog: its name on the left, its control on the right. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-4 py-1.5 pl-3 pr-2">
      <span className="text-ui text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}
