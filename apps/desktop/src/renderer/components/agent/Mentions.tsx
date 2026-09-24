import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, CornerDownLeft, FileCheck2, Puzzle, Shapes } from "lucide-react";
import type { Language } from "@spar/domain";
import { cn } from "@/lib/utils";
import { LanguageGlyph } from "../common/LanguageGlyph";
import { CaseDots, SubmissionGlyph, outcomeWord } from "./SubmissionCard";
import type { SubmissionRow } from "../../../shared/submissions";

/**
 * `@`, and what it can reach.
 *
 * The learner could always describe what they meant — "the one where I used a
 * set", "my second try" — and Spar could always guess. Everything either of them
 * was pointing at is a real record with an id, so guessing was never necessary;
 * there was just no way to say which one. Typing `@` opens the things this
 * session actually contains and puts one of them in the message, as the same
 * `[[kind:id|words]]` reference the agent writes back.
 *
 * It opens on the kinds rather than on a list, because `@` is a question about
 * what can be referred to before it is a question about which one. Underneath,
 * challenges nest their own submissions: a submission only means anything inside
 * a problem, and remembering the problem before the attempt is the order the
 * learner remembers things in anyway. Submissions are also offered flat, for
 * when they are not.
 */

export type MentionChallenge = {
  id: string;
  ordinal: number;
  title: string;
  language: Language;
  outcome: "passed" | "failed" | "abandoned" | "replaced" | null;
  /** The session it belongs to, so the picker can lead with this one's. */
  sessionId: string;
  /* What a hover over the challenge's name draws. All of it is already in the
     window's own library listing, so the card costs no read — a tag that had to
     fetch before it could say what it was pointing at would flicker on every
     sentence that named a problem. */
  sessionTitle: string;
  difficulty: "foundation" | "developing" | "proficient" | "advanced";
  elapsedMs?: number | null | undefined;
  passedCases?: number | null | undefined;
  totalCases?: number | null | undefined;
  testRunCount?: number | undefined;
  concepts?: string[] | undefined;
};

export type MentionConcept = { slug: string; title: string; detail: string };

export type MentionSource = {
  challenges: MentionChallenge[];
  concepts: MentionConcept[];
  /** The session the composer belongs to. Its challenges sort first — the thing
   *  being referred to is nearly always in the conversation you are in. */
  sessionId?: string | undefined;
  /** The challenge the learner has open right now, marked in the list. */
  activeChallengeId?: string | undefined;
  listSubmissions(challengeId: string): Promise<SubmissionRow[]>;
  listSessionSubmissions(sessionId: string): Promise<SubmissionRow[]>;
};

const MentionContext = createContext<MentionSource | null>(null);

export function MentionProvider({ children, value }: { children: React.ReactNode; value: MentionSource | null }) {
  return <MentionContext.Provider value={value}>{children}</MentionContext.Provider>;
}

export function useMentionSource(): MentionSource | null {
  return useContext(MentionContext);
}

/* ---- Tokens, and the ids behind them ------------------------------------ */

/**
 * What a picked reference is, in two forms.
 *
 * The draft is a sentence the learner is writing, so what goes into it is a word
 * — `@Submission 2` — and not `[[submission:a1b5bf0b-…|Submission 2]]`. An id in
 * the field is an id in their way: it wraps onto a second line, it cannot be
 * read, and deleting it means deleting forty characters of hex. The markup is
 * what the message needs, so the token carries it alongside and the two part
 * company at the moment of sending.
 *
 * The map lives for as long as the window does. It is only ever grown, never
 * read back for anything but expansion, and a token nobody typed costs one
 * string: forgetting entries would only mean a reference that silently stopped
 * being one, which is the failure worth avoiding.
 */
export type Mention = { token: string; markup: string };

const remembered = new Map<string, string>();

export function mentionToken(kind: "challenge" | "submission" | "concept", id: string, label: string): Mention {
  const words = label.replace(/[[\]|@\n]/g, " ").replace(/\s+/g, " ").trim();
  const mention = { token: `@${words}`, markup: `[[${kind}:${id}|${words}]]` };
  remembered.set(mention.token, mention.markup);
  return mention;
}

/** The draft as the agent receives it: every token the learner picked put back
 *  to the reference it stands for. Longest first, so `@Submission 1` cannot eat
 *  the front of `@Submission 12`. */
export function expandMentions(text: string): string {
  if (!remembered.size) return text;
  let out = text;
  for (const token of [...remembered.keys()].sort((left, right) => right.length - left.length)) {
    if (out.includes(token)) out = out.split(token).join(remembered.get(token)!);
  }
  return out;
}

/** Where the tokens are, so the field can draw them as tags. Non-overlapping and
 *  in order; a token the learner has since typed over simply stops matching,
 *  which is the whole of the editing story. */
export function mentionSpans(text: string): Array<{ start: number; end: number }> {
  if (!remembered.size) return [];
  const spans: Array<{ start: number; end: number }> = [];
  for (const token of [...remembered.keys()].sort((left, right) => right.length - left.length)) {
    let from = 0;
    for (;;) {
      const at = text.indexOf(token, from);
      if (at === -1) break;
      from = at + token.length;
      /* A longer token already claimed this ground. Whichever matched first was
         the more specific one, which is the one the learner picked. */
      if (!spans.some((span) => at < span.end && from > span.start)) spans.push({ start: at, end: from });
    }
  }
  return spans.sort((left, right) => left.start - right.start);
}

/* ---- The trigger -------------------------------------------------------- */

/** Where an `@` that is being typed starts, or null. Only counts at the start of
 *  a word: an email address is not a mention, and neither is the `@` in a
 *  decorator the learner is quoting. */
export function mentionRange(value: string, caret: number): { start: number; query: string } | null {
  const before = value.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at === -1) return null;
  const preceding = at === 0 ? "" : before[at - 1]!;
  if (preceding && !/[\s(]/.test(preceding)) return null;
  const query = before.slice(at + 1);
  /* A newline ends it, and so does a long run of words — an `@` typed as
     punctuation halfway through a sentence should stop offering to complete
     itself rather than following the whole paragraph. */
  if (/\n/.test(query) || query.length > 48) return null;
  /* Clicking into the middle of a tag is not the start of a new mention. The
     `@` there belongs to a reference that has already been made. */
  if (mentionSpans(value).some((span) => at >= span.start && at < span.end)) return null;
  return { start: at, query };
}

/* ---- Levels ------------------------------------------------------------- */

type Level =
  | { at: "root" }
  | { at: "challenges" }
  | { at: "submissions" }
  | { at: "concepts" }
  | { at: "challenge"; challenge: MentionChallenge };

type Row = {
  key: string;
  label: string;
  detail: string;
  glyph: React.ReactNode;
  /** A row that goes deeper rather than inserting. */
  into?: Level;
  /** What it inserts, for a row that does. */
  pick?: Mention;
  /** Drawn between the label and the detail, where a row has a shape worth
   *  showing. */
  extra?: React.ReactNode;
  /** The challenge the learner is on. Drawn as the one lit row in the list. */
  live?: boolean;
  /** The heading this row sits under. Rows carry it rather than the list
   *  grouping them, because the order is already decided by the time they are
   *  built and a heading is just where that order changes its mind. */
  section?: string;
};

const OUTCOME_WORD: Record<string, string> = { passed: "solved", failed: "not solved", abandoned: "given up", replaced: "replaced" };

const CRUMB: Record<Level["at"], string> = {
  root: "Reference",
  challenges: "Challenges",
  submissions: "Submissions",
  concepts: "Concepts",
  challenge: "Challenges",
};

function matches(row: { label: string; detail: string }, query: string): boolean {
  if (!query) return true;
  const needle = query.toLowerCase();
  return row.label.toLowerCase().includes(needle) || row.detail.toLowerCase().includes(needle);
}

function challengeRow(challenge: MentionChallenge, live: boolean): Row {
  return {
    key: challenge.id,
    label: challenge.title,
    /* The open challenge says so instead of saying its outcome, which it does
       not have one of yet. */
    detail: live ? "The challenge on screen." : `challenge ${challenge.ordinal}${challenge.outcome ? ` · ${OUTCOME_WORD[challenge.outcome] ?? challenge.outcome}` : ""}`,
    glyph: <LanguageGlyph className={cn("size-3.5", live ? "text-[var(--reference)]" : "text-muted-foreground")} language={challenge.language} />,
    into: { at: "challenge", challenge },
    live,
  };
}

function submissionRow(submission: SubmissionRow, named: boolean): Row {
  return {
    key: submission.id,
    /* The number is the name; what it was an attempt at is the description. Away
       from its challenge the problem has to be said, because "Submission 2" on
       its own belongs to nothing. */
    label: `Submission ${submission.ordinal}`,
    detail: named ? `${submission.challengeTitle} · ${outcomeWord(submission)}` : outcomeWord(submission),
    glyph: <SubmissionGlyph judge={submission.judge} outcome={submission.outcome} size={14} />,
    pick: mentionToken("submission", submission.id, `Submission ${submission.ordinal} · ${submission.challengeTitle}`),
    extra: submission.totalCases > 0
      ? (
        <span className="flex shrink-0 items-center gap-1.5">
          <CaseDots cases={[]} className="shrink-0 flex-nowrap" max={12} passed={submission.passedCases} total={submission.totalCases} />
          <span className="text-thread-tool text-muted-foreground/60">{submission.passedCases}/{submission.totalCases}</span>
        </span>
      )
      : null,
  };
}

/* ---- The picker --------------------------------------------------------- */

/**
 * The list under the field.
 *
 * Deliberately a panel over the composer rather than a dropdown attached to the
 * caret: the caret moves while you type and a list that moves with it is a list
 * you cannot read. It sits where the composer is, which is where the learner is
 * already looking.
 */
export function MentionPicker({ onClose, onPick, query, source }: {
  onClose(): void;
  onPick(mention: Mention): void;
  query: string;
  source: MentionSource;
}) {
  const [level, setLevel] = useState<Level>({ at: "root" });
  const [submissions, setSubmissions] = useState<SubmissionRow[] | null>(null);
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);

  const wantsSubmissions = level.at === "challenge" || level.at === "submissions";
  const scope = level.at === "challenge" ? level.challenge.id : level.at === "submissions" ? source.sessionId ?? "" : "";

  useEffect(() => {
    if (!wantsSubmissions) return;
    let alive = true;
    setSubmissions(null);
    const read = level.at === "challenge" ? source.listSubmissions(scope) : scope ? source.listSessionSubmissions(scope) : Promise.resolve([]);
    void read.then((found) => { if (alive) setSubmissions(found); }).catch(() => { if (alive) setSubmissions([]); });
    return () => { alive = false; };
  }, [level.at, scope, source, wantsSubmissions]);

  const rows = useMemo<Row[]>(() => {
    if (level.at === "root") {
      /* The root is not filtered away by the query. Typing `@two` is a search
         for a thing, not for a category, so the categories stay and the rows
         under them are what the query narrows — which is why a root row says
         how many of its things match. */
      const found: Row[] = [];
      /* The thing they are looking at, first and by name. Nearly every "@" in a
         live session is about the challenge on screen, and making that one a
         category to open and a list to scan would be the picker charging three
         keystrokes for its most common answer. */
      const live = source.challenges.find((challenge) => challenge.id === source.activeChallengeId);
      if (live && matches({ label: live.title, detail: "open now" }, query)) {
        found.push({ ...challengeRow(live, true), section: "On screen" });
      }
      const challenges = source.challenges.filter((challenge) => matches({ label: challenge.title, detail: "" }, query));
      found.push({
        key: "challenges",
        section: "Browse",
        label: "Challenges",
        detail: query ? `${challenges.length} match` : "Any problem you have been given.",
        glyph: <Puzzle className="size-3.5 text-muted-foreground" />,
        into: { at: "challenges" },
      });
      if (source.sessionId) {
        found.push({
          key: "submissions",
          label: "Submissions",
          detail: "Every attempt you have sent off.",
          glyph: <FileCheck2 className="size-3.5 text-muted-foreground" />,
          into: { at: "submissions" },
        });
      }
      if (source.concepts.length) {
        const concepts = source.concepts.filter((concept) => matches({ label: concept.title, detail: concept.detail }, query));
        found.push({
          key: "concepts",
          label: "Concepts",
          detail: query ? `${concepts.length} match` : "Ideas that have come up so far.",
          glyph: <Shapes className="size-3.5 text-muted-foreground" />,
          into: { at: "concepts" },
        });
      }
      return found;
    }

    if (level.at === "challenges") {
      /* Already sorted this session first by the time it arrives here, so the
         heading only has to name the boundary it crosses. */
      return source.challenges
        .map((challenge): Row => ({
          ...challengeRow(challenge, challenge.id === source.activeChallengeId),
          section: !source.sessionId || challenge.sessionId === source.sessionId ? "This session" : "Earlier",
        }))
        .filter((row) => matches(row, query))
        .slice(0, 40);
    }

    if (level.at === "concepts") {
      return source.concepts
        .map((concept): Row => ({
          key: concept.slug,
          label: concept.title,
          detail: concept.detail,
          glyph: <Shapes className="size-3.5 text-muted-foreground" />,
          pick: mentionToken("concept", concept.slug, concept.title),
        }))
        .filter((row) => matches(row, query))
        .slice(0, 40);
    }

    const named = level.at === "submissions";
    const rows = (submissions ?? []).map((submission) => submissionRow(submission, named)).filter((row) => matches(row, query));
    /* The challenge itself, under its own submissions. Having opened a problem
       to point at an attempt at it, pointing at the problem instead is one row
       away rather than a trip back up. */
    if (level.at === "challenge") {
      return [{
        key: `challenge:${level.challenge.id}`,
        label: level.challenge.title,
        detail: "the challenge itself",
        glyph: <LanguageGlyph className="size-3.5 text-muted-foreground" language={level.challenge.language} />,
        pick: mentionToken("challenge", level.challenge.id, level.challenge.title),
        section: "The problem",
      }, ...rows.map((row): Row => ({ ...row, section: "Submissions" }))];
    }
    return rows.slice(0, 40);
  }, [level, query, source, submissions]);

  useEffect(() => { setActive(0); }, [level, query, submissions]);

  const enter = useCallback((row: Row) => {
    if (row.into) return setLevel(row.into);
    if (row.pick) onPick(row.pick);
  }, [onPick]);

  const back = useCallback(() => {
    setLevel((current) => (current.at === "challenge" ? { at: "challenges" } : current.at === "root" ? current : { at: "root" }));
  }, []);

  /* Bound on the window because the caret stays in the textarea the whole time —
     the picker never takes focus, so the field keeps working and the keys that
     drive the list are the ones the list would have taken anyway. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); if (level.at === "root") onClose(); else back(); return; }
      if (event.key === "ArrowDown") { event.preventDefault(); setActive((current) => (rows.length ? (current + 1) % rows.length : 0)); return; }
      if (event.key === "ArrowUp") { event.preventDefault(); setActive((current) => (rows.length ? (current - 1 + rows.length) % rows.length : 0)); return; }
      if (event.key === "ArrowLeft" && level.at !== "root") { event.preventDefault(); back(); return; }
      const row = rows[active];
      if (!row) return;
      if ((event.key === "ArrowRight" || event.key === "Tab") && row.into) { event.preventDefault(); setLevel(row.into); return; }
      if (event.key === "Enter") { event.preventDefault(); enter(row); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [active, back, enter, level.at, onClose, rows]);

  useEffect(() => {
    list.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active, rows.length]);

  return (
    <div
      className="mention-panel absolute bottom-full left-0 z-30 mb-2 w-auto min-w-[20rem] max-w-full overflow-hidden rounded-[calc(1rem*1.2)] p-2 [corner-shape:superellipse(1.2)]"
      /* Focus never leaves the field. The picker is driven from the caret, and a
         click that blurred the textarea would close the very mention it was
         trying to complete. */
      onMouseDown={(event) => event.preventDefault()}
    >
      {level.at !== "root" && <Crumbs level={level} onGo={setLevel} />}

      <div className="app-scroll max-h-[17rem] min-w-0 overflow-y-auto" ref={list}>
        {wantsSubmissions && submissions === null && <Empty>Reading submissions…</Empty>}
        {rows.length === 0 && !(wantsSubmissions && submissions === null) && <Empty>{nothing(level, query)}</Empty>}
        {rows.map((row, index) => (
          <div key={row.key}>
            {row.section && row.section !== rows[index - 1]?.section && <Heading>{row.section}</Heading>}
            <button
              className={cn(
                "flex w-full min-w-0 items-center gap-2.5 rounded-[var(--radius-md)] px-2.5 py-1.5 text-left outline-none",
                index === active && "bg-[var(--color-background-elevated-secondary)]",
              )}
              data-active={index === active}
              onClick={() => enter(row)}
              onMouseMove={() => setActive(index)}
              type="button"
            >
              <span aria-hidden className="grid size-4 shrink-0 place-items-center">{row.glyph}</span>
              {/* Label and description on one line, the description picking up
                  where the label stops. A description in its own column would be
                  a second thing to read; here it is the rest of the sentence the
                  label starts, which is how a menu explains itself. */}
              <span className="flex min-w-0 flex-1 items-baseline gap-2">
                <span className={cn("shrink-0 truncate text-thread font-medium", row.live ? "text-[var(--reference)]" : "text-foreground")}>
                  {row.label}
                </span>
                <span className="min-w-0 truncate text-thread text-muted-foreground/70">{row.detail}</span>
              </span>
              {row.extra}
              {row.into && (
                <ChevronRight
                  aria-hidden
                  className={cn("size-3.5 shrink-0", index === active ? "text-muted-foreground/60" : "text-muted-foreground/25")}
                />
              )}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The label over a run of rows. Sentence case and the same size as the rows —
 *  small caps would make it a label on a form, and this is a heading in a menu. */
function Heading({ children }: { children: React.ReactNode }) {
  return <p className="px-2.5 pb-1 pt-2 text-thread text-muted-foreground/60 first:pt-0.5">{children}</p>;
}

/** Where you are, and the way back. Only drawn once there is a way back: at the
 *  top level the section headings already say what the list is. */
function Crumbs({ level, onGo }: { level: Level; onGo(level: Level): void }) {
  const trail: Array<{ label: string; level: Level | null }> = [{ label: CRUMB.root, level: { at: "root" } }];
  if (level.at !== "root") trail.push({ label: CRUMB[level.at], level: level.at === "challenge" ? { at: "challenges" } : null });
  if (level.at === "challenge") trail.push({ label: level.challenge.title, level: null });

  return (
    <div className="flex min-w-0 items-center gap-1.5 px-2.5 pb-1.5 pt-0.5 text-thread text-muted-foreground/60">
      {trail.map((step, index) => (
        <span className="flex min-w-0 items-center gap-1.5" key={index}>
          {index > 0 && <ChevronRight aria-hidden className="size-3 shrink-0 text-muted-foreground/40" />}
          {step.level
            ? (
              <button
                className="shrink-0 rounded-[3px] outline-none transition-colors hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
                onClick={() => onGo(step.level!)}
                type="button"
              >
                {step.label}
              </button>
            )
            : <span className="min-w-0 truncate text-foreground/75">{step.label}</span>}
        </span>
      ))}
    </div>
  );
}

function nothing(level: Level, query: string): string {
  if (level.at === "challenge") return "Nothing was submitted at this challenge.";
  if (level.at === "submissions") return "You have not submitted anything in this session yet.";
  if (query) return `Nothing matches “${query}”.`;
  return "There is nothing here to reference yet.";
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-2.5 py-2 text-thread text-muted-foreground/70">{children}</p>;
}
