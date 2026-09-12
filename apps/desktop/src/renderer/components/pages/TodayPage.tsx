import { useState } from "react";
import { ArrowRight, ChevronDown, Compass, Sparkles } from "lucide-react";
import type { LearnerProgress, SessionSummary, TrainingMode } from "@spar/domain";
import type { BootstrapData } from "../../../shared/api";
import { cn } from "@/lib/utils";
import { relativeTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Band, Page, PageHeader, Panel } from "../common/Page";
import { SourceGlyph } from "../common/SourceGlyph";

/**
 * Today is one decision: this is the problem to do next.
 *
 * Everything on the page is either that decision or a way out of it. The
 * justification exists — it is the best thing the agent writes — but it is one
 * sentence on the card and the rest is folded away, because a brief you have to
 * read three paragraphs of is not a brief.
 */
export function TodayPage({ data, busy, onOpen, onCreateTrack, onMode, onBaseline, onProgress }: {
  data: BootstrapData;
  busy: boolean;
  onOpen(session: SessionSummary): void;
  onCreateTrack(): void;
  onMode(mode: TrainingMode): Promise<void>;
  onBaseline(): void;
  onProgress(): void;
}) {
  const recommendation = data.recommendation;
  const session = recommendation?.sessionId ? data.sessions.find((item) => item.id === recommendation.sessionId) : undefined;
  const [focusOpen, setFocusOpen] = useState(false);
  const [why, setWhy] = useState(false);
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
    <Page>
      <PageHeader
        action={
          <Select onValueChange={chooseMode} value={modeValue(data.trainingMode)}>
            <SelectTrigger aria-label="Training mode" className="shrink-0" size="sm"><SelectValue /></SelectTrigger>
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
        }
        eyebrow={today()}
        title="Today"
      />

      {/* A precondition, so it sits above the thing it is a precondition for. */}
      {data.baseline.status !== "complete" && (
        <Panel className="mb-5 flex items-center gap-3 px-4 py-2.5" tone="quiet">
          <p className="min-w-0 flex-1 text-ui">Baseline not set</p>
          <Button disabled={busy} onClick={onBaseline} size="sm" variant="ghost">
            {data.baseline.status === "in-progress" ? "Continue" : "Begin"}
          </Button>
        </Panel>
      )}

      {recommendation ? (
        <Panel className="overflow-hidden">
          <div className="px-5 pb-4 pt-4">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-ui text-muted-foreground">
              <span className="text-foreground/75">{intentLabel(recommendation.intent)}</span>
              <span aria-hidden>·</span>
              <span className="inline-flex items-center gap-1.5">
                {recommendation.source === "spar" ? <Sparkles className="size-3.5" /> : <SourceGlyph className="size-3.5" source={recommendation.source} />}
                {SOURCE_LABEL[recommendation.source]}
              </span>
              <span aria-hidden>·</span>
              <span className="truncate">{recommendation.abilityTitle}</span>
            </div>

            <h2 className="mt-2.5 text-[1.4rem] font-semibold leading-[1.2] tracking-[-0.03em]">{recommendation.challengeTitle}</h2>
            <p className="mt-2 line-clamp-2 max-w-[36rem] text-ui leading-[1.65] text-muted-foreground">{recommendation.reason}</p>

            {/* Folded, not deleted. The reasoning is worth having and is worth
                nobody's attention until they ask for it. */}
            {recommendation.reasoning.length > 0 && (
              <>
                <button
                  aria-expanded={why}
                  className="mt-2.5 inline-flex items-center gap-1 text-ui-sm text-muted-foreground/80 transition-colors hover:text-foreground"
                  onClick={() => setWhy((open) => !open)}
                  type="button"
                >
                  Why this
                  <ChevronDown className={cn("size-3 transition-transform", why && "rotate-180")} />
                </button>
                {why && (
                  <ul className="mt-2 flex flex-col gap-1.5 border-l border-border pl-3">
                    {recommendation.reasoning.slice(0, 4).map((line) => (
                      <li className="text-ui leading-[1.6] text-muted-foreground" key={line}>{line}</li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>

          <div className="flex items-center justify-between gap-4 border-t border-border px-5 py-3">
            <span className="truncate text-ui text-muted-foreground">{recommendation.trackTitle}</span>
            <Button disabled={busy || !session} onClick={() => session && onOpen(session)} size="sm">
              {session?.activeQuestion ? "Continue" : "Start"}<ArrowRight data-icon="inline-end" />
            </Button>
          </div>
        </Panel>
      ) : (
        <Panel className="flex flex-col items-center px-8 py-12 text-center">
          <Compass className="size-5 text-muted-foreground" />
          <h2 className="mt-3 text-content font-semibold">No track yet</h2>
          <Button className="mt-4" onClick={onCreateTrack} size="sm">Create Track</Button>
        </Panel>
      )}

      {data.progress.notices.length > 0 && (
        <Band title="Noticed">
          <Panel className="divide-y divide-border overflow-hidden">
            {data.progress.notices.slice(0, 3).map((notice) => (
              <div className="flex items-baseline justify-between gap-3 px-4 py-2.5" key={notice.id}>
                <p className="min-w-0 truncate text-ui">{notice.title}</p>
                <span className="shrink-0 text-ui-sm text-muted-foreground/70">{relativeTime(notice.createdAt)}</span>
              </div>
            ))}
          </Panel>
        </Band>
      )}

      <Band
        action={<button className="text-ui-sm text-muted-foreground transition-colors hover:text-foreground" onClick={onProgress} type="button">Progress →</button>}
        title="Standing"
      >
        <Standing onProgress={onProgress} progress={data.progress} />
      </Band>

      <Dialog onOpenChange={setFocusOpen} open={focusOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Focus training</DialogTitle>
            <DialogDescription>Spar still personalizes within this area.</DialogDescription>
          </DialogHeader>
          <Input autoFocus onChange={(event) => setFocus(event.target.value)} placeholder="Graphs, TypeScript types, dynamic programming…" value={focus} />
          <DialogFooter>
            <Button disabled={!focus.trim()} onClick={() => { void onMode({ kind: "focus", focus: focus.trim() }); setFocusOpen(false); }}>Apply focus</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  );
}

/** Three figures. Not a chart and not a sentence — Progress is where the rating
 *  is studied, and this is only here so Today is not silent about it. */
function Standing({ onProgress, progress }: { onProgress(): void; progress: LearnerProgress }) {
  const history = progress.ratingHistory;
  const previous = history.length > 1 ? history[history.length - 2]!.rating : null;
  const delta = previous === null ? null : progress.rating.rating - previous;
  const fluent = progress.abilities.filter((ability) => ability.trainingStatus === "monitoring" && ability.proficiency >= 0.75).length;
  const training = progress.abilities.filter((ability) => ability.trainingStatus === "training" || ability.trainingStatus === "diagnosing").length;

  return (
    <Panel className="grid grid-cols-3 divide-x divide-border overflow-hidden">
      <button className="px-4 py-3 text-left outline-none transition-colors hover:bg-accent/30" onClick={onProgress} type="button">
        <p className="flex items-baseline gap-1.5">
          <span className="text-[1.3rem] font-semibold tabular-nums tracking-[-0.03em]">{progress.rating.rating}</span>
          {delta !== null && delta !== 0 && (
            <span className={cn("text-ui tabular-nums", delta > 0 ? "text-[var(--success)]" : "text-muted-foreground")}>
              {delta > 0 ? "+" : ""}{delta}
            </span>
          )}
        </p>
        <p className="mt-0.5 truncate text-ui-sm text-muted-foreground">Rating{progress.rating.provisional && " · provisional"}</p>
      </button>
      <div className="px-4 py-3">
        <p className="text-[1.3rem] font-semibold tabular-nums tracking-[-0.03em]">{fluent}</p>
        <p className="mt-0.5 truncate text-ui-sm text-muted-foreground">Fluent</p>
      </div>
      <div className="px-4 py-3">
        <p className="text-[1.3rem] font-semibold tabular-nums tracking-[-0.03em]">{training}</p>
        <p className="mt-0.5 truncate text-ui-sm text-muted-foreground">In training</p>
      </div>
    </Panel>
  );
}

const SOURCE_LABEL: Record<"leetcode" | "codeforces" | "spar", string> = { leetcode: "LeetCode", codeforces: "Codeforces", spar: "Spar" };

function modeValue(mode: TrainingMode) { return mode.kind === "source" ? mode.source : mode.kind === "focus" ? "focus" : mode.kind; }
function intentLabel(intent: string) { return ({ diagnose: "Diagnose", teach: "Prerequisite", practise: "Practice", transfer: "Transfer", retain: "Retention", advance: "Advance" } as Record<string, string>)[intent] ?? intent; }
function today() { return new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" }); }
