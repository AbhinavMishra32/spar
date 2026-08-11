import type { Language } from "@spar/domain";

/**
 * How long a graded run may take, by language.
 *
 * The budget covers the *whole* command, and for C++ the whole command is a
 * toolchain: one `clang++` invocation per test program, each parsing the standard
 * library from source, before a single assertion is ever checked. On a developer
 * machine that is seconds to tens of seconds — a bare `clang++ --version` behind
 * the Command Line Tools shim costs two of them — while `node --test` on the same
 * machine is up and finished in well under one.
 *
 * One number for both was the bug. Eight seconds is generous for a script and
 * unreachable for a compile, so every C++ candidate was rejected with `reference
 * solution: Process stopped after 8000ms` — and a timeout does not read as "the
 * toolchain is slow", it reads as "this program does not terminate". The agent
 * duly went looking for the infinite loop in a correct three-line scan, redesigned
 * it, and spent its whole compilation budget being told the same thing. The
 * learner met it from the other side: pressing *run* on a C++ challenge killed
 * their own passing tests mid-compile.
 *
 * So the budget has to be bigger than the toolchain, and it is sized on the
 * compile rather than on the program: a timeout is only information when it means
 * the code is at fault.
 */
export const RUN_TIMEOUT_MS: Record<Language, number> = {
  javascript: 8_000,
  typescript: 12_000,
  python: 12_000,
  ruby: 12_000,
  go: 60_000,
  rust: 90_000,
  java: 60_000,
  c: 60_000,
  /* Two cold compiles and their runs, with room for a loaded machine. A C++
     program that genuinely loops forever still gets caught here — it just costs a
     minute to find out, which is the right trade against never being able to set
     a C++ challenge at all. */
  cpp: 90_000,
  swift: 90_000,
};

export const MEMORY_LIMIT_MB = 512;

export function runLimits(language: Language): { timeoutMs: number; memoryMb: number } {
  return { timeoutMs: RUN_TIMEOUT_MS[language] ?? RUN_TIMEOUT_MS.javascript, memoryMb: MEMORY_LIMIT_MB };
}
