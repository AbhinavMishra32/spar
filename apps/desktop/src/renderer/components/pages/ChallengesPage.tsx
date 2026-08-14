import { useEffect, useMemo, useState } from "react";
import { ArrowRight, CheckCircle2, CornerDownRight, Flag, History, Play, Search, XCircle } from "lucide-react";
import type { ChallengeCodePreview, ChallengeHistorySummary, ConceptSummary } from "@spar/domain";
import type { SparApi } from "../../../shared/api";
import { cn } from "@/lib/utils";
import { relativeTime } from "@/lib/format";
import { ConceptChips } from "../concepts/ConceptChip";
import { SourceBadge } from "../common/SourceBadge";
import { EmptyState } from "../common/EmptyState";
import { CodePlate } from "../common/CodePeek";
import { LanguageGlyph, LANGUAGE_LABEL } from "../common/LanguageGlyph";
import { ChallengeEmblem } from "../workspace/ChallengeEmblem";
import { DifficultyPill } from "../workspace/Difficulty";

type Filter = "all" | "passed" | "open" | "replaced";

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "All" },
  { id: "open", label: "Open" },
  { id: "passed", label: "Passed" },
  { id: "replaced", label: "Replaced" },
];

function matches(item: ChallengeHistorySummary, filter: Filter) {
  if (filter === "open") return item.status === "active";
  if (filter === "passed") return item.lastOutcome === "passed";
  if (filter === "replaced") return Boolean(item.replacedByQuestionId);
  return true;
}

/** How a finished challenge ended, in one chip. An open one gets nothing: the
 *  absence of a verdict is itself the state, and a grey "in progress" pill would
 *  give every row a badge and stop any of them meaning anything. */
function OutcomeChip({ outcome }: { outcome: ChallengeHistorySummary["lastOutcome"] }) {
  if (outcome === "passed") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-[var(--success)]/12 px-1.5 py-0.5 text-ui-sm font-medium text-[var(--success)]">
        <CheckCircle2 className="size-3" />
        Passed
      </span>
    );
  }
  if (outcome === "failed") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-destructive/12 px-1.5 py-0.5 text-ui-sm font-medium text-destructive">
        <XCircle className="size-3" />
        Failed
      </span>
    );
  }
  if (outcome === "abandoned") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-ui-sm font-medium text-muted-foreground">
        <Flag className="size-3" />
        Gave up
      </span>
    );
  }
  return null;
}

function ChallengeCard({
  challenges,
  item,
  preview,
  onOpen,
  onOpenConcept,
  summaries,
}: {
  challenges: ChallengeHistorySummary[];
  item: ChallengeHistorySummary;
  preview: ChallengeCodePreview | undefined;
  onOpen(): void;
  onOpenConcept(slug: string): void;
  summaries: Map<string, ConceptSummary>;
}) {
  return (
    /* A div with the card-wide action as an overlay button underneath, rather than
       one big button: the concept chips are controls of their own, and a control
       nested inside a button is neither valid nor reachable by keyboard. The
       content layer passes clicks through to the overlay; only the chips take
       their own. */
    <div
      className={cn(
        "group relative w-full overflow-hidden rounded-xl border border-border bg-card p-3 text-left",
        "shadow-[var(--app-shadow-card)] transition-[border-color,box-shadow,transform] duration-200",
        "hover:-translate-y-px hover:border-[var(--border-strong)] hover:shadow-[var(--app-shadow-sheet)]",
        "focus-within:border-[var(--border-strong)]",
      )}
    >
      <button
        aria-label={`Open ${item.title}`}
        className="absolute inset-0 z-0 rounded-xl outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
        onClick={onOpen}
        type="button"
      />
      <div className="pointer-events-none relative z-10 flex min-h-[7.5rem] items-stretch gap-3">
        <ChallengeEmblem
          animated={false}
          className="mt-0.5 self-start transition-transform duration-300 group-hover:scale-[1.04]"
          question={item}
          size={40}
        />

        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate text-content font-semibold tracking-[-0.01em]">{item.title}</span>
            <DifficultyPill difficulty={item.difficulty} />
            {/* Where it came from, next to what it was worth: a history that mixes
                problems Spar wrote with problems the world asks has to say which
                is which, and who graded each one. */}
            {item.source && <SourceBadge size="compact" source={item.source} />}
            <OutcomeChip outcome={item.lastOutcome} />
            <span
              className="ml-auto shrink-0 text-muted-foreground/60"
              title={LANGUAGE_LABEL[item.language]}
            >
              <LanguageGlyph className="size-3.5" language={item.language} />
            </span>
            <span className="shrink-0 text-ui-sm tabular-nums text-muted-foreground/60">{relativeTime(item.updatedAt)}</span>
          </div>

          <p className="truncate text-ui text-muted-foreground">
            {item.sessionTitle}
            <span className="mx-1.5 text-muted-foreground/40">·</span>
            {item.testRunCount} test run{item.testRunCount === 1 ? "" : "s"}
            <span className="mx-1.5 text-muted-foreground/40">·</span>
            {item.attemptCount} attempt{item.attemptCount === 1 ? "" : "s"}
            {item.assistance && item.assistance !== "unknown" && <><span className="mx-1.5 text-muted-foreground/40">·</span>{item.assistance === "assisted" ? "Assisted" : "Independent"}</>}
          </p>

          {/* What the challenge was about, and the way into the rest of the
              history under each one: hover for the learner's standing there,
              click to open everything filed under it. */}
          <ConceptChips
            challenges={challenges}
            className="pointer-events-auto"
            concepts={item.concepts}
            onOpen={onOpenConcept}
            summaries={summaries}
          />

          {/* Lineage, when there is any. An adaptive swap is the most interesting
              thing in this list — it is the agent changing its mind — so it gets
              its own line rather than being folded into the metadata run-on. */}
          {item.replacesQuestionTitle && (
            <p className="flex min-w-0 items-center gap-1.5 text-ui-sm text-muted-foreground">
              <CornerDownRight className="size-3 shrink-0 text-muted-foreground/50" />
              Replaced
              <span className="min-w-0 truncate font-medium text-foreground/75">{item.replacesQuestionTitle}</span>
            </p>
          )}
          {item.replacedByQuestionTitle && (
            <p className="flex min-w-0 items-center gap-1.5 text-ui-sm text-muted-foreground">
              <ArrowRight className="size-3 shrink-0 text-muted-foreground/50" />
              Became
              <span className="min-w-0 truncate font-medium text-foreground/75">{item.replacedByQuestionTitle}</span>
            </p>
          )}

          <span
            className={cn(
              "mt-auto inline-flex w-fit items-center gap-1 pt-1 text-ui-sm font-medium text-muted-foreground/0",
              "transition-colors duration-200 group-hover:text-foreground/70",
            )}
          >
            <Play className="size-3" />
            Practise this again
          </span>
        </div>

        {preview && <CodePlate preview={preview} />}
      </div>
    </div>
  );
}

export function ChallengesPage({
  api,
  challenges,
  concepts,
  onOpen,
  onOpenConcept,
}: {
  api: SparApi | undefined;
  challenges: ChallengeHistorySummary[];
  concepts: ConceptSummary[];
  onOpen(challenge: ChallengeHistorySummary): void;
  onOpenConcept(slug: string): void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [previews, setPreviews] = useState<Record<string, ChallengeCodePreview>>({});

  /* Excerpts are fetched when the list is opened rather than carried on the
     bootstrap: they are a page's worth of code, and most launches never come
     here. A card without one renders fine, so nothing waits on this. */
  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    void api.listChallengePreviews().then((value) => {
      if (!cancelled) setPreviews(value);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [api, challenges.length]);

  const summaries = useMemo(() => new Map(concepts.map((concept) => [concept.slug, concept])), [concepts]);

  const counts = useMemo(
    () => Object.fromEntries(FILTERS.map((item) => [item.id, challenges.filter((row) => matches(row, item.id)).length])) as Record<Filter, number>,
    [challenges],
  );

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return challenges.filter((item) => {
      if (!matches(item, filter)) return false;
      if (!needle) return true;
      const concepts = item.concepts.map((concept) => concept.title).join(" ");
      return `${item.title} ${item.sessionTitle} ${item.language} ${item.difficulty} ${concepts} ${item.source ? `${item.source.source} ${item.source.displayId} ${item.source.difficulty}` : ""}`.toLowerCase().includes(needle);
    });
  }, [challenges, filter, query]);

  return (
    <div className="app-scroll h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[62rem] px-18 pb-16 pt-8">
        <h1 className="text-[1.35rem] font-semibold tracking-[-0.03em]">History</h1>
        <p className="mt-1 text-content text-muted-foreground">
          What you did: sourced and generated challenges, complete and incomplete attempts, assistance, test runs, submissions, and adaptive replacements.
          history. Open one to read it again, or to practise it without touching the session it came from.
        </p>

        <div className="mt-5 flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-border bg-[var(--color-background-elevated-secondary)] p-0.5">
            {FILTERS.map((item) => (
              <button
                key={item.id}
                className={cn(
                  "inline-flex h-6 items-center gap-1.5 rounded-md px-2.5 text-ui transition-colors",
                  filter === item.id
                    ? "bg-card text-foreground shadow-[var(--app-shadow-card)]"
                    : "text-muted-foreground hover:text-foreground",
                )}
                onClick={() => setFilter(item.id)}
                type="button"
              >
                {item.label}
                <span className="tabular-nums text-muted-foreground/60">{counts[item.id]}</span>
              </button>
            ))}
          </div>
          <div className="relative ml-auto w-60">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              className="h-7 w-full rounded-lg border border-border bg-card pl-7 pr-2 text-ui outline-none transition-colors placeholder:text-muted-foreground/70 focus-visible:border-[var(--border-strong)]"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter challenge history"
              value={query}
            />
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-2.5">
          {visible.length ? (
            visible.map((item) => (
              <ChallengeCard
                challenges={challenges}
                item={item}
                key={item.id}
                onOpen={() => onOpen(item)}
                onOpenConcept={onOpenConcept}
                preview={previews[item.id]}
                summaries={summaries}
              />
            ))
          ) : (
            <EmptyState
              description={
                challenges.length
                  ? "Clear the filters to see the rest of your challenge history."
                  : "A challenge appears here as soon as Spar compiles and validates it."
              }
              icon={History}
              title={challenges.length ? "Nothing matches this filter" : "No challenges yet"}
            />
          )}
        </div>
      </div>
    </div>
  );
}
