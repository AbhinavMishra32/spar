import type { BootstrapData } from "../../../shared/api";
import type { ToolbarFact } from "./Toolbar";
import type { Page } from "./Sidebar";

/**
 * What the shell's toolbar says over each page.
 *
 * Kept here, as one pure function over the bootstrap, for two reasons. The first
 * is that the answer is a *judgement about the page*, not a string lookup: a
 * page that already opens with its own heading must not be given a second name
 * in the chrome, and a page that has nothing true to report in a row of counts
 * must be allowed to report nothing. Both of those decisions belong in one place
 * where they can be read against each other, rather than eleven entries of a
 * record that can only say "Problems".
 *
 * The second is that it is then testable, and the facts are the part most likely
 * to quietly start lying — a count that filters the wrong way is invisible in a
 * screenshot and obvious in a test.
 *
 * `null` means the page draws its own chrome and the shell should not put a
 * titled row over it at all. The row itself still exists, because it is where
 * the window's buttons and the back and forward controls live once the sidebar
 * is hidden — it is simply empty.
 */
export type PageChrome = { title?: string; facts: ToolbarFact[] };

/** Pages the shell puts its own toolbar over. The three that draw their own —
 *  a session, a past challenge, and the baseline run — carry a back control and
 *  their own actions, so they build the row themselves. */
export type ShellPage = Exclude<Page, "workspace" | "challenge" | "baseline">;

/** "1 session", "4 sessions". A count with no noun is a number nobody can read
 *  at this size, and a noun that does not agree with it reads as a bug. */
function count(value: number, noun: string, plural = `${noun}s`): string {
  return `${value} ${value === 1 ? noun : plural}`;
}

const LANGUAGE: Record<string, string> = { python: "Python", typescript: "TypeScript", javascript: "JavaScript", java: "Java", cpp: "C++", go: "Go", rust: "Rust" };

export function pageChrome(page: ShellPage, data: BootstrapData, abilityId: string | null): PageChrome | null {
  /* Baseline sessions are the calibration run's own bookkeeping and are never
     shown in any list, so they must not be counted in one either. */
  const sessions = data.sessions.filter((session) => session.context !== "baseline");
  const open = sessions.filter((session) => session.status !== "completed" && !session.archivedAt);
  const solved = data.challenges.filter((challenge) => challenge.lastOutcome === "passed");

  switch (page) {
    /* Home has no heading of its own — it opens on the rating, which is a figure
       and not a name — so this row is where the page is named. The facts are the
       two things that decide whether you are done for the day, and neither is
       the rating: the hero says that one, loudly, ten pixels below. */
    case "home": {
      const facts: ToolbarFact[] = [];
      if (data.activeTrack) facts.push({ value: data.activeTrack.title });
      if (open.length > 0) facts.push({ value: count(open.length, "session"), label: "open", tone: "good" });
      return { title: "Home", facts };
    }

    case "tracks": {
      const facts: ToolbarFact[] = [{ value: count(data.tracks.length, "Track") }];
      if (data.activeTrack) facts.push({ value: data.activeTrack.title, label: "active" });
      return { facts };
    }

    /* A Track's page borrows the sessions list, which puts the Track's own name
       and goal at the top. What it does not say is the size of the thing you are
       looking at, so that is what goes up here. */
    case "track": {
      if (!data.activeTrack) return null;
      const track = data.activeTrack;
      const own = sessions.filter((session) => session.trackId === track.id);
      const ownChallenges = data.challenges.filter((challenge) => own.some((session) => session.id === challenge.sessionId));
      const facts: ToolbarFact[] = [
        { value: count(own.length, "session") },
        { value: count(ownChallenges.length, "challenge") },
      ];
      if (track.language) facts.push({ value: LANGUAGE[track.language] ?? track.language });
      return { facts };
    }

    /* Both routes land on challenge history. It heads itself "History", so the
       row carries the tally instead — how much has been attempted, and how much
       of it came out passed. */
    case "history":
    case "challenges":
    case "review":
      return {
        facts: [
          { value: count(data.challenges.length, "challenge") },
          ...(data.challenges.length > 0 ? [{ value: `${solved.length}`, label: "solved", tone: "good" as const }] : []),
          ...(data.reviews?.dueCount ? [{ value: `${data.reviews.dueCount}`, label: "to review" }] : []),
        ],
      };

    /* The library's own counts — how many match the filters, how many origins —
       are computed inside the page from a search that has not resolved when this
       runs, and a figure up here that disagreed with the chips down there would
       be worse than no figure. So this reports only what the bootstrap knows for
       certain: what is on the shelf, and what has been tried. */
    case "problems": {
      const facts: ToolbarFact[] = [];
      if (data.saved.length > 0) facts.push({ value: `${data.saved.length}`, label: "saved" });
      if (data.challenges.length > 0) facts.push({ value: `${data.challenges.length}`, label: "attempted" });
      return { facts };
    }

    case "sessions": {
      const facts: ToolbarFact[] = [{ value: count(sessions.length, "session") }];
      if (open.length > 0) facts.push({ value: `${open.length}`, label: "open", tone: "good" });
      return { facts };
    }

    /* An ability page opens on the ability's name, so the row says what the page
       spends a screen arguing: how much evidence is behind the claim, and whether
       it has been earned or is still a hypothesis. */
    case "ability": {
      const ability = data.abilities.find((item) => item.id === abilityId);
      if (!ability) return null;
      return {
        facts: [
          { value: ability.earnedAt ? "Earned" : "Forming", ...(ability.earnedAt ? { tone: "good" as const } : {}) },
          { value: count(ability.evidenceCount, "attempt"), label: "of evidence" },
        ],
      };
    }

    case "visualizer":
      return { title: "Visualize", facts: [{ value: "Python" }] };

    /* Settings is a window inside the window: its own column, its own heading
       per section, and a row of counts over it would be chrome over chrome. */
    case "settings":
      return null;
  }
}
