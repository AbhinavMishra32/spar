import { useEffect, useState } from "react";
import { IconArrowUpRight, IconChevronBottom, IconChevronRight, IconDumbell, IconSparklesTwo } from "central-icons";
import type { ConceptDetail, ConceptEvidence, ConceptSummary } from "@spar/domain";
import type { SparApi } from "../../../shared/api";
import { cn } from "@/lib/utils";
import { shortTime } from "@/lib/format";
import { CONCEPT_KIND_SHORT, CONCEPT_KIND_VAR, outcomeBands, standingOf } from "@/lib/concepts";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Meter, MeterKey } from "@/components/ui/meter";
import { LanguageMark, languageOf } from "../common/LanguageGlyph";
import { OUTCOME_ICON, OutcomeMark } from "./ConceptChip";
import { SparDots } from "@/components/common/SparDots";

/**
 * Everything the learner has done under one concept.
 *
 * Opens from any chip in the app, and it always opens instantly: the header and
 * the counts are drawn from the summary the caller already had, and the challenge
 * list fills in from the store underneath. A modal that shows a spinner where its
 * own title should be reads as slow even when the read takes a millisecond.
 */
export function ConceptSheet({
  api,
  onOpenChange,
  onOpenSession,
  onPractise,
  slug,
  summaries,
}: {
  api: SparApi | undefined;
  onOpenChange(open: boolean): void;
  onOpenSession(sessionId: string): void;
  onPractise(slug: string): void;
  slug: string | null;
  summaries: Map<string, ConceptSummary>;
}) {
  const [detail, setDetail] = useState<ConceptDetail | null>(null);
  const known = slug ? summaries.get(slug) ?? null : null;

  useEffect(() => {
    setDetail(null);
    if (!slug || !api) return;
    let live = true;
    void api.readConcept(slug).then((next) => { if (live) setDetail(next); }).catch(() => undefined);
    return () => { live = false; };
  }, [api, slug]);

  const concept = detail?.concept ?? known;
  const kindColor = concept ? CONCEPT_KIND_VAR[concept.kind] : undefined;

  return (
    <Dialog onOpenChange={onOpenChange} open={Boolean(slug)}>
      <DialogContent className="max-h-[min(44rem,calc(100vh-4rem))] gap-0 overflow-hidden p-0 sm:max-w-[36rem]">
        {concept ? (
          <div className="app-scroll relative flex max-h-[min(44rem,calc(100vh-4rem))] flex-col overflow-y-auto">
            {/* The kind's hue, as light falling on the top of the sheet. It says
                which shelf this is before a word is read, and fades out before
                the evidence starts so it never tints the numbers. */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 h-40 opacity-[0.09] dark:opacity-[0.14]"
              style={{ background: `radial-gradient(120% 100% at 0% 0%, ${kindColor}, transparent 70%)` }}
            />

            <header className="relative px-5 pb-4 pt-5">
              <p className="flex items-center gap-1.5 pr-8 text-ui-sm font-medium text-muted-foreground">
                <span aria-hidden className="size-2 shrink-0 rounded-full ring-[3px] ring-[color-mix(in_oklch,var(--dot)_22%,transparent)]" style={{ background: kindColor, ["--dot" as string]: kindColor }} />
                {CONCEPT_KIND_SHORT[concept.kind]}
                {concept.parentTitle && (
                  <>
                    <IconChevronRight className="size-3 text-muted-foreground/50" />
                    <span className="truncate">{concept.parentTitle}</span>
                  </>
                )}
              </p>
              <DialogTitle className="mt-2 pr-8 text-[1.375rem] font-semibold leading-[1.2] tracking-[-0.025em]">{concept.title}</DialogTitle>
              {concept.description && <p className="mt-1.5 text-ui leading-[1.6] text-muted-foreground">{concept.description}</p>}
            </header>

            <div className="relative px-5 pb-5">
              <Scorecard concept={concept} />
            </div>

            {/* The point of the whole feature: an area that averages out fine, with
                the one sub-concept that is not fine named underneath it. */}
            {detail?.children.length ? (
              <Section count={detail.children.length} title="By sub-concept">
                <div className="flex flex-col gap-2">
                  {detail.children.map((child) => <SubConcept concept={child} key={child.slug} />)}
                </div>
              </Section>
            ) : null}

            {detail?.abilities.length ? (
              <Section count={detail.abilities.length} title={detail.abilities.length === 1 ? "Ability" : "Abilities"}>
                <Abilities abilities={detail.abilities} />
              </Section>
            ) : null}

            <Section count={detail?.challenges.length} title="Challenges">
              {detail ? (
                detail.challenges.length ? (
                  <Challenges challenges={detail.challenges} onOpenSession={onOpenSession} />
                ) : (
                  <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-ui leading-[1.6] text-muted-foreground">
                    Nothing has been set under this yet. Practising it is how the first evidence gets here.
                  </p>
                )
              ) : (
                <p className="flex items-center gap-2 py-2 text-ui text-muted-foreground"><SparDots pattern="pulse" size={16} />Reading your history…</p>
              )}
            </Section>

            <footer className="sticky bottom-0 mt-auto flex items-center gap-3 border-t border-border/70 bg-popover/90 px-5 py-3 backdrop-blur-md">
              <p className="min-w-0 flex-1 text-ui-sm leading-[1.45] text-muted-foreground">
                The first challenge is aimed at whatever your evidence here says is still uncertain.
              </p>
              <Button className="shrink-0" onClick={() => onPractise(concept.slug)}>
                <IconDumbell />
                Practise this
              </Button>
            </footer>
          </div>
        ) : (
          <div className="grid h-40 place-items-center">
            <p className="flex items-center gap-2 text-ui text-muted-foreground"><SparDots pattern="sweep" size={18} label="Opening" />Opening…</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * The standing, said three ways at once: the word, the pass count it rests on,
 * and the bar that makes the count visible. Then the volume underneath it, as
 * plain numbers, because "strong across 2 challenges" and "strong across 40" are
 * different claims and the learner should be able to tell which one this is.
 */
function Scorecard({ concept }: { concept: ConceptSummary }) {
  const { label, tone } = standingOf(concept);
  const bands = outcomeBands(concept);

  if (!concept.challengeCount) {
    return (
      <div className="rounded-xl border border-dashed border-border px-4 py-5 text-center">
        <p className="text-content font-medium text-foreground/85">Untested</p>
        <p className="mt-0.5 text-ui text-muted-foreground">Nothing recorded here yet.</p>
      </div>
    );
  }

  const graded = concept.passedCount + concept.failedCount + concept.abandonedCount + concept.openCount;
  const stats = [
    { value: concept.challengeCount, label: concept.challengeCount === 1 ? "challenge" : "challenges" },
    { value: concept.testRunCount, label: concept.testRunCount === 1 ? "test run" : "test runs" },
    ...(concept.lastSeenAt ? [{ value: shortTime(concept.lastSeenAt), label: "last practised" }] : []),
  ];

  return (
    <div className="overflow-hidden rounded-xl border border-border/80 bg-[var(--color-background-elevated-primary)] shadow-[0_1px_2px_oklch(0%_0_0/4%)]">
      <div className="px-4 pb-3.5 pt-3.5">
        <div className="flex items-baseline justify-between gap-3">
          <span className={cn("text-[1.25rem] font-semibold leading-none tracking-[-0.025em]", tone)}>{label}</span>
          <span className="text-ui tabular-nums text-muted-foreground">
            <span className="font-semibold text-foreground">{concept.passedCount}</span>
            <span className="text-muted-foreground/60"> / {graded}</span> passed
          </span>
        </div>
        <Meter bands={bands} className="mt-3" height="0.5rem" />
        <div className="mt-2.5 flex flex-wrap gap-x-3.5 gap-y-1">
          {bands.filter((band) => band.value > 0).map((band) => <MeterKey band={band} className="text-ui-sm" key={band.key} />)}
        </div>
      </div>
      <dl className="grid border-t border-border/70" style={{ gridTemplateColumns: `repeat(${stats.length}, minmax(0, 1fr))` }}>
        {stats.map((stat, index) => (
          <div className={cn("px-4 py-2.5", index > 0 && "border-l border-border/70")} key={stat.label}>
            <dt className="sr-only">{stat.label}</dt>
            <dd className="text-content font-semibold tabular-nums leading-tight tracking-[-0.01em] text-foreground">{stat.value}</dd>
            <dd aria-hidden className="text-ui-sm text-muted-foreground/80">{stat.label}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

const ABILITY_STATUS: Record<string, { label: string; className: string }> = {
  independent: { label: "Independent", className: "text-[var(--success)] bg-[color-mix(in_oklch,var(--success)_12%,transparent)]" },
  developing: { label: "Developing", className: "text-foreground/70 bg-[var(--color-background-elevated-secondary)]" },
  uncertain: { label: "Uncertain", className: "text-[var(--warning)] bg-[color-mix(in_oklch,var(--warning)_14%,transparent)]" },
  stale: { label: "Stale", className: "text-muted-foreground bg-[var(--color-background-elevated-secondary)]" },
};

/** Abilities are sentences, not tags — so they read as a list, one per line,
 *  with where each one stands at the end of it. Six wrapped pills of prose is a
 *  paragraph nobody reads. */
function Abilities({ abilities }: { abilities: ConceptDetail["abilities"] }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? abilities : abilities.slice(0, 4);
  return (
    <div className="overflow-hidden rounded-xl border border-border/70">
      <ul className="divide-y divide-border/60">
        {shown.map((ability) => {
          const status = ABILITY_STATUS[ability.status];
          return (
            <li className="flex items-start gap-2.5 px-3 py-2.5" key={ability.id}>
              <IconSparklesTwo className="mt-[3px] size-3.5 shrink-0 text-muted-foreground/60" />
              <span className="min-w-0 flex-1 text-ui leading-[1.45] text-foreground/90">{ability.title.replace(/\.$/, "")}</span>
              {status && <span className={cn("mt-px shrink-0 rounded-full px-2 py-px text-[0.6875rem] font-medium leading-4", status.className)}>{status.label}</span>}
            </li>
          );
        })}
      </ul>
      {abilities.length > shown.length || expanded ? (
        <button
          className="flex w-full items-center justify-center gap-1 border-t border-border/60 py-2 text-ui-sm font-medium text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
          onClick={() => setExpanded((value) => !value)}
          type="button"
        >
          {expanded ? "Show fewer" : `Show ${abilities.length - shown.length} more`}
          <IconChevronBottom className={cn("size-3.5 transition-transform", expanded && "rotate-180")} />
        </button>
      ) : null}
    </div>
  );
}

/**
 * The evidence, newest first. A challenge that was set again under the same
 * session with the same title is one row with a count, not two identical rows —
 * a replaced challenge and its replacement are the same attempt to the learner.
 */
function Challenges({ challenges, onOpenSession }: { challenges: ConceptEvidence[]; onOpenSession(sessionId: string): void }) {
  const rows: { challenge: ConceptEvidence; times: number }[] = [];
  const seen = new Map<string, { challenge: ConceptEvidence; times: number }>();
  for (const challenge of challenges) {
    const key = `${challenge.sessionId}:${challenge.title}`;
    const existing = seen.get(key);
    if (existing) { existing.times += 1; continue; }
    const row = { challenge, times: 1 };
    seen.set(key, row);
    rows.push(row);
  }

  return (
    <div className="-mx-2 flex flex-col">
      {rows.map(({ challenge, times }) => {
        const language = languageOf(challenge.language);
        const tone = OUTCOME_ICON[challenge.outcome];
        return (
          <button
            className="group flex items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-accent/45 focus-visible:bg-accent/45 focus-visible:outline-none"
            key={challenge.challengeId}
            onClick={() => onOpenSession(challenge.sessionId)}
            type="button"
          >
            <span className="relative grid size-8 shrink-0 place-items-center rounded-lg border border-border/70 bg-[var(--color-background-elevated-primary)]">
              <OutcomeMark className="size-4" outcome={challenge.outcome} />
              {/* Resolved rather than cast: the evidence row carries the
                  language as plain text, and a value outside the three
                  Spar trains in has no mark rather than a broken one. */}
              {language && (
                <span className="absolute -bottom-1 -right-1 grid size-4 place-items-center rounded-full bg-popover ring-1 ring-border/70">
                  <LanguageMark className="size-2.5" language={language} />
                </span>
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="truncate text-ui font-medium text-foreground/90 group-hover:text-foreground">{challenge.title}</span>
                {times > 1 && <span className="shrink-0 rounded bg-[var(--color-background-elevated-secondary)] px-1 text-[0.6875rem] font-medium tabular-nums leading-4 text-muted-foreground">×{times}</span>}
              </span>
              <span className="mt-0.5 flex items-center gap-1.5 text-ui-sm text-muted-foreground/80">
                <span className="sr-only">{tone.label}.</span>
                <span className="truncate">{challenge.sessionTitle}</span>
                <span aria-hidden className="text-muted-foreground/40">·</span>
                <span className="shrink-0 capitalize">{challenge.difficulty}</span>
                {/* The same mark the chips use for the aim, so it reads as one
                    vocabulary across the app — and quiet, since most rows here
                    carry it. */}
                {challenge.role === "primary" && (
                  <span aria-label="aimed at this concept" className="shrink-0 text-[0.625rem] text-muted-foreground/55" title="Aimed at this concept">◆</span>
                )}
              </span>
            </span>
            <span className="shrink-0 tabular-nums text-ui-sm text-muted-foreground/70 transition-opacity group-hover:opacity-0">{shortTime(challenge.occurredAt)}</span>
            <IconArrowUpRight className="-ml-7 size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
          </button>
        );
      })}
    </div>
  );
}

function Section({ children, count, title }: { children: React.ReactNode; count?: number | undefined; title: string }) {
  return (
    <section className="border-t border-border/60 px-5 py-4">
      <h3 className="mb-2.5 flex items-center gap-1.5 text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-foreground/80">
        {title}
        {count !== undefined && <span className="tabular-nums font-medium text-muted-foreground/50">{count}</span>}
      </h3>
      {children}
    </section>
  );
}

/** The standing word, the bar, and the legend that makes the bar countable. */
export function Standing({ className, concept, compact = false }: { className?: string; concept: ConceptSummary; compact?: boolean }) {
  const { label, tone } = standingOf(concept);
  const bands = outcomeBands(concept);

  if (!concept.challengeCount) {
    return (
      <div className={cn("pb-3", className)}>
        <p className="text-ui text-muted-foreground">Untested — nothing recorded here yet.</p>
      </div>
    );
  }

  return (
    <div className={cn("pb-3", className)}>
      <div className="mb-1.5 flex items-baseline gap-2">
        <span className={cn("font-semibold tracking-[-0.02em]", compact ? "text-content" : "text-[1.05rem]", tone)}>{label}</span>
        <span className="text-ui text-muted-foreground">
          across {concept.challengeCount} challenge{concept.challengeCount === 1 ? "" : "s"}
          {concept.testRunCount > 0 && ` · ${concept.testRunCount} test run${concept.testRunCount === 1 ? "" : "s"}`}
          {concept.lastSeenAt && ` · last ${shortTime(concept.lastSeenAt)}`}
        </span>
      </div>
      <Meter animate={!compact} bands={bands} height="0.375rem" />
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
        {bands.filter((band) => band.value > 0).map((band) => <MeterKey band={band} key={band.key} />)}
      </div>
    </div>
  );
}

/** One sub-concept as a single line: name, standing, and its own bar. Same shape
 *  repeated so the eye can compare them down the column rather than read each. */
function SubConcept({ concept }: { concept: ConceptSummary }) {
  const { label, tone } = standingOf(concept);
  return (
    <div className="flex items-center gap-2.5">
      <span className="min-w-0 flex-[1.4] truncate text-ui text-foreground/85">{concept.title}</span>
      <Meter animate={false} bands={outcomeBands(concept)} className="flex-1" height="0.3125rem" />
      <span className={cn("w-12 shrink-0 text-right text-ui-sm font-medium", tone)}>{label}</span>
      <span className="w-8 shrink-0 text-right tabular-nums text-ui-sm text-muted-foreground/70">{concept.passedCount}/{concept.challengeCount}</span>
    </div>
  );
}
