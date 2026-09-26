import { useEffect, useState } from "react";
import { ChevronsUpDown, Sparkles } from "lucide-react";
import { DEFAULT_PROBLEM_SOURCES, PROBLEM_SOURCES, type ProblemSource, type SessionSummary } from "@spar/domain";
import { SourceGlyph } from "./SourceGlyph";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuCheckItem, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const SOURCE_COPY: Record<ProblemSource, { label: string; short: string; detail: string }> = {
  spar: { label: "Spar challenges", short: "Spar", detail: "Written for your gap and checked before you get them." },
  leetcode: { label: "LeetCode", short: "LeetCode", detail: "Real problems, matched to your target and rating." },
  codeforces: { label: "Codeforces", short: "Codeforces", detail: "Rated contest problems, matched to your rating window." },
};

/**
 * Where a session's challenges may come from.
 *
 * A short list of switches rather than a segmented choice, because the three are
 * not exclusive: "LeetCode and Codeforces, nothing Spar wrote" is the case this
 * exists for. The last source that is on cannot be turned off: a session with
 * nowhere to take a problem from could never be set one.
 */
export function ProblemSourcesPicker({ value, onChange, className }: { value: ProblemSource[]; onChange(next: ProblemSource[]): void; className?: string }) {
  return (
    <div aria-label="Problem sources" className={cn("divide-y divide-border overflow-hidden rounded-xl border border-border", className)} role="group">
      {PROBLEM_SOURCES.map((source) => {
        const on = value.includes(source);
        const last = on && value.length === 1;
        return (
          <label className={cn("flex items-center gap-3 px-3 py-2.5", last ? "cursor-default" : "cursor-pointer")} key={source} title={last ? "A session needs at least one source" : undefined}>
            <SourceMark className="size-4" source={source} />
            <span className="min-w-0 flex-1">
              <span className="block text-ui text-foreground">{SOURCE_COPY[source].label}</span>
              <span className="block text-ui-sm text-muted-foreground">{SOURCE_COPY[source].detail}</span>
            </span>
            <Switch checked={on} disabled={last} onCheckedChange={() => onChange(toggleSource(value, source))} size="sm" />
          </label>
        );
      })}
    </div>
  );
}

/**
 * The same choice as a single field, for a form where it is one setting among
 * several: the trigger names what is on, the menu toggles each source.
 */
export function ProblemSourcesMenu({ value, onChange }: { value: ProblemSource[]; onChange(next: ProblemSource[]): void }) {
  const summary = value.length === PROBLEM_SOURCES.length ? "Anywhere" : value.map((source) => SOURCE_COPY[source].short).join(", ");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="inline-flex h-7 items-center gap-1.5 rounded-md pl-2.5 pr-1.5 text-ui text-foreground transition-colors hover:bg-accent data-[state=open]:bg-accent" type="button">
          {summary}
          <ChevronsUpDown className="size-3.5 text-muted-foreground/70" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        {PROBLEM_SOURCES.map((source) => {
          const on = value.includes(source);
          return (
            <DropdownMenuCheckItem
              checked={on}
              disabled={on && value.length === 1}
              key={source}
              onSelect={(event) => { event.preventDefault(); onChange(toggleSource(value, source)); }}
            >
              <SourceMark className="size-3.5" source={source} />
              {SOURCE_COPY[source].label}
            </DropdownMenuCheckItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function toggleSource(value: ProblemSource[], source: ProblemSource): ProblemSource[] {
  const next = PROBLEM_SOURCES.filter((entry) => (entry === source ? !value.includes(entry) : value.includes(entry)));
  return next.length ? next : value;
}

function SourceMark({ source, className }: { source: ProblemSource; className: string }) {
  return source === "spar" ? <Sparkles className={cn("text-muted-foreground", className)} /> : <SourceGlyph className={className} source={source} />;
}

/** One sentence on what the current choice means for the agent. */
export function problemSourcesNote(value: ProblemSource[]): string {
  const external = value.filter((source) => source !== "spar").map((source) => SOURCE_COPY[source].label);
  if (!value.includes("spar")) return `Only real ${external.join(" and ")} problems — Spar picks the best fit for your target and rating and writes none itself.`;
  if (!external.length) return "Spar writes every challenge in this session and won't use outside problems.";
  if (external.length === 1) return `Spar can write challenges or pick ${external[0]} problems, but won't use other sites.`;
  return "Spar writes a challenge or picks a real problem, whichever fits better.";
}

/** The session's own setting, changed after it started. Read by the next turn. */
export function SessionSourcesDialog({ session, onSave, onCancel }: { session: SessionSummary | null; onSave(session: SessionSummary, sources: ProblemSource[]): void; onCancel(): void }) {
  const [value, setValue] = useState<ProblemSource[]>(DEFAULT_PROBLEM_SOURCES);
  /* A session summary from before sources existed, or from a main process
     that has not restarted onto them yet, has none: that is the defaults. */
  const saved = session?.problemSources ?? DEFAULT_PROBLEM_SOURCES;
  useEffect(() => { if (session) setValue(session.problemSources ?? DEFAULT_PROBLEM_SOURCES); }, [session]);
  const unchanged = !!session && value.length === saved.length && value.every((source) => saved.includes(source));

  return (
    <Dialog onOpenChange={(next) => { if (!next) onCancel(); }} open={!!session}>
      <DialogContent className="sm:max-w-[28rem]">
        <DialogHeader>
          <DialogTitle>Problem sources</DialogTitle>
          <DialogDescription>Choose where {session?.title ?? "this session"} gets its challenges. This applies from the next challenge. The one you have open stays.</DialogDescription>
        </DialogHeader>
        <ProblemSourcesPicker onChange={setValue} value={value} />
        <p className="text-ui-sm text-muted-foreground">{problemSourcesNote(value)}</p>
        <DialogFooter>
          <Button onClick={onCancel} variant="secondary">Cancel</Button>
          <Button disabled={unchanged} onClick={() => { if (session) onSave(session, value); }}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
