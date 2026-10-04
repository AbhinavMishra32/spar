import { DEFAULT_CHALLENGE_MIX, type ChallengeMix, type Language, type Lens, type LensDepth, type ProblemSource, type SparUse } from "@spar/domain";

/**
 * The words both sides use for a session's coaching settings.
 *
 * One file for the renderer and the journey document on purpose: the coach
 * reads the same lens the learner switched on, with the instruction behind it.
 */

export type LensInfo = {
  id: string;
  label: string;
  /** What the lens is about, concretely enough to act on. */
  about: string;
};

/**
 * The language lenses, as dimensions rather than a table per language: every
 * language has idioms, a standard library, a type system and deep cuts, and the
 * coach knows what those are for each one. The label and the instruction take
 * the Track's language; nothing here lists what Python's idioms are.
 */
const LANGUAGE_DIMENSIONS: Array<{ id: string; label(language: string): string; about(language: string): string }> = [
  { id: "lang-idioms", label: (language) => `${language} idioms`, about: (language) => `Idiomatic ${language}: the constructs a fluent ${language} programmer reaches for instead of the long way round, shown beside what they wrote.` },
  { id: "lang-stdlib", label: () => "Standard library", about: (language) => `${language}'s standard library and built-in data structures: the one that fits the problem, when it beats hand-rolling, and what it costs.` },
  { id: "lang-types", label: () => "Types & structure", about: (language) => `${language}'s type system and ways of structuring code — type annotations, classes, structs, interfaces, generics, whatever ${language} has — used well in solutions and starters.` },
  { id: "lang-deep", label: (language) => `Deep ${language}`, about: (language) => `The nerdy side of ${language}: how it works underneath, surprising semantics, performance characteristics and tricks worth knowing, one relevant fact at a time.` },
];

/** Lenses about the craft, in any language. */
const CRAFT: LensInfo[] = [
  { id: "from-scratch", label: "Build it yourself", about: "Building the structure a problem leans on before using it — a tree node with a builder from a list, a linked list, a heap, a trie, union-find — then pointing out what the library would have done." },
  { id: "under-the-hood", label: "Under the hood", about: "How the runtime actually does it: hashing and collisions, amortised array growth, the call stack and recursion limits, the real cost of the built-ins they reach for." },
  { id: "complexity", label: "Complexity", about: "Stating and justifying time and space complexity, including hidden costs like copying, string building and sorting." },
  { id: "edge-cases", label: "Edge cases", about: "Finding the edge cases before coding — empty, single, duplicates, negatives, overflow — and naming the case class a solution missed." },
  { id: "clean-code", label: "Clean code", about: "Reviewing a passing solution like a code review: naming, small functions, dead branches, idiomatic structure." },
];

/** The catalogue for a language: its dimensions first, then the craft. */
export function lensCatalogue(language: Language): { language: LensInfo[]; craft: LensInfo[] } {
  const name = LANGUAGE_NAME[language];
  return { language: LANGUAGE_DIMENSIONS.map((entry) => ({ id: entry.id, label: entry.label(name), about: entry.about(name) })), craft: CRAFT };
}

/** A lens as the panel and the coach describe it; a custom lens is its label. */
export function lensInfo(lens: { id: string; label?: string | undefined }, language: Language): LensInfo | null {
  const catalogue = lensCatalogue(language);
  const known = [...catalogue.language, ...catalogue.craft].find((entry) => entry.id === lens.id);
  if (known) return known;
  if (lens.label) return { id: lens.id, label: lens.label, about: lens.label };
  return null;
}

const LANGUAGE_NAME: Record<Language, string> = {
  javascript: "JavaScript", typescript: "TypeScript", python: "Python", java: "Java", c: "C", cpp: "C++", go: "Go", rust: "Rust", swift: "Swift", ruby: "Ruby",
};

export function customLensId(label: string): string {
  return `custom:${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "lens"}`;
}

export const DEPTH_COPY: Record<LensDepth, { label: string; detail: string }> = {
  mention: { label: "Mention", detail: "A one-line note in feedback when it comes up" },
  teach: { label: "Teach", detail: "A short explanation, or a lesson, when it's relevant" },
  drill: { label: "Drill", detail: "Spar problems written to make you practise it" },
};

const DEPTH_RULE: Record<LensDepth, string> = {
  mention: "when it comes up in their code, name it in one line of feedback — no more",
  teach: "when it is relevant, explain it properly: a short aside in your reply, or a teach_lesson when it deserves one",
  drill: "teach it when relevant, and write Spar problems that make them practise it — as a requirement, part of the starter or the shape of the data",
};

/**
 * "When should Spar write the problem?", as one ladder from never to always.
 *
 * The two ends are the sources (Spar off; nothing but Spar), the four between
 * are `sparUse`. One list reads as one decision, which is what this is.
 */
export type SparChoice = "never" | SparUse | "always";

export const SPAR_CHOICES: Array<{ value: SparChoice; title: string; detail: string }> = [
  { value: "never", title: "Never", detail: "Only real problems" },
  { value: "struggling", title: "When I'm struggling", detail: "Real problems, Spar to repair a concept" },
  { value: "less", title: "Less often", detail: "Mostly real, Spar now and then" },
  { value: "balanced", title: "Balanced", detail: "Whichever fits better" },
  { value: "more", title: "More often", detail: "Mostly Spar, real ones to prove it" },
  { value: "always", title: "Always", detail: "Every problem written by Spar" },
];

export function sparChoice(sources: ProblemSource[], mix: ChallengeMix): SparChoice {
  if (!sources.includes("spar")) return "never";
  if (sources.length === 1) return "always";
  return mix.sparUse;
}

const SPAR_USE_RULE: Record<SparUse, string> = {
  struggling: "Default to a real LeetCode or Codeforces problem. Write a Spar problem when the learner is struggling with a concept — a fail, a give-up, heavy hints, a long grind — to repair that one gap, or as a short bridge when the next real problem needs a mechanism they have not yet shown on their own and no easier real problem isolates it. Then go back to real problems.",
  less: "Mostly real LeetCode or Codeforces problems. Write a Spar problem now and then — roughly one in four — when no real problem isolates the idea well enough, or to repair a struggle.",
  balanced: "",
  more: "Mostly Spar-written problems aimed at the exact gap. Assign a real LeetCode or Codeforces problem roughly one in four, usually once an idea is landing, to prove it holds on something unfamiliar.",
};

export function isDefaultMix(mix: ChallengeMix): boolean {
  return JSON.stringify(mix) === JSON.stringify(DEFAULT_CHALLENGE_MIX);
}

/** One thing the coach did through a lens, as the host logged it. */
export type LensHistoryEntry = { kind: "challenge" | "lesson" | "feedback"; note: string; at: string };

/**
 * The settings as the coach reads them in the journey: plain instructions.
 * Empty when they say nothing the coach would not already do.
 *
 * They are standing orders for the whole Track, not a note for when a problem
 * is written, so each lens carries its history — what was drilled, taught and
 * said through it, and when. That is how the coach knows a lens has gone quiet
 * without having to remember it.
 */
export function challengeMixInstructions(mix: ChallengeMix, sources: string[], language: Language, history: Record<string, LensHistoryEntry[]> = {}, now = Date.now()): string {
  const spar = sources.includes("spar");
  const external = sources.some((source) => source !== "spar");
  const lines: string[] = [];

  const rule = spar && external ? SPAR_USE_RULE[mix.sparUse] : "";
  if (rule) lines.push(`When to write a Spar problem (the learner chose this; follow it unless they ask otherwise in chat): ${rule}`);

  const lenses = mix.lenses.flatMap((lens) => { const info = lensInfo(lens, language); return info ? [{ lens, info }] : []; });
  if (lenses.length) {
    lines.push("", "Lenses — what the learner asked you to go deeper on, for this whole Track, each at the depth they chose. They are part of how you coach rather than a checklist for every reply: bring one in where it fits — a line of their code, their question, the next problem. The history under each shows what you have done through it and which has gone quiet.");
    for (const { lens, info } of lenses) {
      /* Drill needs a Spar problem to carry it; with Spar off it is teaching. */
      const depth: LensDepth = lens.depth === "drill" && !spar ? "teach" : lens.depth;
      lines.push(`- ${info.label} (${lens.id}) — ${DEPTH_COPY[depth].label.toLowerCase()}: ${DEPTH_RULE[depth]}.${info.about !== info.label ? ` About: ${info.about}` : ""}`);
      const past = history[lens.id] ?? [];
      lines.push(past.length
        ? `  So far: ${past.map((entry) => `${entry.kind} ${since(entry.at, now)} — ${entry.note}`).join("; ")}`
        : "  So far: nothing yet.");
    }
    lines.push("How the history is kept: set_challenge's lens names the lens a Spar problem drills; review_solution's lenses records what their code showed through each; teach_lesson's lens tags a lesson taught through one.");
  }

  if (mix.suggestions.length) lines.push("", `Lenses you suggested that the learner has not answered yet: ${mix.suggestions.map((entry) => entry.label ?? lensInfo(entry, language)?.label ?? entry.id).join(", ")}. They are waiting in the learner's settings.`);
  if (mix.dismissed.length) lines.push(`The learner turned these lens suggestions down: ${mix.dismissed.join(", ")}.`);

  const instructions = mix.instructions.trim();
  if (instructions) lines.push("", `The learner's custom instructions for you. They apply to every turn, and override your defaults where they conflict, but never the host's rules:\n"""\n${instructions}\n"""`);
  return lines.join("\n").trim();
}

function since(at: string, now: number): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(at)) / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}
