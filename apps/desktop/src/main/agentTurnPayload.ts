import { itemRating, solveProbability, type Rating } from "@spar/domain";
import type { ProblemSource } from "@spar/domain";
import type { LocalStore, JourneyChallenge } from "./store.js";
import { LEARNER_NOTEBOOK, type CoachNotebookVersion } from "../shared/api.js";
import type { AgentTurnKind } from "../workers/agentPolicy.js";
import { sessionSourcesSection, skillsSection } from "../workers/sessionContext.js";
import { challengeMixInstructions } from "../shared/challengeMix.js";

/**
 * Everything the coach is told before a turn, in one place.
 *
 * The context is a markdown document — the learner's journey — rather than a
 * JSON dump. A person picking up this learner cold would want to read, in order:
 * who they are, what the coach already wrote down about them, every challenge
 * so far with what it was worth, how it ended and what code shape it came in,
 * what is open right now, and what was just said. That is the order here. The
 * facts are the store's, rendered; nothing is summarised by a heuristic the
 * coach cannot see behind.
 *
 * The eval runs the real worker against a real store through this same
 * function, so the prompt measured and the prompt shipped are one prompt.
 */

export type TurnPayloadInput = {
  store: LocalStore;
  sessionId: string;
  message: string;
  turnKind: AgentTurnKind;
  /** Whether the coach may reach outside the learner's own record. */
  webSearch: boolean;
  practiceSource: boolean;
  practiceSummary: unknown;
  accountId: string;
  /** Rehydrate a successful handoff if the provider failed while writing its reply. */
  resumeSince?: string;
  /** Enabled skills, name and description only. */
  skills?: { name: string; description: string }[];
};

export type TurnPayload = {
  sessionId: string;
  message: string;
  turnKind: AgentTurnKind;
  webSearch: boolean;
  practiceSource: boolean;
  /** Whether this session lets the coach write its own challenges. */
  sparAuthoring: boolean;
  problemSources: ProblemSource[];
  skills: { name: string; description: string }[];
  activeQuestion: { id: string; attemptId: string } | null;
  /** Work a failed provider already finished this turn, so a retry does not redo it. */
  resumeState: Record<string, unknown>;
  context: string;
};

export function agentTurnPayload(input: TurnPayloadInput): TurnPayload {
  const { store, sessionId, turnKind } = input;
  const session = store.readSession(sessionId);
  if (!session) throw new Error("Session not found");
  const lesson = input.resumeSince ? store.lessonPublishedSince(sessionId, input.resumeSince) : null;
  return {
    sessionId,
    message: input.message,
    turnKind,
    webSearch: input.webSearch,
    practiceSource: input.practiceSource,
    sparAuthoring: session.summary.problemSources.includes("spar"),
    problemSources: session.summary.problemSources,
    skills: input.skills ?? [],
    activeQuestion: openQuestion(session) ? { id: session.question!.id, attemptId: session.question!.attemptId } : null,
    resumeState: lesson ? { lesson: { result: lesson } } : {},
    context: journeyDocument(input),
  };
}

/** The learner's journey, as the coach reads it at the start of a turn. */
export function journeyDocument(input: TurnPayloadInput): string {
  const { store, sessionId } = input;
  const session = store.readSession(sessionId)!;
  const trackId = session.summary.trackId ?? null;
  const track = trackId ? store.listTracks().find((item) => item.id === trackId) ?? null : null;
  const profile = store.getProfile();
  const target = store.latestTarget(sessionId);
  const rating = store.currentRating();
  const ability = target ? store.readAbilityDetail(String(target.ability_id)) : null;
  const language = track?.language ?? profile?.language ?? "javascript";
  const sections: string[] = [];

  sections.push(`# Journey\nNow: ${new Date().toLocaleString("en-US", { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} (the learner's local time).`);

  /* First, because they are the coach's own running account of this learner:
     everything below is the record, and this is what the record means. The
     user.md is about the person and every Track reads it; the Track
     notebook is about their progress here. */
  const written = (notebook: CoachNotebookVersion) => `v${notebook.version}, ${notebook.author === "learner" ? "last edited by the learner" : "last written by you"} ${ago(notebook.createdAt)}`;
  const learnerNotebook = store.readNotebook(LEARNER_NOTEBOOK);
  sections.push(learnerNotebook
    ? `## user.md — who they are, on every Track; read this first (${written(learnerNotebook)})\n${learnerNotebook.markdown}`
    : "## user.md — who they are, on every Track; read this first\n_Empty so far. update_notebook with notebook \"user\" writes it: who they are, what they are working towards, how they like to be taught._");
  const notebook = store.readNotebook(trackId);
  sections.push(notebook
    ? `## Track notebook (${written(notebook)})\n${notebook.markdown}`
    : "## Track notebook\n_Empty so far._");

  sections.push([
    "## Learner",
    profile ? `- ${[profile.name, profile.experience ? `${profile.experience} programmer` : "", profile.focus ? `focus: ${profile.focus}` : ""].filter(Boolean).join(" · ")}` : "- No profile yet.",
    profile?.weakness ? `- Says they struggle with: ${profile.weakness}` : "",
    ratingLine(rating),
    `- Language for this Track: ${language}${track?.language ? "" : " (from their profile)"}.`,
  ].filter(Boolean).join("\n"));

  const sources = sessionSourcesSection(session.summary.problemSources, input.practiceSource);
  sections.push([
    track ? `## Track: ${track.title}\nGoal: ${track.goal}` : "## Track\nThis session is not inside a Track.",
    `Session goal: ${session.summary.originalGoal}`,
    sources ? `Problem sources: ${sources}` : "",
    practiceLine(input.practiceSummary),
  ].filter(Boolean).join("\n"));


  /* Every challenge on the Track, the recent ones in full and the rest a line
     each. Showing only the last fourteen let the coach write a problem it had
     already set twice, because the first two were out of sight. */
  const journey = store.journey(trackId, 1_000);
  if (!journey.challenges.length) {
    sections.push("## Challenges on this Track\nNone yet. This is the start of their journey here.");
  } else {
    const all = journey.challenges;
    const detailed = 14;
    const earlier = Math.max(0, all.length - detailed);
    const lines = [`## Challenges on this Track (${all.length}, oldest first)`];
    const openId = session.question && !session.question.attemptCompletedAt ? session.question.id : null;
    all.forEach((challenge, index) => lines.push(index < earlier
      ? challengeLine(challenge, index + 1)
      : challengeEntry(challenge, index + 1, index >= all.length - 3, challenge.id === openId)));
    sections.push(lines.join("\n\n"));
  }

  const question = session.question;
  if (question && !question.attemptCompletedAt) {
    sections.push([
      `## Open challenge: ${question.title}`,
      `Challenge id ${question.id}, attempt id ${question.attemptId}. Started ${ago(question.attemptStartedAt)}. The learner is working on it now.`,
    ].join("\n"));
  } else if (question) {
    sections.push(`## Open challenge\nNone. The last one ("${question.title}") is finished and the learner is waiting for what comes next.`);
  } else {
    sections.push("## Open challenge\nNone yet.");
  }

  if (target) {
    sections.push([`## Current training target`, `- Ability: ${String(target.ability_title)} (${ability?.ability.status ?? "uncertain"})`, target.specific_gap ? `- Gap: ${String(target.specific_gap)}` : "", target.desired_evidence ? `- Evidence sought: ${String(target.desired_evidence)}` : "", `- Set ${ago(String(target.created_at))}. A new aim replaces it.`].filter(Boolean).join("\n"));
  }

  const abilities = store.listAbilities(trackId).slice(0, 8);
  if (abilities.length) {
    sections.push(["## Abilities", ...abilities.map((entry) => `- ${entry.title} — ${entry.status}, v${entry.version}, ${entry.evidenceCount} evidence (id ${entry.id})${entry.summary ? `: ${entry.summary}` : ""}`)].join("\n"));
  }

  const patterns = store.listPatterns(trackId).filter((pattern) => pattern.status !== "resolved").slice(0, 8);
  if (patterns.length) sections.push(["## Open patterns (your hypotheses about how they go wrong)", ...patterns.map((pattern) => `- [${pattern.status}] ${pattern.title}: ${pattern.description}`)].join("\n"));

  const lessons = store.recentLessons(6, trackId);
  if (lessons.length) sections.push(["## Lessons you have taught", ...lessons.map((entry) => `- [[lesson:${entry.id}|${entry.title}]] — ${entry.summary} (${ago(entry.taughtAt)})`)].join("\n"));

  /* Reviews live in review sessions only. A training session is about the
     next step, and a due card in its journey is how reviews used to leak into
     one the learner never asked to spend on review. */
  if (session.summary.context === "review") sections.push(reviewSessionSection(store, sessionId));

  const intake = store.freshIntakeAnswer(sessionId);
  if (intake) sections.push(`## The learner's answer to your question\nYou asked: ${intake.question}\nThey answered: ${intake.answer}`);

  const conversation = session.messages.slice(-12).filter((message) => message.body.trim());
  if (conversation.length) {
    sections.push(["## This session so far", ...conversation.map((message) => `**${message.role === "learner" ? "Learner" : message.role === "agent" ? "You" : "Spar"}** (${ago(message.createdAt)}): ${message.body.trim().slice(0, 1_500)}`)].join("\n\n"));
  }

  const skills = skillsSection(input.skills ?? []);
  if (skills) sections.push(`## Skills\n${skills}`);
  /* The learner's standing instructions, set from the workspace's settings
     menu or by set_challenge_mix. Last before the turn's facts on purpose: in
     the middle of a long journey they read as background and were skimmed; here
     they are the frame the turn is answered in. Absent at the defaults. */
  const mix = challengeMixInstructions(session.summary.challengeMix, session.summary.problemSources, language, store.lensLog(sessionId));
  if (mix) sections.push(`## Coaching settings (the learner's, for every turn)\n${mix}`);
  sections.push(`## Available this turn\n- Web search: ${input.webSearch ? "yes" : "no"}\n- Provider problems: ${input.practiceSource ? "yes" : "no"}\n- Spar-written challenges: ${session.summary.problemSources.includes("spar") ? "yes" : "no"}`);

  return sections.join("\n\n");
}

function challengeEntry(challenge: JourneyChallenge, ordinal: number, withStarter: boolean, open = false): string {
  const outcome = challenge.replacedByTitle ? `replaced by "${challenge.replacedByTitle}"` : challenge.outcome ?? "not finished";
  const facts = [
    challenge.source === "spar" ? "Spar-written" : challenge.source === "leetcode" ? "LeetCode" : "Codeforces",
    `${challenge.difficulty} (${challenge.itemRating})`,
    challenge.language,
    challenge.elapsedMs !== null ? minutes(challenge.elapsedMs) : "",
    challenge.testRuns ? `${challenge.testRuns} run${challenge.testRuns === 1 ? "" : "s"}` : "",
    challenge.totalCases ? `${challenge.passedCases ?? 0}/${challenge.totalCases} cases on the last run` : "",
    challenge.outcome ? (challenge.assistance === "assisted" ? "the coach helped during it" : challenge.assistance === "independent" ? "no help from the coach during it" : "") : "",
    ago(challenge.createdAt),
  ].filter(Boolean).join(" · ");
  const lines = [
    `### ${ordinal}. ${challenge.title} — ${outcome}`,
    facts,
    challenge.concepts.length ? `Concepts: ${challenge.concepts.join(", ")}` : "",
    challenge.replacesTitle ? `Replaced "${challenge.replacesTitle}".` : "",
    challenge.why ? `Why it was set: ${challenge.why}` : "",
    challenge.task ? `Task: ${challenge.task.replace(/\s+/g, " ")}` : "",
    challenge.requirements.length ? `Requirements: ${challenge.requirements.join("; ")}` : "",
    `Id: ${challenge.id}`,
  ];
  /* The open challenge exactly as the learner reads it, so a reply can quote it
     and edit_challenge can name a passage without a read first. */
  if (open && challenge.statement) lines.push(`Statement:\n<statement>\n${challenge.statement}\n</statement>`);
  if (withStarter && challenge.starter) lines.push(`Starter (${challenge.starter.path}):\n\`\`\`\n${challenge.starter.text}\n\`\`\``);
  return lines.filter(Boolean).join("\n");
}

/** An older challenge, in one line: enough to see what was already set. */
function challengeLine(challenge: JourneyChallenge, ordinal: number): string {
  const outcome = challenge.replacedByTitle ? `replaced by "${challenge.replacedByTitle}"` : challenge.outcome ?? "not finished";
  const source = challenge.source === "spar" ? "Spar-written" : challenge.source === "leetcode" ? "LeetCode" : "Codeforces";
  return `### ${ordinal}. ${challenge.title} — ${outcome}\n${source} · ${challenge.difficulty} (${challenge.itemRating})${challenge.concepts.length ? ` · ${challenge.concepts.join(", ")}` : ""}${challenge.task ? `\nTask: ${challenge.task.replace(/\s+/g, " ").slice(0, 200)}` : ""}`;
}

function practiceLine(summary: unknown): string {
  if (!summary || typeof summary !== "object") return "";
  const value = summary as { providers?: Array<{ name?: string; connected?: boolean; judgesSubmissions?: boolean }>; alreadyAssigned?: Array<{ title?: string; slug?: string; source?: string }> };
  const providers = (value.providers ?? []).map((entry) => `${entry.name}${entry.connected ? " (connected" : " (not signed in"}${entry.judgesSubmissions ? ", judges submissions)" : ", graded locally on published examples)"}`);
  const assigned = (value.alreadyAssigned ?? []).map((entry) => entry.title ?? entry.slug).filter(Boolean);
  return [providers.length ? `Providers: ${providers.join("; ")}.` : "", assigned.length ? `Already assigned from providers: ${assigned.join(", ")}.` : ""].filter(Boolean).join("\n");
}

const RATING_WORD: Record<number, string> = { 1: "again", 2: "hard", 3: "good", 4: "easy" };

/**
 * A review session's cards, each with everything there is to know about it.
 *
 * Nothing here decides anything: which card next, what to set, how it went
 * are the coach's. This is the dossier it decides from — the idea, how the
 * learner first got it, where they slipped, what every later review found,
 * and the ids of the work behind each, so the code is one read away.
 */
function reviewSessionSection(store: LocalStore, sessionId: string): string {
  const now = Date.now();
  const queue = store.reviewQueue(sessionId);
  const open = store.readSession(sessionId)?.question;
  const current = open && !open.attemptCompletedAt ? store.reviews.reviewOfChallenge(open.id) : null;
  const sessionChallenges = new Set((store.readSession(sessionId)?.summary.questionTitles ?? []).map((entry) => entry.id));
  const lines = [
    "## Review session",
    "The learner opened this session to review what earlier solves taught: the cards below, in the order they were queued; the order you take them in is yours. Challenges here are reviews of these cards, or practice going deeper on a weak spot a review exposed.",
    current ? `The open challenge ${current.purpose === "deeper" ? "is practice going deeper on" : "reviews"} card ${current.card.id} ("${current.card.title}")${current.focus ? `, ${current.purpose === "deeper" ? "aimed at" : "watching for"}: ${current.focus}` : ""}.${current.learnerNote ? ` Above the problem you told them: "${current.learnerNote}"` : ""}` : "",
  ];
  if (!queue.length) lines.push("No cards were queued. Ask the learner what they want to review, or pick from their weakest cards with search_record.");
  queue.forEach((cardId, index) => {
    const detail = store.reviews.detail(cardId);
    if (!detail) return;
    const { card, logs } = detail;
    const links = detail.challenges ?? [];
    const here = logs.filter((log) => log.source === "coach" && log.challengeId && sessionChallenges.has(log.challengeId)).at(-1);
    const status = here ? `reviewed here: ${RATING_WORD[here.rating]}` : current?.card.id === card.id ? "being reviewed now" : "not reviewed yet";
    const dueDays = Math.round((Date.parse(card.dueAt) - now) / 86_400_000);
    const submissions = store.submissionsForQuestion(card.questionId);
    const past = logs.filter((log) => log.source !== "implicit").reverse().slice(0, 6);
    lines.push([
      `### ${index + 1}. ${card.title} — card ${card.id} (${status})`,
      `From "${card.questionTitle}" (challenge ${card.questionId}${card.attemptId ? `, solved in attempt ${card.attemptId}` : ""}). Concepts: ${card.concepts.map((tag) => tag.slug).join(", ") || "none"}.`,
      `Memory: recall chance ${Math.round(card.retrievability * 100)}%, ${card.suspended ? "paused" : dueDays < 0 ? `overdue ${-dueDays} days` : dueDays === 0 ? "due today" : `due in ${dueDays} days`}, ${Math.max(0, card.reps - 1)} reviews since the solve, ${card.lapses} forgotten. Rehearses: ${card.targets.join(", ")}.`,
      `Cue: ${card.trigger}`,
      `The idea: ${card.insight}`,
      card.invariant ? `Why it holds: ${card.invariant}` : "",
      `How it clicked on the solve (${card.independence}): ${card.click.summary}`,
      card.pitfalls.length ? `Slips on the solve: ${card.pitfalls.map((pitfall) => `${pitfall.mistake} → ${pitfall.fix}`).join("; ")}` : "",
      card.remember ? `What they said they want to remember: ${card.remember}` : "",
      card.coachNote ? `Your note on this card: ${card.coachNote}` : "",
      past.length ? `Reviews, newest first:\n${past.map((log) => `- ${ago(log.reviewedAt)} · ${log.source}${log.format && log.source === "recall" ? ` (${log.format})` : ""} · ${RATING_WORD[log.rating]}${log.feedback ? ` · ${log.feedback.replace(/\s+/g, " ").slice(0, 300)}` : ""}${log.held?.length ? ` · held: ${log.held.join("; ")}` : ""}${log.missed?.length ? ` · missed: ${log.missed.join("; ")}` : ""}${log.submissionId ? ` · submission ${log.submissionId}` : log.attemptId ? ` · attempt ${log.attemptId}` : ""}`).join("\n")}` : "",
      submissions.length ? `Submissions on the original challenge: ${submissions.length}, the last ${submissions.at(-1)!.outcome} (${submissions.at(-1)!.passedCases}/${submissions.at(-1)!.totalCases}), id ${submissions.at(-1)!.id}.` : "",
      links.length ? `Challenges set for this card: ${links.map((link) => `"${link.challengeTitle}" (${link.purpose === "deeper" ? "going deeper" : "review"}, ${link.challengeId}, ${link.outcome}${link.purpose === "review" ? link.reviewed ? ", judged" : ", not judged" : ""})`).join("; ")}` : "",
    ].filter(Boolean).join("\n"));
  });
  return lines.filter(Boolean).join("\n\n");
}

function minutes(ms: number): string {
  const value = Math.round(ms / 60_000);
  return value < 1 ? "under a minute" : `${value} min`;
}

/** Time as a person says it. The coach repeats what it reads, so it reads this. */
export function ago(iso: string | null | undefined, now = Date.now()): string {
  const at = iso ? Date.parse(iso) : Number.NaN;
  if (!Number.isFinite(at)) return "at an unknown time";
  const seconds = Math.max(0, Math.round((now - at) / 1_000));
  if (seconds < 60) return "just now";
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `about ${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return days === 1 ? "yesterday" : `${days} days ago`;
  return new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Whether the learner still has a challenge in front of them. */
export function openQuestion(session: { question: { attemptCompletedAt: string | null } | null }): boolean {
  return Boolean(session.question && !session.question.attemptCompletedAt);
}

/* The rating as facts the coach can reason with: the number, how wide it still
   is, and what it predicts at the prices problems are actually set at. A
   "fits them now" window used to stand here, capped at 1200 for anyone who
   called themselves new until the rating stopped being provisional — which
   wins on easy problems never make it — so the coach searched easies forever. */
function ratingLine(rating: Rating): string {
  const chance = (price: number) => `${Math.round(solveProbability(rating, price) * 100)}%`;
  const leetcode = (["easy", "medium", "hard"] as const).map((difficulty) => {
    const price = itemRating({ source: "leetcode", difficulty });
    return `${difficulty} (${price}) ${chance(price)}`;
  }).join(", ");
  return `- Rating ${Math.round(rating.rating)} ± ${Math.round(2 * rating.deviation)}. Predicted solve chance on LeetCode ${leetcode}. Spar's difficulty words are priced foundation 900, developing 1200, proficient 1500, advanced 1800. The range narrows only with informative results: wins on problems they were expected to solve barely move it.`;
}
