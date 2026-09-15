import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { compare, diffTraces, gate, parseTrace, renderTraceDiff, summarize, type Scorecard, type Trace } from "@spar/eval";
import { prepareBaseline, repoRoot, runSuiteIn } from "./baseline.js";
import { providerFromEnv } from "./live.js";
import { renderComparison, renderGate, renderScorecard, renderSummary } from "./report.js";
import { runSuite } from "./run.js";
import { SCENARIOS } from "./scenarios.js";

/**
 * The eval, from a terminal.
 *
 * Three verbs, and the middle one is the reason the other two exist:
 *
 *   run        the suite here, scored, traces kept
 *   compare    the same suite against an older commit, paired and gated
 *   diff       one scenario's two traces, step by step
 *
 * `compare` is how a change to the ledger gets defended. It runs today's
 * scenarios against a checkout of the baseline commit, pairs the runs, and asks
 * of every difference whether it is one you would see by chance. `diff` is what
 * you read afterwards when the answer is yes and you want to know where the two
 * runs parted company.
 */

const USAGE = `
spar eval

  run [--arm <name>] [--mode scripted|live|replay] [--seeds 1,2] [--scenario <id>]
      [--cassettes <dir>] [--out <dir>] [--json]
  compare --against <git-ref> [--scenario <id>] [--out <dir>] [--gate]
  diff --against <git-ref> --scenario <id> [--out <dir>]

Modes
  scripted  the default. A fixed, competent agent against the real store, so a
            difference between two runs is a difference in the host. Free.
  live      Spar's real worker against a real model, recording every call.
            Needs SPAR_EVAL_API_KEY and SPAR_EVAL_MODEL. Costs money.
  replay    the same worker against what was recorded. Free, deterministic, and
            reports every turn where the code now asks something new.

Scenarios: ${SCENARIOS.map((scenario) => scenario.id).join(", ")}
`.trim();

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  const flags = parseFlags(rest);
  const out = flags.out ?? join(repoRoot(), ".spar-eval", "runs");

  if (!command || command === "help" || flags.help) { console.log(USAGE); return 0; }

  if (command === "run") {
    const mode = (flags.mode ?? "scripted") as "scripted" | "live" | "replay";
    if (mode === "live" && !providerFromEnv()) {
      console.error("A live run needs SPAR_EVAL_API_KEY and SPAR_EVAL_MODEL in the environment (optionally SPAR_EVAL_PROVIDER, SPAR_EVAL_API, SPAR_EVAL_BASE_URL).");
      return 2;
    }
    const result = await runSuite({
      arm: flags.arm ?? (mode === "scripted" ? "candidate" : mode), seeds: numbers(flags.seeds) ?? [1], outDir: out, mode,
      cassetteDir: flags.cassettes ?? join(repoRoot(), "apps/desktop/src/eval/cassettes"),
      ...(list(flags.scenario) ? { scenarios: list(flags.scenario)! } : {}),
    });
    if (flags.json) { console.log(JSON.stringify(result.summary, null, 2)); return 0; }
    console.log(renderSummary(result.summary, { duplicates: result.duplicates }));
    console.log("");
    for (const card of result.scorecards) { console.log(renderScorecard(card)); console.log(""); }
    /* A failing check is a finding, not a broken command. The only thing that
       makes this exit non-zero is the gate, and the gate is `compare`. */
    return result.scorecards.some((card) => card.error) ? 1 : 0;
  }

  if (command === "compare" || command === "diff") {
    const ref = flags.against;
    if (!ref) { console.error("compare needs --against <git-ref>: the commit this build is being defended against."); return 2; }
    const scenarios = list(flags.scenario);

    const candidate = await runSuite({ arm: "candidate", seeds: numbers(flags.seeds) ?? [1], outDir: out, ...(scenarios ? { scenarios } : {}) });

    console.log(`Preparing ${ref}…`);
    const worktree = prepareBaseline(ref);
    runSuiteIn(worktree, ["run", "--arm", "baseline", "--out", out, ...(scenarios ? ["--scenario", scenarios.join(",")] : []), ...(flags.seeds ? ["--seeds", flags.seeds] : [])]);
    const baselineCards = readScorecards(join(out, "baseline"));
    if (!baselineCards.length) { console.error(`The baseline run at ${ref} produced no scorecards.`); return 1; }

    if (command === "diff") {
      for (const trace of candidate.traces) {
        const before = readTrace(join(out, "baseline", `${trace.header.scenario}-baseline-${trace.header.seed}.json`));
        if (!before) { console.log(`No baseline trace for ${trace.header.scenario}.`); continue; }
        console.log(renderTraceDiff(diffTraces(before, trace)));
        console.log("");
      }
      return 0;
    }

    const comparison = compare(summarize("baseline", baselineCards), candidate.summary, { baseline: baselineCards, candidate: candidate.scorecards });
    console.log("");
    console.log(renderComparison(comparison));

    if (flags.gate) {
      const verdict = gate(comparison, { required: ["names-the-mistake", "keeps-the-finding"], budgets: { toolCalls: 40 } });
      console.log("");
      console.log(renderGate(verdict));
      return verdict.passed ? 0 : 1;
    }
    return 0;
  }

  console.error(`No such command: ${command}\n\n${USAGE}`);
  return 2;
}

function readScorecards(dir: string): Scorecard[] {
  const file = join(dir, "scorecards.json");
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Scorecard[]) : [];
}

function readTrace(file: string): Trace | null {
  if (!existsSync(file)) return null;
  try { return parseTrace(JSON.parse(readFileSync(file, "utf8"))); } catch { return null; }
}

/** Long-form flags only. A one-letter alias saves four characters and costs a
 *  reader the ability to guess what a command does. */
function parseFlags(argv: string[]): Record<string, string | undefined> & { help?: boolean; json?: boolean; gate?: boolean } {
  const flags: Record<string, string | boolean | undefined> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) { flags[key] = next; index += 1; } else flags[key] = true;
  }
  return flags as Record<string, string | undefined> & { help?: boolean; json?: boolean; gate?: boolean };
}

const list = (value: string | undefined) => (value ? value.split(",").map((item) => item.trim()).filter(Boolean) : undefined);
const numbers = (value: string | undefined) => list(value)?.map(Number).filter(Number.isFinite);

main(process.argv.slice(2))
  .then((code) => { process.exitCode = code; })
  .catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  });
