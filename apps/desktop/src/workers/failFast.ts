/**
 * Watches a suite's stdout and says when it has seen enough to stop.
 *
 * Fail-fast is read off the stream rather than asked of the harness, and that is
 * the whole design. Hidden tests are generated per challenge, in nine languages,
 * by a model: a `--bail` flag they all honour does not exist, and a convention
 * they are told to follow is one more thing that can come back wrong. Verdict
 * lines are already a contract both protocols keep — the result panel is drawn
 * from them — so the runner reads the stream it is forwarding anyway and kills
 * the process itself. Nothing in the suite has to cooperate.
 *
 * It does not stop on the failing line. That line is followed by the diagnostic
 * block, which is where the case says what it ran, expected and got — and for a
 * hidden case that block is the only way the learner will ever see the input.
 * Cutting it off would save a hundred milliseconds by throwing away the thing
 * the run was for. So the watcher waits for the block to close, or for the next
 * case to start without one, and the runner puts a short timeout behind it for a
 * harness that prints a bare `not ok` and nothing else.
 */

/** A verdict line, either protocol: TAP's `not ok 3 - name` and Spar's
 *  `not ok - name` start the same way once the line is trimmed. */
const VERDICT = /^(?:not ok|ok)\b/;
const FAILED = /^not ok\b/;
/** The end of a TAP diagnostic block. */
const BLOCK_END = /^\.\.\.$/;

export type FailFast = {
  /** Feed a chunk of stdout. True once the process should be killed. */
  feed(text: string): boolean;
  /** A failure has been seen and only its diagnostic is still outstanding. */
  failing(): boolean;
};

/**
 * The same cut, applied to output that has already been collected.
 *
 * The watcher only works on a suite that writes as it goes, and plenty do not.
 * Most runtimes block-buffer stdout the moment it is a pipe rather than a
 * terminal — Python and Ruby most visibly — so a thirty-five case suite hands
 * over all thirty-five verdicts in one chunk when the process exits, and by then
 * there is nothing left to kill. The stream watcher saves the work where the
 * work can be saved; this is what makes the *result* the same either way.
 *
 * Because that matters more than the saving. "The grader stops at your first
 * failing case" has to be true of every challenge in every language, or the grid
 * means one thing on a Go suite and another on a Python one. So the cut is
 * applied to the output as well as attempted on the stream: what comes back is
 * the run up to and including the first failure's diagnostic, and nothing after
 * it — including the TAP summary lines, which count a whole run that no longer
 * describes what is being reported.
 *
 * Returns null when the suite never failed, which is the one case where there is
 * nothing to cut and every verdict is worth keeping.
 */
export function truncateAtFailure(output: string): string | null {
  const lines = output.split("\n");
  let failedAt = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const line = (lines[index] ?? "").trim();
    if (failedAt < 0) {
      if (FAILED.test(line)) failedAt = index;
      continue;
    }
    /* The block has closed, or the next case has started without one. */
    if (BLOCK_END.test(line)) return lines.slice(0, index + 1).join("\n");
    if (VERDICT.test(line)) return lines.slice(0, index).join("\n");
  }
  if (failedAt < 0) return null;
  /* Failed on the last thing it said. There is nothing after it to drop. */
  return output;
}

export function createFailFast(): FailFast {
  /* Chunks arrive on no particular boundary, so a verdict can be split across
     two of them. Only whole lines are ever matched. */
  let partial = "";
  let failed = false;

  return {
    feed(text: string): boolean {
      partial += text;
      const lines = partial.split("\n");
      partial = lines.pop() ?? "";
      for (const entry of lines) {
        const line = entry.trim();
        if (!failed) {
          if (FAILED.test(line)) failed = true;
          continue;
        }
        if (BLOCK_END.test(line) || VERDICT.test(line)) return true;
      }
      return false;
    },
    failing: () => failed,
  };
}
