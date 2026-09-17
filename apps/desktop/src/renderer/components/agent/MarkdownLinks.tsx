import { createContext, useContext, useEffect, useState } from "react";
import { BookOpen, FileCheck2, FileCode2, Puzzle, Shapes, SquareArrowOutUpRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { SubmissionGlyph, SubmissionPeek } from "./SubmissionCard";
import { ReferenceTag } from "./ReferenceTag";
import { LanguageGlyph } from "../common/LanguageGlyph";
import { useMentionSource } from "./Mentions";
import { ChallengePeek } from "./ChallengePeek";
import type { SubmissionRecord } from "../../../shared/submissions";

/**
 * The agent's own references, made live.
 *
 * The prompt has the agent write `[[file:hello.cpp|hello.cpp]]` and
 * `[[concept:cpp.kernel-basics|the C++ for GPU kernels card]]`, and until now
 * the transcript printed those brackets verbatim — the learner read the syntax
 * of a link rather than following one.
 *
 * A file reference resolves before it is drawn, and says something different
 * depending on the answer: one that exists opens the file, and one that does not
 * offers to create it. That second case is the useful one — the agent asks for a
 * file precisely when it does not exist yet, so "create hello.cpp" is the action
 * the sentence is actually asking for.
 */
export type MarkdownLinks = {
  /** The project's language, used to colour inline code.
   *
   *  A fenced block names its own language; an inline span cannot, so the only
   *  honest guess is the language of the project the snippet is being written
   *  about. Absent means no colouring, which is what the transcript did before
   *  and is never wrong — only plainer. */
  language?: string | undefined;
  onOpenConcept?: ((conceptId: string) => void) | undefined;
  /** Opens a lesson Spar has already taught. This is what makes "I showed you
   *  this" a thing the learner can act on rather than a claim. */
  onOpenLesson?: ((lessonId: string) => void) | undefined;
  /** The lesson the reader currently has open, if any. A card whose lesson is
   *  open hands its pixels to the reader for the duration — the two share a
   *  layout id, and a shared-layout animation with both ends drawn is a ghost. */
  openLessonId?: string | null | undefined;
  /** Opens a web page outside the app. The renderer cannot navigate — the window
   *  denies it — so a search result is only a link where the surface around the
   *  transcript has handed it the door. Undefined leaves results unclickable
   *  rather than dead. */
  onOpenUrl?: ((url: string) => void) | undefined;
  /** Opens a submission the learner made. The agent cites one whenever it says
   *  something about a specific thing they sent, and without this the sentence
   *  is back to being a claim. */
  onOpenSubmission?: ((submissionId: string) => void) | undefined;
  /** Reads one for the hover card. Separate from opening it because the card is
   *  the whole point of the reference — most of the time the learner wants to
   *  glance at what they sent, not leave the conversation for it. */
  readSubmission?: ((submissionId: string) => Promise<SubmissionRecord | null>) | undefined;
  /** Opens a challenge's own page. Both sides of the conversation name
   *  challenges constantly, and until `@` there was no way for either of them to
   *  do it as anything but a title in quotes. */
  onOpenChallenge?: ((challengeId: string) => void) | undefined;
  onOpenFile?: ((path: string) => void) | undefined;
  onCreateFile?: ((path: string) => void) | undefined;
  /** Resolves whether a project-relative path is on disk. Undefined while the
   *  transcript is rendered somewhere with no project behind it. */
  checkFile?: ((path: string) => Promise<boolean>) | undefined;
};

const LinkContext = createContext<MarkdownLinks>({});

export function MarkdownLinkProvider({ children, value }: { children: React.ReactNode; value: MarkdownLinks }) {
  return <LinkContext.Provider value={value}>{children}</LinkContext.Provider>;
}

/** `[[kind:target|label]]`, with the label optional. Kept loose on the target so
 *  a concept id with dots and a path with slashes both survive. */
/** What the surrounding surface has told the transcript about itself. */
export function useMarkdownLinks(): MarkdownLinks {
  return useContext(LinkContext);
}

export type ReferenceKind = (typeof REFERENCE_KINDS)[number];
/** The kinds, once. The inline tokeniser in `Markdown` builds its own
 *  alternation and used to carry a second copy of this list — which is how
 *  `[[submission:…]]` came to print as its own markup in a reply for as long as
 *  it took to notice. */
export const REFERENCE_KINDS = ["concept", "file", "lesson", "submission", "challenge"] as const;
export const REFERENCE_PATTERN = new RegExp(`\\[\\[(${REFERENCE_KINDS.join("|")}):([^\\]|]+?)(?:\\|([^\\]]*))?\\]\\]`);

export function parseReference(value: string): { kind: ReferenceKind; target: string; label: string } | null {
  const match = REFERENCE_PATTERN.exec(value);
  if (!match) return null;
  const kind = match[1] as ReferenceKind;
  const target = match[2]!.trim();
  const label = (match[3] ?? "").trim() || target;
  return { kind, target, label };
}

/* A reference is a word in a sentence, not a widget in one.
 *
 *  It used to be drawn as a chip: a boxed label with an icon and a dotted rule
 *  under it, which in a paragraph of three of them turned the prose into a row
 *  of buttons the eye had to step over. What a reader needs is the thing every
 *  link on every page has already taught them — coloured text, underlined when
 *  the pointer is on it. The icons moved to the cards under the reply, where
 *  there is room to say which kind of thing each one is. */
const CHIP =
  "cursor-pointer rounded-[3px] text-[var(--reference)] underline-offset-[3px] transition-colors outline-none hover:text-[var(--reference-strong)] hover:underline focus-visible:ring-2 focus-visible:ring-ring/50";

export function Reference({ kind, target, label }: { kind: ReferenceKind; target: string; label: string }) {
  const links = useContext(LinkContext);
  /* `undefined` until the answer is in. The link renders as plain text in that
     window rather than flickering between two different affordances. */
  const [present, setPresent] = useState<boolean | undefined>(kind === "file" ? undefined : true);

  useEffect(() => {
    if (kind !== "file" || !links.checkFile) return;
    let alive = true;
    void links.checkFile(target).then((exists) => { if (alive) setPresent(exists); });
    return () => { alive = false; };
  }, [kind, links, target]);

  /* A lesson Spar wrote — a claim about what already happened between these two,
     "I taught you this", and the learner should be able to follow it.

     Plain text when nothing can open it: a blue word that does nothing is worse
     than the black one it replaced. */
  if (kind === "lesson") {
    if (!links.onOpenLesson) return <span className="font-medium">{label}</span>;
    return (
      <ReferenceTag
        glyph={<BookOpen className="size-3" />}
        label={label}
        onClick={() => links.onOpenLesson?.(target)}
        title="Open the lesson"
      />
    );
  }

  /* A submission is the one reference whose hover is worth more than its click.
     The claim being made is about a specific thing the learner sent — which case
     it failed, what they had written at that point — and the answer is small
     enough to sit under the pointer. Clicking is the way through to the whole
     of it. */
  if (kind === "submission") {
    if (!links.readSubmission && !links.onOpenSubmission) return <span className="font-medium">{label}</span>;
    return <SubmissionReference label={label} target={target} />;
  }

  if (kind === "challenge") {
    if (!links.onOpenChallenge) return <span className="font-medium">{label}</span>;
    return <ChallengeReference label={label} target={target} />;
  }

  if (kind === "concept") {
    return (
      <ReferenceTag
        glyph={<Shapes className="size-3" />}
        label={label}
        onClick={() => links.onOpenConcept?.(target)}
        title="Open the concept card"
      />
    );
  }

  if (present === undefined) return <span className="font-medium">{label}</span>;

  if (present) {
    return (
      <ReferenceTag
        glyph={<FileCode2 className="size-3" />}
        label={label}
        onClick={() => links.onOpenFile?.(target)}
        title="Open the file"
      />
    );
  }

  /* Missing. The tooltip names the action rather than the state — "create hello.cpp" is what clicking does, and "hello.cpp does not exist" is a fact
     the learner can already see from the sentence around it. */
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <ReferenceTag
          glyph={<FileCode2 className="size-3" />}
          label={label}
          onClick={() => links.onCreateFile?.(target)}
          tone="muted"
        />
      </TooltipTrigger>
      <TooltipContent>
        Create <code className="font-mono">{target}</code>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * A problem, wherever it is named.
 *
 * Its language, standing and history are already in the window's own library
 * listing, so the tag draws its icon without a read and the card under it costs
 * only the submissions. A tag that had to fetch before it could say what kind of
 * thing it was pointing at would flicker on every sentence that named a problem.
 */
function ChallengeReference({ label, target }: { label: string; target: string }) {
  const links = useContext(LinkContext);
  const source = useMentionSource();
  const known = source?.challenges.find((challenge) => challenge.id === target);
  const [open, setOpen] = useState(false);

  const word = (
    <ReferenceTag
      glyph={known ? <LanguageGlyph className="size-3.5" language={known.language} /> : <Puzzle className="size-3" />}
      label={label}
      onClick={() => links.onOpenChallenge?.(target)}
      title="Open the challenge"
    />
  );

  /* Nothing to say about a challenge this window has never listed — an older
     session's, or one already deleted. The word still opens it. */
  if (!known || !source) return word;

  return (
    <HoverCard closeDelay={80} onOpenChange={setOpen} open={open} openDelay={0}>
      <HoverCardTrigger asChild>{word}</HoverCardTrigger>
      <HoverCardContent align="start" className="w-auto p-3" instant side="top">
        <ChallengePeek
          challenge={known}
          listSubmissions={source.listSubmissions}
          {...(links.readSubmission ? { readSubmission: links.readSubmission } : {})}
        />
      </HoverCardContent>
    </HoverCard>
  );
}

/**
 * The blue words, with what they name underneath them.
 *
 * Read on hover rather than up front: a reply can cite four submissions and the
 * learner will open none of them, so four reads on render is four reads wasted.
 * The card holds its own answer once it has it, because the pointer leaving and
 * coming back is not a new question.
 */
function SubmissionReference({ label, target }: { label: string; target: string }) {
  const links = useContext(LinkContext);
  const [submission, setSubmission] = useState<SubmissionRecord | null | undefined>(undefined);
  const [open, setOpen] = useState(false);
  /* The read starts when the pointer arrives, not when the card does. The card
     opens on the same frame the pointer lands, so waiting for it to open before
     asking would guarantee the learner reads "Reading the submission…" first —
     the few milliseconds the pointer spends crossing the word are exactly the
     window the read needs. */
  const [wanted, setWanted] = useState(false);

  useEffect(() => {
    if (!wanted || submission !== undefined || !links.readSubmission) return;
    let alive = true;
    void links.readSubmission(target).then((found) => { if (alive) setSubmission(found); }).catch(() => { if (alive) setSubmission(null); });
    return () => { alive = false; };
  }, [links, submission, target, wanted]);

  /* The glyph firms up once the record is in — the judge that graded it and how
     it went. Until then it is the generic one, and the tint never changes, so
     the tag settles rather than flashing a colour at the learner. */
  const word = (
    <span onFocus={() => setWanted(true)} onPointerEnter={() => setWanted(true)}>
      <ReferenceTag
        glyph={submission
          ? <SubmissionGlyph judge={submission.judge} outcome={submission.outcome} size={12} />
          : <FileCheck2 className="size-3" />}
        label={label}
        onClick={() => links.onOpenSubmission?.(target)}
        title="Open this submission"
      />
    </span>
  );

  if (!links.readSubmission) return word;

  return (
    <HoverCard closeDelay={80} onOpenChange={setOpen} open={open} openDelay={0}>
      <HoverCardTrigger asChild>{word}</HoverCardTrigger>
      <HoverCardContent align="start" className="w-auto p-3" instant side="top">
        {submission === undefined
          ? <span className="block w-[22rem] max-w-full text-thread-tool text-muted-foreground">Reading the submission…</span>
          : submission === null
            ? <span className="block w-[16rem] max-w-full text-thread-tool text-muted-foreground">That submission is no longer recorded.</span>
            : <SubmissionPeek submission={submission} />}
      </HoverCardContent>
    </HoverCard>
  );
}

const REFERENCE_PATTERN_ALL = new RegExp(REFERENCE_PATTERN.source, "g");

/**
 * Every reference a message made, in the order it made them.
 *
 * The same card named three times in a paragraph is one thing to read next, not
 * three, so the list is keyed on kind and target — the label can differ each
 * time ("the sliding-window card", "that card") and the first one wins, because
 * that is the one the reader has already met by the time they reach the foot of
 * the reply.
 */
export function collectReferences(source: string): Array<{ kind: ReferenceKind; target: string; label: string }> {
  const seen = new Set<string>();
  const found: Array<{ kind: ReferenceKind; target: string; label: string }> = [];
  for (const match of source.matchAll(REFERENCE_PATTERN_ALL)) {
    const parsed = parseReference(match[0]);
    if (!parsed) continue;
    const key = `${parsed.kind}:${parsed.target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    found.push(parsed);
  }
  return found;
}

const CARD_ICON = { concept: Shapes, lesson: BookOpen, file: SquareArrowOutUpRight, submission: FileCheck2, challenge: Puzzle } as const;

/**
 * What the reply pointed at, gathered under it.
 *
 * The sentence keeps its blue words; this is the second reading of the same
 * thing — tags at the foot of the answer, the way a chat interface shows its
 * sources. It exists because a reference inside a paragraph is easy to read
 * past, and "what should I open now" is a question the reader asks after they
 * have finished the paragraph, not during it.
 *
 * Quieter than the lesson-tab pill on purpose. A tab is a control the reader
 * is meant to work: it gets the card material, a border, a numbered tile. This
 * is an afterthought at the foot of a paragraph whose blue words already said
 * the same thing, so it keeps the pill silhouette — the app's word for "a small
 * thing you can open" — and drops everything else: no border, no shadow, no
 * icon tile, just a faint wash, a bare glyph and muted text that comes forward
 * on hover. Same family, lower voice.
 *
 * File references stay out of it. A file is a thing the reply is working on
 * rather than a thing to read next, and a tag per filename under every message
 * would bury the one that is actually an invitation.
 */
export function ReferenceCards({ source }: { source: string }) {
  const links = useContext(LinkContext);
  const references = collectReferences(source);
  /* Submissions stay out of the footer for the same reason files do: a reply
     that cites three of them is working through the learner's history, and three
     tags under it would bury whichever lesson or concept is the actual
     invitation. The blue word in the sentence, with its card, is the whole
     affordance. */
  const shown = references.filter((reference) =>
    reference.kind === "lesson" ? Boolean(links.onOpenLesson)
    : reference.kind === "concept" ? Boolean(links.onOpenConcept)
    : false);
  if (shown.length === 0) return null;

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {shown.map((reference) => {
        const Icon = CARD_ICON[reference.kind];
        return (
          <button
            key={`${reference.kind}:${reference.target}`}
            className="pill-corner flex w-max min-w-0 max-w-[16rem] shrink-0 items-center gap-1.5 bg-[var(--color-background-elevated-secondary)]/60 py-1 pl-2.5 pr-3 text-left text-muted-foreground outline-none transition-colors hover:bg-[var(--color-background-elevated-secondary)] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => (reference.kind === "lesson" ? links.onOpenLesson?.(reference.target) : links.onOpenConcept?.(reference.target))}
            title={reference.kind === "lesson" ? "Open the lesson" : "Open the concept card"}
            type="button"
          >
            <Icon className="size-3 shrink-0 opacity-70" aria-hidden />
            <span className="min-w-0 truncate text-thread-tool">{reference.label}</span>
          </button>
        );
      })}
    </div>
  );
}
