import { useState } from "react";
import { ExternalLink, Library, Loader2, Lock, Search, X } from "lucide-react";
import type { SparApi, VisualizerProblem } from "../../../shared/api";
import { cn } from "@/lib/utils";
import { useProblemSearch } from "../../hooks/use-problem-search";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SourceGlyph } from "../common/SourceGlyph";

const BAND: Record<"easy" | "medium" | "hard", string> = { easy: "Easy", medium: "Medium", hard: "Hard" };

/**
 * Picking a problem to visualise.
 *
 * The reason this exists rather than a text box: a visualiser you have to feed
 * by hand is a visualiser you use twice. The whole value of putting one inside
 * Spar is that the problems are already here — so opening one should bring its
 * statement, its starter code, its declared signature and its worked examples
 * with it, and the learner should never see a `nums = [...]` they had to type.
 *
 * The same search the Problems page uses, so a problem is found the same way
 * wherever you are looking for it.
 */
export function ProblemPicker({
  api,
  open,
  onOpenChange,
  onPick,
}: {
  api: SparApi | undefined;
  open: boolean;
  onOpenChange(open: boolean): void;
  onPick(source: "leetcode" | "codeforces", slug: string): Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [opening, setOpening] = useState<string | null>(null);
  const search = useProblemSearch(api, { query, band: "all", standing: "all" });

  const pick = async (source: "leetcode" | "codeforces", slug: string) => {
    setOpening(`${source}:${slug}`);
    try {
      await onPick(source, slug);
      onOpenChange(false);
    } finally {
      setOpening(null);
    }
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-[34rem]">
        <DialogHeader>
          <DialogTitle>Visualise a problem</DialogTitle>
          <DialogDescription>
            Spar opens it with its starter code and builds the input form from the signature the source declares, so there is nothing to type.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input autoFocus className="pl-8" onChange={(event) => setQuery(event.target.value)} placeholder="Search your connected sources…" value={query} />
        </div>

        <div className="app-scroll -mx-1 max-h-[22rem] min-h-[8rem] overflow-y-auto px-1">
          {search.loading && !search.hits.length && (
            <p className="flex items-center gap-2 py-8 text-center text-ui text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />Searching…</p>
          )}

          {!search.loading && !search.hits.length && (
            <div className="py-8 text-center">
              <Library className="mx-auto size-5 text-muted-foreground" />
              <p className="mt-2 text-ui text-muted-foreground">
                {search.error ?? (query ? "Nothing matched." : "Connect LeetCode in Settings to browse problems here.")}
              </p>
            </div>
          )}

          <div className="flex flex-col gap-0.5">
            {search.hits.map((hit) => {
              const key = `${hit.source}:${hit.slug}`;
              /* A paid problem's statement never arrives, so opening one would
                 put up an empty editor and a form with no signature. Disabled
                 with the reason attached is the honest version of that. */
              const locked = hit.paidOnly;
              return (
                <button
                  className={cn(
                    "flex items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors",
                    locked ? "cursor-not-allowed opacity-50" : "hover:bg-muted",
                  )}
                  disabled={locked || Boolean(opening)}
                  key={key}
                  onClick={() => void pick(hit.source, hit.slug)}
                  type="button"
                >
                  <SourceGlyph className="size-3.5 shrink-0 text-muted-foreground" source={hit.source} />
                  <span className="w-10 shrink-0 font-mono text-ui-sm tabular-nums text-muted-foreground">{hit.displayId}</span>
                  <span className="min-w-0 flex-1 truncate text-ui">{hit.title}</span>
                  <span className="shrink-0 text-ui-sm text-muted-foreground">{BAND[hit.difficulty]}</span>
                  {locked && <Lock className="size-3 shrink-0 text-muted-foreground" />}
                  {opening === key && <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />}
                </button>
              );
            })}
          </div>

          {search.more && (
            <Button className="mt-2 w-full" onClick={search.loadMore} size="sm" variant="ghost">Load more</Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The banner for a problem that is open.
 *
 * Small, and it stays small. The visualiser is not a second challenge
 * workspace — the statement lives in a disclosure rather than on the page,
 * because the reason someone came here is the picture, and a problem statement
 * expanded by default would push it below the fold.
 */
export function ProblemBanner({
  problem,
  onClear,
  onExample,
  exampleCount,
  onOpenExternal,
}: {
  problem: VisualizerProblem;
  onClear(): void;
  onExample(index: number): void;
  exampleCount: number;
  onOpenExternal(url: string): void;
}) {
  const [statement, setStatement] = useState(false);
  return (
    <div className="rounded-xl border border-border bg-card px-3.5 py-3 shadow-[var(--app-shadow-card)]">
      <div className="flex items-center gap-2">
        <SourceGlyph className="size-3.5 shrink-0 text-muted-foreground" source={problem.source} />
        <span className="font-mono text-ui-sm tabular-nums text-muted-foreground">{problem.displayId}</span>
        <span className="min-w-0 flex-1 truncate text-content font-medium">{problem.title}</span>
        <span className="shrink-0 text-ui-sm text-muted-foreground">{BAND[problem.difficulty]}</span>
        <Button className="text-muted-foreground" onClick={() => onOpenExternal(problem.url)} size="icon-xs" title="Open at the source" variant="ghost">
          <ExternalLink />
        </Button>
        <Button className="text-muted-foreground" onClick={onClear} size="icon-xs" title="Close this problem" variant="ghost">
          <X />
        </Button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {exampleCount > 0 ? (
          <>
            <span className="text-ui-sm text-muted-foreground">Load an example:</span>
            {Array.from({ length: exampleCount }, (_, index) => (
              <Button key={index} onClick={() => onExample(index)} size="xs" variant="outline">
                Example {index + 1}
              </Button>
            ))}
          </>
        ) : (
          <span className="text-ui-sm text-muted-foreground">This problem states no worked examples, so the form starts empty.</span>
        )}
        {problem.statement && (
          <Button className="ml-auto text-muted-foreground" onClick={() => setStatement((current) => !current)} size="xs" variant="ghost">
            {statement ? "Hide statement" : "Read statement"}
          </Button>
        )}
      </div>

      {statement && (
        <div className="app-scroll mt-2 max-h-56 overflow-y-auto whitespace-pre-wrap border-t border-border pt-2 text-ui text-muted-foreground">
          {problem.statement}
        </div>
      )}
    </div>
  );
}
