/**
 * The parts of the coach's instructions that depend on the session rather than
 * on Spar: which problem sources it may use and which skills it can load.
 *
 * They live in the journey document, not the system prompt, so the system
 * prompt stays identical across sessions and the provider's cache holds.
 */

const SOURCE_LABEL: Record<string, string> = { spar: "Spar-written challenges", leetcode: "LeetCode", codeforces: "Codeforces" };

/** Empty for a session that allows every source. */
export function sessionSourcesSection(problemSources: string[] | undefined, practiceSource: boolean): string {
  const sources = problemSources?.length ? problemSources : ["spar", "leetcode", "codeforces"];
  if (sources.length === 3) return "";
  const sparAuthoring = sources.includes("spar");
  const external = sources.filter((source) => source !== "spar");
  const names = external.map((source) => SOURCE_LABEL[source] ?? source).join(" and ");
  const allowed = sources.map((source) => SOURCE_LABEL[source] ?? source).join(", ");
  const header = `The learner set this session to take challenges only from: ${allowed}.`;
  if (!external.length) return `${header} Do not search or assign provider problems; set every challenge with set_challenge.`;
  const scope = `Search, read and assign only ${names} problems; the host refuses any other provider.`;
  if (!sparAuthoring) {
    if (!practiceSource) return `${header} No provider tool is available this turn, so you cannot set a challenge. Say so plainly and suggest they connect ${names} in Settings or allow Spar-written challenges for this session.`;
    return `${header} ${scope} set_challenge is not available here, so every challenge is a real ${names} problem. Real problems are coarser than lessons: choose the problem, then teach toward what in it is new.`;
  }
  return `${header} ${scope} set_challenge writes Spar's own.`;
}

/** The skills this turn can load: names and the one sentence that says when each
 *  applies. Nothing past the description is in context until the coach (or the
 *  builder, when a brief names it) loads one. */
export function skillsSection(skills: { name: string; description: string }[]): string {
  if (!skills.length) return "";
  const list = skills.map((skill) => `- ${skill.name}: ${skill.description.replace(/\s+/g, " ").trim()}`).join("\n");
  return `${list}

Call load_skill before doing the work a skill describes; its instructions override your defaults for that work. For work the builder does, name the skill in set_challenge's skills instead, and the builder will follow it.`;
}
