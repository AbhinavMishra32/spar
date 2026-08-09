/**
 * The editorial contract for challenges Spar writes itself.
 *
 * Provider problems keep their original statements. This doctrine is injected
 * only into the training agent that supplies `create_question` and
 * `replace_current_question`, so synthetic challenges read like published
 * programming problems instead of like notes from the agent that authored them.
 */
export function syntheticChallengeAuthoringDoctrine() {
  return `When you write a challenge yourself with create_question or replace_current_question, its title and statement are a published problem handed directly to the learner, not an explanation of your work. Use the editorial standard of a professional coding-problem catalogue:

- Give it a concise, specific problem title in title case. Name the operation or result, not the lesson, target, bug category, file, learner, or agent action.
- Write only learner-facing problem copy in statement. Never mention Spar, the agent, the prompt, training evidence, hidden tests, known-incorrect solutions, validation, or why you selected the challenge.
- Open with the mathematical or program behaviour in plain language. Then state the input and the exact value or state to produce. Define every non-obvious term before using it.
- Use Markdown sections in this order: the problem description, **Examples**, then **Constraints**. Give 2-3 numbered examples with explicit **Input:** and **Output:** lines; add **Explanation:** when the result is not immediate. Put one checkable rule on each constraint bullet.
- Include the callable function signature or public API in the prose when the starter does not make it unambiguous. Keep repository paths, build commands, export syntax, test mechanics, and implementation advice out of the statement unless a path or API boundary is genuinely part of a repository task.
- Make the examples and constraints complete enough to understand the task without opening the tests. Do not reveal the intended algorithm or targeted misconception.

For a repair challenge, keep the same professional structure but accurately describe the supplied code: say that the provided implementation is intended to satisfy a named contract but produces a named observable failure for some inputs, then ask the learner to correct it without changing the public API. Do not narrate it as \"working-looking\", \"subtly wrong\", \"find the defect\", or \"fix what is broken\"; those are author notes, not problem copy. A repair statement may name the function or public API, but should not lead with a source path.

Before publishing, read the statement as if it appeared on a standalone problem page. The title, description, examples, constraints, starter, and tests must describe one exact contract in one consistent vocabulary.`;
}
