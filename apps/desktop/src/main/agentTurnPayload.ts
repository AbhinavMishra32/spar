import { ESTABLISHED_DEVIATION } from "@spar/domain";
import type { ProblemSource } from "@spar/domain";
import type { LocalStore, JourneyChallenge } from "./store.js";
import { LEARNER_NOTEBOOK, type CoachNotebookVersion } from "../shared/api.js";
import { trainingWindow } from "./practiceAssignmentPolicy.js";
import type { AgentTurnKind } from "../workers/agentPolicy.js";
import { sessionSourcesSection, skillsSection } from "../workers/sessionContext.js";

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
  const window = trainingWindow({ rating, abilityStatus: ability?.ability.status ?? "uncertain", experience: profile?.experience ?? "new" });
  const language = track?.language ?? profile?.language ?? "javascript";
  const sections: string[] = [];

  sections.push(`# Journey\nNow: ${new Date().toLocaleString("en-US", { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} (the learner's local time).`);

  /* First, because they are the coach's own running account of this learner:
     everything below is the record, and this is what the record means. The
     learner notebook is about the person and every Track reads it; the Track
     notebook is about their progress here. */
  const written = (notebook: CoachNotebookVersion) => `v${notebook.version}, ${notebook.author === "learner" ? "last edited by the learner" : "last written by you"} ${ago(notebook.createdAt)}`;
  const learnerNotebook = store.readNotebook(LEARNER_NOTEBOOK);
  sections.push(learnerNotebook
    ? `## Learner notebook — read this first (${written(learnerNotebook)})\n${learnerNotebook.markdown}`
    : "## Learner notebook — read this first\n_Empty. Start it with update_notebook (notebook \"learner\") this turn: who they are, how they like to be taught, and anything you already know about them that is true beyond this Track._");
  const notebook = store.readNotebook(trackId);
  sections.push(notebook
    ? `## Track notebook (${written(notebook)})\n${notebook.markdown}`
    : "## Track notebook\n_Empty. Start it with update_notebook this turn: what they are working towards here and what you have seen so far._");

  sections.push([
    "## Learner",
    profile ? `- ${[profile.name, profile.experience ? `${profile.experience} programmer` : "", profile.focus ? `focus: ${profile.focus}` : ""].filter(Boolean).join(" · ")}` : "- No profile yet.",
    profile?.weakness ? `- Says they struggle with: ${profile.weakness}` : "",
    `- Rating ${Math.round(rating.rating)}${rating.deviation > ESTABLISHED_DEVIATION ? " (provisional — few graded results yet)" : ""}. Spar challenge prices: foundation 900 · developing 1200 · proficient 1500 · advanced 1800. Provider problems that fit them now are rated about ${window.minRating}–${window.maxRating}.`,
    `- Language for this Track: ${language}${track?.language ? "" : " (from their profile)"}.`,
  ].filter(Boolean).join("\n"));

  const sources = sessionSourcesSection(session.summary.problemSources, input.practiceSource);
  sections.push([
    track ? `## Track: ${track.title}\nGoal: ${track.goal}` : "## Track\nThis session is not inside a Track.",
    `Session goal: ${session.summary.originalGoal}`,
    sources ? `Problem sources: ${sources}` : "",
    practiceLine(input.practiceSummary),
  ].filter(Boolean).join("\n"));

  const journey = store.journey(trackId, 14);
  if (!journey.challenges.length) {
    sections.push("## Challenges on this Track\nNone yet. This is the start of their journey here.");
  } else {
    const shown = journey.challenges;
    const earlier = journey.total - shown.length;
    const lines = [`## Challenges on this Track (${earlier > 0 ? `last ${shown.length} of ${journey.total}` : `${journey.total}`}, oldest first)`];
    const openId = session.question && !session.question.attemptCompletedAt ? session.question.id : null;
    shown.forEach((challenge, index) => lines.push(challengeEntry(challenge, earlier + index + 1, index >= shown.length - 3, challenge.id === openId)));
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
    sections.push(`## Current training target\n- Ability: ${String(target.ability_title)} (${ability?.ability.status ?? "uncertain"})\n- Gap: ${String(target.specific_gap)}\n- Evidence sought: ${String(target.desired_evidence)}\n- Set ${ago(String(target.created_at))}. set_challenge's aim replaces it.`);
  }

  const abilities = store.listAbilities(trackId).slice(0, 8);
  if (abilities.length) {
    sections.push(["## Abilities", ...abilities.map((entry) => `- ${entry.title} — ${entry.status}, v${entry.version}, ${entry.evidenceCount} evidence (id ${entry.id})${entry.summary ? `: ${entry.summary}` : ""}`)].join("\n"));
  }

  const patterns = store.listPatterns(trackId).filter((pattern) => pattern.status !== "resolved").slice(0, 8);
  if (patterns.length) sections.push(["## Open patterns (your hypotheses about how they go wrong)", ...patterns.map((pattern) => `- [${pattern.status}] ${pattern.title}: ${pattern.description}`)].join("\n"));

  const lessons = store.recentLessons(6, trackId);
  if (lessons.length) sections.push(["## Lessons you have taught", ...lessons.map((entry) => `- [[lesson:${entry.id}|${entry.title}]] — ${entry.summary} (${ago(entry.taughtAt)})`)].join("\n"));

  const reviews = reviewLines(store);
  if (reviews) sections.push(reviews);

  const intake = store.freshIntakeAnswer(sessionId);
  if (intake) sections.push(`## The learner's answer to your question\nYou asked: ${intake.question}\nThey answered: ${intake.answer}`);

  const conversation = session.messages.slice(-12).filter((message) => message.body.trim());
  if (conversation.length) {
    sections.push(["## This session so far", ...conversation.map((message) => `**${message.role === "learner" ? "Learner" : message.role === "agent" ? "You" : "Spar"}** (${ago(message.createdAt)}): ${message.body.trim().slice(0, 1_500)}`)].join("\n\n"));
  }

  const skills = skillsSection(input.skills ?? []);
  if (skills) sections.push(`## Skills\n${skills}`);
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
    challenge.outcome ? challenge.assistance : "",
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

function practiceLine(summary: unknown): string {
  if (!summary || typeof summary !== "object") return "";
  const value = summary as { providers?: Array<{ name?: string; connected?: boolean; judgesSubmissions?: boolean }>; alreadyAssigned?: Array<{ title?: string; slug?: string; source?: string }> };
  const providers = (value.providers ?? []).map((entry) => `${entry.name}${entry.connected ? " (connected" : " (not signed in"}${entry.judgesSubmissions ? ", judges submissions)" : ", graded locally on published examples)"}`);
  const assigned = (value.alreadyAssigned ?? []).slice(0, 12).map((entry) => entry.title ?? entry.slug).filter(Boolean);
  return [providers.length ? `Providers: ${providers.join("; ")}.` : "", assigned.length ? `Already assigned from providers: ${assigned.join(", ")}.` : ""].filter(Boolean).join("\n");
}

function reviewLines(store: LocalStore): string {
  const due = store.reviews.due(new Date(), 6);
  const lapsing = store.reviews.list().filter((card) => card.lapses >= 2).slice(0, 4);
  if (!due.length && !lapsing.length) return "";
  const line = (card: (typeof due)[number]) => `- ${card.title} (from "${card.questionTitle}"; ${card.concepts.map((tag) => tag.slug).join(", ")}; recall chance ${Math.round(card.retrievability * 100)}%, ${card.lapses} lapses)`;
  return [
    "## Spaced review",
    due.length ? `Due now (${store.reviews.overview().dueCount}):\n${due.map(line).join("\n")}` : "",
    lapsing.length ? `Repeatedly forgotten — treat as gaps, not solved topics:\n${lapsing.map(line).join("\n")}` : "",
  ].filter(Boolean).join("\n");
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
