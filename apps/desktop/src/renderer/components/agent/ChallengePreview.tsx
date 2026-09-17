import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { fileName } from "@/lib/format";
import { CodePeek } from "../common/CodePeek";
import { LanguageGlyph, LANGUAGE_LABEL } from "../common/LanguageGlyph";
import { SourceGlyph } from "../common/SourceGlyph";
import { IconPuzzle } from "./threadIcons";
import { BAND_WORD, ChallengeCardMeta, ChallengeOutcomeTag, DIFFICULTY_WORD } from "./ChallengeCardMeta";
import type { Language } from "@spar/domain";
import type { PublishedChallenge } from "./publishedChallenge";
import type { ChallengeStop } from "../workspace/ChallengeStepper";

/** Lines of starter the panel shows before it fades out. Enough for a signature,
 *  its doc line and the body it opens, which is the whole of what a reminder
 *  needs — past that it is a file viewer, and the workspace is the file viewer. */
const PEEK_LINES = 12;

/**
 * What the card could not fit, for the second the pointer rests on it.
 *
 * The card is a handover and is sized to be read at a glance from the middle of
 * a scrolling transcript, so everything that makes one challenge distinguishable
 * from the four above it — what it actually asks, and the file it opens — had
 * nowhere to go. Hovering a challenge from an hour ago and being shown its title
 * again is the failure this fixes: the title is what you hovered, so it cannot
 * also be the answer.
 *
 * Deliberately not the problem statement. The statement is the one thing the
 * learner will read in full the moment they open the challenge, so four clamped
 * lines of it in a panel is a worse copy of a document that already exists — and
 * it is also the slowest thing here to recognise, because every statement opens
 * the same way. The starter file is the opposite: one glance at the signature
 * says which challenge this was. So: the code, and what happened to it.
 */
/**
 * Everything the panel draws, however the caller came by it.
 *
 * The two surfaces that raise a preview reach for different records — the front
 * card reads the tool row that published the challenge, and a row in the session
 * stack reads the store's own summary of one — and neither is a superset of the
 * other. One view model rather than two panels, because the panel is a promise
 * about what a challenge preview looks like, and two of them would be two.
 */
export type ChallengePreviewData = {
  title: string;
  ordinal: number | null;
  language: Language | null;
  /** How hard, already in the grader's own words — the two graders name levels
   *  differently and the panel is not the place to work out which said it. */
  level: string | null;
  source: "leetcode" | "codeforces" | null;
  sourceName: string;
  displayId: string | null;
  cases: number | null;
  concepts: string[];
  /** The file they open. Without one there is no preview worth raising. */
  starter: { path: string; code: string; remainingLines?: number | undefined } | null;
};

/** The view model off a transcript row. */
export function publishedPreviewData(
  challenge: PublishedChallenge,
  source: "leetcode" | "codeforces" | null,
  sourceName: string,
): ChallengePreviewData {
  return {
    title: challenge.title,
    ordinal: challenge.ordinal,
    language: challenge.language,
    level: challenge.difficulty ? DIFFICULTY_WORD[challenge.difficulty] ?? null : challenge.band ? BAND_WORD[challenge.band] ?? null : null,
    source,
    sourceName,
    displayId: challenge.displayId,
    cases: challenge.cases,
    concepts: challenge.concepts,
    starter: challenge.starter,
  };
}

/** The view model off a stop in the session stack. */
export function stopPreviewData(stop: ChallengeStop): ChallengePreviewData {
  return {
    title: stop.title,
    ordinal: stop.ordinal,
    language: stop.language ?? null,
    level: stop.difficulty ? DIFFICULTY_WORD[stop.difficulty] ?? null : null,
    source: stop.source ?? null,
    sourceName: stop.source === "codeforces" ? "Codeforces" : stop.source === "leetcode" ? "LeetCode" : "",
    displayId: null,
    cases: stop.totalCases ?? null,
    concepts: stop.concepts ?? [],
    starter: stop.code ? { path: stop.code.path, code: stop.code.code, remainingLines: stop.code.remainingLines } : null,
  };
}

/** Whether there is anything here the row did not already say. A panel that
 *  opens to repeat the row under it is worse than no panel, and without the
 *  starter file that is all this would be. */
export function hasChallengePreview(data: ChallengePreviewData): boolean {
  return Boolean(data.starter?.code.trim());
}

export function ChallengePreview({ data, stop }: {
  data: ChallengePreviewData;
  /** The session's record of it, when the learner has already been here. */
  stop?: ChallengeStop | undefined;
}) {
  const excerpt = useMemo(
    () => codeExcerpt(data.starter?.code ?? "", data.starter?.remainingLines ?? 0),
    [data.starter?.code, data.starter?.remainingLines],
  );

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex min-w-0 items-start gap-2">
        <span className="mt-px grid size-7 shrink-0 place-items-center rounded-[var(--radius-md)] bg-[var(--color-background-elevated-secondary)] ring-[0.5px] ring-[var(--border-surface-strong)]">
          {data.source
            ? <SourceGlyph className="size-4" source={data.source} />
            : data.language
              ? <LanguageGlyph aria-label={LANGUAGE_LABEL[data.language]} className="size-4" language={data.language} role="img" />
              : <IconPuzzle className="size-4 text-[var(--transcript-step-mark)]" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start gap-1.5">
            {data.ordinal ? <span className="mt-px shrink-0 font-mono text-thread-tool tabular-nums text-muted-foreground/60">#{data.ordinal}</span> : null}
            <span className="min-w-0 flex-1 text-thread font-semibold leading-snug text-foreground">{data.title}</span>
            {stop && <ChallengeOutcomeTag outcome={stop.outcome} />}
          </div>
          {/* The three facts that place it: how hard, what in, who decides. Not
              repeated in the footer, which is about what happened instead. */}
          <p className="mt-0.5 flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-thread-tool text-muted-foreground">
            {data.level && <span className="font-medium text-foreground/70">{data.level}</span>}
            {data.language && <span>· {LANGUAGE_LABEL[data.language]}</span>}
            <span className="whitespace-nowrap">
              {data.source
                ? `· ${data.sourceName}${data.displayId ? ` ${data.displayId}` : ""}`
                : data.cases
                  ? `· ${data.cases} cases`
                  : "· validated"}
            </span>
          </p>
        </div>
      </div>

      {/* Every tag, not the card's two: there is room here, and the third one is
          often the reason this challenge came after the last. */}
      {data.concepts.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {data.concepts.slice(0, 4).map((concept) => (
            <span
              className="max-w-full truncate rounded-md border border-border/70 bg-[var(--color-background-elevated-secondary)] px-1.5 py-px text-thread-tool text-foreground/80"
              key={concept}
            >
              {concept}
            </span>
          ))}
        </div>
      )}

      {data.starter && excerpt.code && (
        <div className="relative overflow-hidden rounded-lg bg-[var(--color-background-editor)] shadow-[inset_0_0_0_1px_var(--border)]">
          <div className="flex h-6 items-center gap-1.5 border-b border-border/70 px-2">
            <span className="truncate font-mono text-thread-tool text-muted-foreground/70">{fileName(data.starter.path)}</span>
            {excerpt.remaining > 0 && (
              <span className="ml-auto shrink-0 font-mono text-thread-tool tabular-nums text-muted-foreground/45">+{excerpt.remaining}</span>
            )}
          </div>
          <div className="relative">
            <CodePeek className="px-2.5 py-1.5" code={excerpt.code} />
            {/* A hard cut reads as a rendering fault; the fade says "there is
                more" without the panel having to write it out. */}
            {excerpt.remaining > 0 && (
              <span className="pointer-events-none absolute inset-x-0 bottom-0 h-7 bg-gradient-to-b from-transparent to-[var(--color-background-editor)]" />
            )}
            {/* Lines are not wrapped — a wrapped signature is a different shape
                from the one in the editor, and the shape is what is being
                recognised — so the long ones run off the right and are faded out
                the same way the bottom is. */}
            <span className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-r from-transparent to-[var(--color-background-editor)]" />
          </div>
        </div>
      )}

      {stop && <ChallengeCardMeta stop={stop} />}
    </div>
  );
}

/**
 * The top of the file, with its leading blank lines dropped so the excerpt
 * starts on something rather than on the gap above it.
 *
 * `alreadyCut` is what the caller's source dropped before handing the code over
 * — the store's own preview arrives pre-truncated — so the "+N" the plate prints
 * is the whole of what the file keeps going for, not just the part this function
 * trimmed. Counting only its own cut would tell a learner a 200-line file has
 * three more lines in it.
 */
function codeExcerpt(code: string, alreadyCut = 0): { code: string; remaining: number } {
  const lines = code.replace(/\t/g, "  ").split("\n");
  while (lines.length > 0 && !lines[0]!.trim()) lines.shift();
  while (lines.length > 0 && !lines[lines.length - 1]!.trim()) lines.pop();
  return {
    code: lines.slice(0, PEEK_LINES).join("\n"),
    remaining: Math.max(0, lines.length - PEEK_LINES) + Math.max(0, alreadyCut),
  };
}

/** How far off the pointer the panel sits. Far enough that the cursor never
 *  overlaps the first character, close enough that it reads as attached to the
 *  pointer rather than as something that opened elsewhere. */
const CURSOR_GAP = 18;
/** Clearance kept from the window's own edges. */
const EDGE = 12;
/** How long the pointer has to stay on a card before the panel opens. The
 *  transcript is scrolled past far more often than it is read, and a panel that
 *  opens the instant the cursor crosses a card turns an ordinary sweep down the
 *  page into a row of panels flashing on and off. Once it is open it follows the
 *  cursor with no delay at all — the wait is for deciding to look, not for
 *  keeping up. */
const OPEN_DELAY = 240;
/**
 * How long after a panel closes the next one opens with no wait at all.
 *
 * Shared across every card in the window on purpose. The wait exists to tell a
 * scroll from a look, and once the learner has looked at one challenge that
 * question is answered — moving to the card below is them comparing two
 * challenges, and making them hold still again for each one turns comparing into
 * waiting. The same grace every menu bar has had since menu bars.
 */
const WARM_WINDOW = 700;
let warmUntil = 0;

/**
 * The preview, carried on the pointer.
 *
 * Anchored to the cursor rather than to the card's edge, because this is a peek
 * and not a menu: the learner is running down a transcript looking for the
 * challenge they half-remember, and a panel that appears in a fixed place makes
 * them stop and look somewhere else for every card. On the cursor it is already
 * where they are looking, and it leaves the instant they move off.
 *
 * It never takes the pointer. A panel pinned under the cursor that could be
 * hovered would be a panel the cursor is permanently inside, so everything in it
 * is read-only by construction — which is also why nothing in it is a link.
 *
 * A hook rather than a wrapper component, because the card it belongs to is
 * measured by its parent through `firstElementChild` — a wrapper element, even a
 * `display: contents` one, is a different first child with a different corner
 * radius, and the stack's occlusion mask is cut from that radius.
 */
export function useCursorPreview(panel: ReactNode, enabled: boolean) {
  const [open, setOpen] = useState(false);
  const [point, setPoint] = useState({ x: 0, y: 0 });
  const [size, setSize] = useState({ width: 352, height: 0 });
  const [panelElement, setPanelElement] = useState<HTMLDivElement | null>(null);
  const openTimer = useRef<number | null>(null);
  const reduced = useReducedMotion() ?? false;

  const cancel = useCallback(() => {
    if (openTimer.current !== null) window.clearTimeout(openTimer.current);
    openTimer.current = null;
  }, []);
  /* Leaving an open panel starts the grace window; leaving before it opened does
     not, because nothing was looked at. */
  const close = useCallback(() => {
    setOpen((wasOpen) => {
      if (wasOpen) warmUntil = Date.now() + WARM_WINDOW;
      return false;
    });
  }, []);
  useEffect(() => cancel, [cancel]);

  useLayoutEffect(() => {
    if (!panelElement) return;
    const measure = () => {
      const rect = panelElement.getBoundingClientRect();
      setSize((previous) => previous.width === rect.width && previous.height === rect.height
        ? previous
        : { width: rect.width, height: rect.height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(panelElement);
    return () => observer.disconnect();
  }, [panelElement]);

  useEffect(() => { if (!enabled) { cancel(); close(); } }, [enabled, cancel, close]);

  const track = (event: { clientX: number; clientY: number }) => setPoint({ x: event.clientX, y: event.clientY });

  const handlers = {
    onPointerDown: () => { cancel(); close(); },
    onPointerEnter: (event: React.PointerEvent) => {
      if (!enabled || event.pointerType === "touch") return;
      track(event);
      cancel();
      if (Date.now() < warmUntil) { setOpen(true); return; }
      openTimer.current = window.setTimeout(() => setOpen(true), OPEN_DELAY);
    },
    onPointerLeave: () => { cancel(); close(); },
    /* The pointer is tracked through the wait as well as after it, so the panel
       opens where the cursor actually is rather than where it entered the card. */
    onPointerMove: track,
  };

  /* Flipped rather than clamped along x: a panel that slides left to fit while
     the pointer keeps going right ends up under the cursor, which is the one
     place it must not be. Along y it is clamped, because the panel is taller
     than the room below most cards and flipping it would make it jump every time
     the pointer crossed a midpoint. */
  const flipped = point.x + CURSOR_GAP + size.width > window.innerWidth - EDGE;
  const left = Math.max(EDGE, flipped ? point.x - CURSOR_GAP - size.width : point.x + CURSOR_GAP);
  const top = size.height > 0
    ? Math.min(Math.max(EDGE, point.y + CURSOR_GAP), Math.max(EDGE, window.innerHeight - EDGE - size.height))
    : point.y + CURSOR_GAP;

  const overlay = createPortal(
    <AnimatePresence>
      {open && enabled && panel && (
        <motion.div
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: reduced ? 1 : 0.985 }}
          initial={{ opacity: 0, scale: reduced ? 1 : 0.985 }}
          ref={setPanelElement}
          /* The card's own surface and corner, one elevation up. A preview of a
             card that is not shaped like the card is a second component claiming
             to be about the first. */
          className={cn(
            "transcript-block pointer-events-none fixed z-[70] w-[22rem] p-3",
            "shadow-[var(--app-shadow-overlay)] backdrop-blur-[10px]",
          )}
          style={{ left, top }}
          transition={reduced ? { duration: 0 } : { duration: 0.11, ease: [0.22, 0.61, 0.36, 1] }}
        >
          {panel}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );

  return { handlers, overlay };
}
