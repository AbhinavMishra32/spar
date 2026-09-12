import { useState } from "react";
import { ArrowRight, CircleDot, Plus, Radar, ShieldCheck } from "lucide-react";
import { LANGUAGES, type Language, type Track } from "@spar/domain";
import type { BootstrapData } from "../../../shared/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { LANGUAGE_LABEL, SelectableLanguageGlyph } from "../common/LanguageGlyph";

export function TracksPage({ data, busy, onCreate, onOpen }: {
  data: BootstrapData;
  busy: boolean;
  onCreate(input: { goal: string; title?: string; language?: Language }): Promise<void>;
  onOpen(track: Track): Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  /* Chosen here rather than inferred from the goal text, because the goal is
     prose and prose is ambiguous: "practice hashmaps for my Python job" and
     "port my Python service to Go" both contain the word Python and want
     different answers. Null means the Track follows the profile default. */
  const [language, setLanguage] = useState<Language | null>(data.profile?.language ?? null);

  const create = async () => {
    if (goal.trim().length < 3) return;
    await onCreate({ goal: goal.trim(), ...(title.trim() ? { title: title.trim() } : {}), ...(language ? { language } : {}) });
    setGoal(""); setTitle(""); setOpen(false);
  };

  return <div className="app-scroll h-full overflow-y-auto">
    <main className="mx-auto w-full max-w-[56rem] px-8 pb-16 pt-8">
      <header className="flex items-start justify-between gap-4">
        <div><h1 className="text-[1.35rem] font-semibold tracking-[-0.03em]">Tracks</h1><p className="mt-1 max-w-[38rem] text-content text-muted-foreground">Separate workspaces for distinct goals. Each keeps its own sessions, learner model, memory, and training direction.</p></div>
        <Dialog onOpenChange={setOpen} open={open}>
          <DialogTrigger asChild><Button><Plus data-icon="inline-start" />New Track</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Create a Track</DialogTitle><DialogDescription>Describe what you want to become better at. Spar will choose an initial direction, not a fixed syllabus.</DialogDescription></DialogHeader>
            <div className="flex flex-col gap-3">
              <Input onChange={(event) => setTitle(event.target.value)} placeholder="Track name (optional)" value={title} />
              <Textarea autoFocus className="min-h-28" onChange={(event) => setGoal(event.target.value)} placeholder="I want to become extremely strong at TypeScript and understand the language deeply…" value={goal} />
              <div>
                <p className="text-ui-sm font-medium">Language</p>
                <p className="mt-0.5 text-ui-sm text-muted-foreground">Every challenge in this Track is written in it.</p>
                <div aria-label="Language for this Track" className="mt-2 grid w-[13.5rem] grid-cols-5 gap-1" role="radiogroup">
                  {LANGUAGES.map((option) => (
                    <button
                      aria-checked={language === option}
                      aria-label={LANGUAGE_LABEL[option]}
                      className={cn(
                        "grid size-10 place-items-center rounded-[var(--radius-lg)] outline-none transition-[background-color,box-shadow,transform] duration-150 hover:bg-accent/55 focus-visible:ring-2 focus-visible:ring-ring/40 active:scale-[0.96]",
                        language === option ? "bg-accent shadow-[inset_0_0_0_1px_var(--border-strong),var(--app-shadow-card)]" : "",
                      )}
                      key={option}
                      onClick={() => setLanguage(option)}
                      role="radio"
                      title={LANGUAGE_LABEL[option]}
                      type="button"
                    >
                      <SelectableLanguageGlyph className="size-[1.3rem]" language={option} selected={language === option} />
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <DialogFooter><Button disabled={busy || goal.trim().length < 3} onClick={() => void create()}>Create Track</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </header>

      <div className="mt-6 flex flex-col gap-3">
        {data.tracks.map((track) => <TrackRow data={data} key={track.id} onOpen={onOpen} track={track} />)}
        {!data.tracks.length && <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center"><Radar className="mx-auto size-6 text-muted-foreground" /><p className="mt-3 text-content font-medium">No Tracks yet</p><p className="mt-1 text-ui text-muted-foreground">Create one from a goal; Spar will establish an independent learner workspace and initial direction.</p></div>}
      </div>
    </main>
  </div>;
}

function TrackRow({ data, track, onOpen }: { data: BootstrapData; track: Track; onOpen(track: Track): Promise<void> }) {
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
        <Button onClick={() => void onOpen(track)} size="sm" variant={active ? "default" : "outline"}>Open<ArrowRight data-icon="inline-end" /></Button>
      </div>
    </div>
  </article>;
}
