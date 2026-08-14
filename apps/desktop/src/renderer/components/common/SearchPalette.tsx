import { useEffect, useMemo, useState } from "react";
import { Command } from "cmdk";
import { History, LayoutGrid, Library, Map, Plus, Search, Settings, Target, Waypoints } from "lucide-react";
import type { ChallengeHistorySummary, ConceptSummary, SessionSummary } from "@spar/domain";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { LANGUAGE_LABEL } from "@/components/common/LanguageGlyph";
import { CONCEPT_KIND_SHORT, CONCEPT_KIND_VAR } from "@/lib/concepts";
import { relativeTime } from "@/lib/format";
import { searchEverything, type PalettePlace, type SearchHit } from "@/lib/search";
import { cn } from "@/lib/utils";
import type { Page } from "../shell/Sidebar";

/**
 * ⌘K: one field over everything the learner has.
 *
 * It sits high in the window rather than centred, which is what makes it read as
 * a spotlight instead of a modal: the panel grows downwards as results arrive, so
 * the field stays where the eye already is and the list never shoves it around.
 * Centring a list whose length changes on every keystroke means the input walks up
 * the screen while you type into it.
 *
 * Everything it can do is find a thing and go to it. No renaming, no deleting, no
 * running a challenge from here — those live where the thing lives, and a palette
 * that can quietly destroy something is a palette you have to read before you
 * press Return.
 *
 * Ranking, grouping and caps are {@link searchEverything}'s; this file is the
 * surface. cmdk keeps the keyboard honest (arrows, Return, hover and selection
 * agreeing), with its own filter off — ours reads four entity shapes and cmdk's
 * scores one string.
 */
export function SearchPalette({
  open,
  sessions,
  challenges,
  concepts,
  onOpenChange,
  onPage,
  onOpenSession,
  onOpenChallenge,
  onOpenConcept,
  onNewSession,
}: {
  open: boolean;
  sessions: SessionSummary[];
  challenges: ChallengeHistorySummary[];
  concepts: ConceptSummary[];
  onOpenChange(open: boolean): void;
  onPage(page: Page): void;
  onOpenSession(session: SessionSummary): void;
  onOpenChallenge(challengeId: string): void;
  onOpenConcept(slug: string): void;
  onNewSession(): void;
}) {
  const [query, setQuery] = useState("");

  // A palette that reopens holding the last search is a palette you have to clear
  // before you can use it.
  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  /* Groups arrive best-match-first, which is what puts the highlight in the right
     place: cmdk selects the first row it is given, so the ranking has to be in the
     order of the rows rather than asserted over the top of them. */
  const groups = useMemo(
    () => searchEverything(query, { sessions, challenges, concepts }),
    [challenges, concepts, query, sessions],
  );

  /* Closed before the destination is opened, not after: several of these mount a
     surface of their own — a workspace, the concept sheet — and a palette still on
     screen when it lands is a panel floating over the thing it just went to. */
  const run = (action: () => void) => {
    onOpenChange(false);
    action();
  };

  const select = (hit: SearchHit) => {
    switch (hit.kind) {
      case "action":
        return run(onNewSession);
      case "session":
        return run(() => onOpenSession(hit.session));
      case "challenge":
        return run(() => onOpenChallenge(hit.challenge.id));
      case "concept":
        return run(() => onOpenConcept(hit.concept.slug));
      case "place":
        return run(() => onPage(hit.place.page));
    }
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      {/* Overrides the centred sheet the dialog draws by default: pinned near the
          top, wider than a dialog, and with no padding of its own so the input row
          and the list can own the panel's full width.
          A column rather than the dialog's grid, and paired with `min-w-0` on the
          root below. A grid item will not shrink under its own min-content width,
          and a result row's min-content is the longest title in the list — so the
          panel kept its 37rem while the rows inside it grew past both edges. */}
      <DialogContent
        className="top-[11vh] flex w-[min(37rem,calc(100vw-3rem))] max-w-none translate-y-0 flex-col gap-0 overflow-hidden rounded-2xl p-0 shadow-[var(--app-shadow-overlay)] sm:max-w-none"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">Search</DialogTitle>
        <DialogDescription className="sr-only">
          Find a session, a challenge or a concept, or jump to a page.
        </DialogDescription>

        <Command className="flex min-w-0 flex-col" label="Search Spar" loop shouldFilter={false}>
          <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-border px-4">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <Command.Input
              autoFocus
              className="h-full min-w-0 flex-1 bg-transparent text-[0.9375rem] text-foreground outline-none placeholder:text-muted-foreground/70"
              onValueChange={setQuery}
              placeholder="Search sessions, challenges, concepts…"
              value={query}
            />
            <kbd className="shrink-0 rounded-[var(--radius-sm)] border border-border px-1.5 py-0.5 font-sans text-ui-sm text-muted-foreground">
              esc
            </kbd>
          </div>

          {groups.length > 0 ? (
            /* Capped in both units on purpose: `24rem` is about ten rows, which is
               as long a list as is worth reading before typing another character,
               and the viewport cap keeps the panel off the bottom of a short
               window — it starts 11vh down, so it cannot ask for all of it. */
            <Command.List className="app-scroll max-h-[min(24rem,62vh)] overflow-y-auto overflow-x-hidden p-1.5">
              {groups.map((group) => (
                <Command.Group
                  key={group.key}
                  className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-ui-sm [&_[cmdk-group-heading]]:text-muted-foreground"
                  heading={group.heading}
                >
                  {group.hits.map((hit) => (
                    <Row hit={hit} key={hit.key} onSelect={() => select(hit)} />
                  ))}
                </Command.Group>
              ))}
            </Command.List>
          ) : (
            <div className="px-4 py-8 text-center text-content text-muted-foreground">
              Nothing matches “{query.trim()}”.
            </div>
          )}

          {/* Only while there is something to move through. On the empty result the
              hints would be the one thing left on screen with anything to say. */}
          {groups.length > 0 && (
            <div className="flex h-8 shrink-0 items-center gap-3 border-t border-border px-4 text-ui-sm text-muted-foreground">
              <Hint keys="↑↓">move</Hint>
              <Hint keys="↵">open</Hint>
              <Hint keys="esc">close</Hint>
            </div>
          )}
        </Command>
      </DialogContent>
    </Dialog>
  );
}

function Hint({ keys, children }: { keys: string; children: string }) {
  return (
    <span className="flex items-center gap-1">
      <kbd className="font-sans text-foreground/70">{keys}</kbd>
      {children}
    </span>
  );
}

/** Nav glyphs, matching the sidebar's — a row that sends you to Challenges is
 *  drawn with the icon that is already sitting next to the word Challenges. */
const PLACE_ICON: Record<PalettePlace["page"], React.ComponentType<{ className?: string }>> = {
  today: Waypoints,
  tracks: Target,
  progress: Map,
  history: History,
  problems: Library,
  sessions: LayoutGrid,
  ability: Map,
  challenges: History,
  settings: Settings,
};

/**
 * One result.
 *
 * Every kind is one line: a glyph, what the thing is called, what it belongs to,
 * and when it was last touched. Two-line rows would let each entity say more, but
 * they halve how much of the list fits on screen — and the second line is nearly
 * always the parent, which is what the trailing column is for.
 */
function Row({ hit, onSelect }: { hit: SearchHit; onSelect(): void }) {
  const row = rowContent(hit);

  return (
    <Command.Item
      className={cn(
        "flex min-h-8 cursor-default select-none items-center gap-2.5 rounded-[var(--radius-item)] px-2 text-content outline-none",
        "data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0",
      )}
      onSelect={onSelect}
      value={hit.key}
    >
      {row.icon}
      <span className="min-w-0 truncate font-medium">{row.title}</span>
      {row.sub && <span className="min-w-0 flex-1 truncate text-muted-foreground">{row.sub}</span>}
      {row.meta && (
        <span className={cn("shrink-0 text-ui text-muted-foreground", !row.sub && "ml-auto")}>{row.meta}</span>
      )}
    </Command.Item>
  );
}

const GLYPH = "size-3.5 text-foreground/70";

/** What each kind of hit puts in the three columns of a row. */
function rowContent(hit: SearchHit): { icon: React.ReactNode; title: string; sub?: string; meta?: string } {
  switch (hit.kind) {
    case "action":
      return { icon: <Plus className={GLYPH} />, title: hit.action.label, meta: "⌘N" };

    case "session": {
      const session = hit.session;
      const done = session.questionTitles.filter((question) => question.status === "completed").length;
      /* What the session is on right now, falling back through what it was aimed
         at: the live challenge is the most useful thing to say, and the goal the
         learner typed is the least — but a planning session has only the goal. */
      const sub = [session.activeQuestion?.title, session.currentFocus[0], session.objective, session.originalGoal]
        .find((value) => value && value.trim().length > 0);
      return {
        icon: <LayoutGrid className={GLYPH} />,
        title: session.title,
        ...(sub ? { sub } : {}),
        meta: `${done > 0 ? `${done} done · ` : ""}${relativeTime(session.updatedAt)}`,
      };
    }

    case "challenge": {
      const challenge = hit.challenge;
      // Where it came from reads before which session it was set in: a learner
      // hunting "1" wants to see that this is LeetCode 1 before anything else.
      const origin = challenge.source ? `${challenge.source.source === "codeforces" ? "Codeforces" : "LeetCode"} ${challenge.source.displayId}` : LANGUAGE_LABEL[challenge.language];
      return {
        icon: <Target className={GLYPH} />,
        title: challenge.title,
        sub: `${origin} · ${challenge.sessionTitle}`,
        meta: relativeTime(challenge.updatedAt),
      };
    }

    case "concept": {
      const concept = hit.concept;
      return {
        icon: (
          /* A kind dot rather than a glyph, which is how a concept is marked
             everywhere else — in the one slot the line drawings use, so the titles
             still read down a single column. */
          <span aria-hidden className="grid size-3.5 shrink-0 place-items-center">
            <span className="size-2 rounded-full" style={{ background: CONCEPT_KIND_VAR[concept.kind] }} />
          </span>
        ),
        title: concept.title,
        sub: concept.parentTitle ?? CONCEPT_KIND_SHORT[concept.kind],
        ...(concept.challengeCount > 0
          ? { meta: `${concept.challengeCount} ${concept.challengeCount === 1 ? "challenge" : "challenges"}` }
          : {}),
      };
    }

    case "place": {
      const Icon = PLACE_ICON[hit.place.page];
      return { icon: <Icon className={GLYPH} />, title: hit.place.label };
    }
  }
}
