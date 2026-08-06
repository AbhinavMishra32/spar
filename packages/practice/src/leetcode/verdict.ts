import type { PracticeVerdict } from "../types.js";

/**
 * LeetCode's judge, translated.
 *
 * The judge answers with a numeric `status_code` and a pile of fields whose
 * presence depends on that code, so reading it is the one place this package
 * cannot avoid being defensive. The codes themselves are stable and are the same
 * ones both reference clients switch on:
 *
 *   10  the program ran to completion — which is *not* the same as correct
 *   11  Wrong Answer                  12  Memory Limit Exceeded
 *   13  Output Limit Exceeded         14  Time Limit Exceeded
 *   15  Runtime Error                 16  Internal Error (the judge's own fault)
 *   20  Compile Error                 21  Unknown Error
 *
 * Code 10 is the trap. On a submission it means accepted, because LeetCode only
 * returns 10 there when every hidden case passed. On a scratch run it means the
 * program did not crash, and correctness has to be read out of `compare_result`
 * — a string with one character per case, "1" for a match. A client that treats
 * 10 as a pass on a run tells the learner they solved something they did not.
 */
const STATUS_TEXT: Record<number, string> = {
  10: "Accepted",
  11: "Wrong Answer",
  12: "Memory Limit Exceeded",
  13: "Output Limit Exceeded",
  14: "Time Limit Exceeded",
  15: "Runtime Error",
  16: "Internal Error",
  20: "Compile Error",
  21: "Unknown Error",
};

/** The judge failing, as opposed to the code failing. Recorded as `errored` so
 *  nothing downstream files it as evidence about the learner. */
const JUDGE_FAULT = new Set([16, 21]);

type Judged = Record<string, unknown>;

export function normalizeLeetCodeVerdict(
  raw: unknown,
  context: { submitted: boolean; region: "global" | "cn"; slug: string },
): PracticeVerdict {
  const value = (raw && typeof raw === "object" ? raw : {}) as Judged;
  const statusCode = number(value.status_code);
  const compare = text(value.compare_result);
  const total = number(value.total_testcases) ?? number(value.total_correct) ?? (compare ? compare.length : 0) ?? 0;
  const correct = number(value.total_correct) ?? (compare ? [...compare].filter((flag) => flag === "1").length : 0) ?? 0;

  /* Per-case answers, which only a run returns. Zipped by index across four
     parallel arrays because that is the shape LeetCode sends; a missing entry is
     an empty string rather than a reason to drop the case, since "no output" is
     itself the answer for a case that threw. */
  const actual = strings(value.code_answer);
  const expected = strings(value.expected_code_answer);
  const stdout = strings(value.std_output_list);
  const inputs = splitInputs(text(value.last_testcase) ?? "", Math.max(actual.length, expected.length));
  const caseAnswers = Array.from({ length: Math.max(actual.length, expected.length) }, (_unused, index) => ({
    input: inputs[index] ?? "",
    expected: expected[index] ?? "",
    actual: actual[index] ?? "",
    passed: compare ? compare[index] === "1" : (expected[index] ?? null) === (actual[index] ?? undefined),
  }));

  const compileError = text(value.full_compile_error) ?? text(value.compile_error) ?? "";
  const runtimeError = text(value.full_runtime_error) ?? text(value.runtime_error) ?? "";

  const ran = statusCode === 10;
  /**
   * A run that judged nothing.
   *
   * LeetCode answers an empty `data_input` with status 10, `correct_answer: true`
   * and no cases at all — a vacuous acceptance, and the one answer this must never
   * pass on as a pass. It is reported as `errored`, not `failed`: the learner's code
   * was not wrong, it was never tried, and filing it as a failure would put a
   * verdict nobody reached into their record.
   */
  const judgedNothing = !context.submitted && ran && total === 0 && caseAnswers.length === 0;
  const allCasesMatch = compare ? /^1+$/.test(compare) : value.correct_answer === true || (total > 0 && correct === total);
  const outcome: PracticeVerdict["outcome"] =
    statusCode === null || judgedNothing || (statusCode !== null && JUDGE_FAULT.has(statusCode))
      ? "errored"
      : ran && (context.submitted ? statusText(value, statusCode) === "Accepted" : allCasesMatch)
        ? "passed"
        : "failed";

  /* The one case worth naming. A submission gives it directly; a run has to be
     asked which index of `compare_result` first failed. */
  const failedIndex = compare ? [...compare].findIndex((flag) => flag !== "1") : -1;
  const submissionId = text(value.submission_id) ?? "";
  const failedCase = context.submitted
    ? text(value.last_testcase)
      ? {
        input: text(value.last_testcase) ?? "",
        expected: text(value.expected_output) ?? "",
        actual: text(value.code_output) ?? "",
        stdout: text(value.std_output) ?? "",
      }
      : null
    : failedIndex >= 0
      ? {
        input: inputs[failedIndex] ?? "",
        expected: expected[failedIndex] ?? "",
        actual: actual[failedIndex] ?? "",
        stdout: stdout[failedIndex] ?? "",
      }
      : null;

  return {
    outcome,
    /* The judge's word for it, except where the judge's word would mislead: it says
       "Accepted" over a run it was given no cases for. */
    status: judgedNothing ? "No cases were run" : statusText(value, statusCode),
    statusCode,
    passedCases: outcome === "passed" && total === 0 ? Math.max(correct, caseAnswers.length) : correct,
    totalCases: total || caseAnswers.length,
    runtime: text(value.status_runtime) ?? text(value.display_runtime) ?? "",
    memory: text(value.status_memory) ?? "",
    runtimePercentile: number(value.runtime_percentile),
    memoryPercentile: number(value.memory_percentile),
    compileError,
    runtimeError,
    failedCase,
    caseAnswers: context.submitted ? [] : caseAnswers,
    stdout,
    submitted: context.submitted,
    submissionId,
    /* Only a real submission has a page. A run's id is a `runcode_...` token that
       resolves to nothing, and linking it would send the learner to a 404. */
    submissionUrl: context.submitted && submissionId
      ? `${context.region === "cn" ? "https://leetcode.cn" : "https://leetcode.com"}/submissions/detail/${submissionId}/`
      : "",
    judgedAt: new Date().toISOString(),
  };
}

/** The judge's own sentence, preferred over the table: LeetCode occasionally
 *  refines the wording ("Wrong Answer" vs "Invalid Testcase" under code 15) and
 *  its wording is what the learner sees on the site. */
function statusText(value: Judged, statusCode: number | null): string {
  const given = text(value.status_msg);
  if (given) return given;
  if (statusCode !== null && STATUS_TEXT[statusCode]) return STATUS_TEXT[statusCode] as string;
  return "Unknown";
}

/**
 * Whether the judge is still working. LeetCode answers a check with
 * `{state: "PENDING"|"STARTED"}` and no status code until it is done, and an
 * unrecognised body is treated as pending rather than as finished — the caller
 * has a deadline, and guessing "finished" would invent a verdict.
 */
export function isJudgePending(raw: unknown): boolean {
  const value = (raw && typeof raw === "object" ? raw : {}) as Judged;
  const state = typeof value.state === "string" ? value.state.toUpperCase() : "";
  if (state === "SUCCESS" || state === "FAILURE") return false;
  if (state === "PENDING" || state === "STARTED") return true;
  return number(value.status_code) === null;
}

/** LeetCode packs a case's arguments as newline-separated lines. A case with two
 *  parameters therefore occupies two lines, so the block is split by count
 *  rather than by line — which is the only way to keep multi-argument cases
 *  aligned with their answers. */
function splitInputs(block: string, cases: number): string[] {
  const lines = block.split("\n").filter((line) => line.length > 0);
  if (!cases || !lines.length) return [];
  const perCase = Math.max(1, Math.round(lines.length / cases));
  return Array.from({ length: cases }, (_unused, index) => lines.slice(index * perCase, (index + 1) * perCase).join("\n"));
}

function number(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

/** A judge field as text. Numbers are coerced rather than rejected: LeetCode
 *  returns `submission_id` as a number from `/submit/` and as a string from
 *  `/interpret_solution/`, and rejecting the number is how a real submission
 *  ends up with no link to itself. */
function text(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return typeof value === "string" && value.trim() ? value : null;
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => (typeof entry === "string" ? entry : JSON.stringify(entry) ?? ""));
}
