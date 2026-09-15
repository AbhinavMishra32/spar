import { eventsOfKind, type Measures, type Trace, type Verifier } from "@spar/eval";
import type { LedgerSnapshot, Misconception, Scenario } from "./types.js";

/**
 * What a run is graded on, with no model involved.
 *
 * Every check here is a statement about Spar's own record, phrased so that it
 * could be read out to somebody who has never seen the code: did Spar work out
 * what this learner's actual problem was, did it hold on to it, did what it
 * believes match what it saw. None of it asks whether the prose was nice.
 *
 * The rule the whole set obeys: **a check may only fail for the reason it
 * names.** A check called "keeps the finding" that also quietly fails when the
 * run crashed is a check nobody can act on, which is why applicability is
 * decided up front and a run with no ledger at all skips rather than fails. The
 * crash is reported as a crash, once, by the runner.
 */

export function sparVerifiers(scenario: Scenario): Verifier[] {
  const { misconception, expect } = scenario;
  const final = (trace: Trace) => snapshots(trace).at(-1)?.snapshot ?? null;
  const beforeIdle = (trace: Trace) => attemptSnapshots(trace).at(-1)?.snapshot ?? null;
  const hasLedger = (trace: Trace) => Boolean(beforeIdle(trace));

  const verifiers: Verifier[] = [
    {
      id: "names-the-mistake",
      description: "Spar's own record describes what the learner did, at the resolution the replay supports, rather than naming the topic.",
      applies: hasLedger,
      run(trace) {
        const readings = (beforeIdle(trace)?.evidence ?? []).map((item) => item.statement);
        const best = readings.map((statement) => ({ statement, hits: markerHits(statement, misconception) })).sort((a, b) => b.hits - a.hits)[0];
        if (!best) return { outcome: "fail" as const, detail: "Spar recorded no behavioural reading of any attempt at all." };
        return best.hits >= misconception.markersRequired
          ? { outcome: "pass" as const, detail: `Named it in ${best.hits} of the terms the misconception is described in: "${clip(best.statement)}"` }
          : { outcome: "fail" as const, detail: `The closest reading hit ${best.hits} of a required ${misconception.markersRequired} terms: "${clip(best.statement)}"` };
      },
    },
    {
      id: "interprets-rather-than-grades",
      description: "No reading in the record is a verdict — a sentence about how the attempt came out rather than about what the learner did.",
      applies: hasLedger,
      run(trace) {
        const verdicts = (beforeIdle(trace)?.evidence ?? [])
          .map((item) => item.statement)
          .filter((statement) => misconception.verdictWords.some((word) => statement.toLowerCase().includes(word)) && markerHits(statement, misconception) < misconception.markersRequired);
        return verdicts.length
          ? { outcome: "fail" as const, detail: `${verdicts.length} reading${verdicts.length === 1 ? "" : "s"} said how it came out and nothing about what happened: "${clip(verdicts[0]!)}"` }
          : { outcome: "pass" as const, detail: `All ${(beforeIdle(trace)?.evidence ?? []).length} readings describe behaviour.` };
      },
    },
    {
      id: "the-contract-demands-interpretation",
      description: "The tool contract refuses an ability update that carries no interpretation, so the generic fallback cannot be reached.",
      run(trace) {
        const probe = contractProbe(trace);
        if (probe === null) return { outcome: "skip" as const, detail: "This run did not probe the contract." };
        return probe
          ? { outcome: "pass" as const, detail: "An update with no evidence entry is rejected before it reaches the host." }
          : { outcome: "fail" as const, detail: "An update with no evidence entry is accepted, so the host fills one in from passed/failed." };
      },
    },
    {
      id: "keeps-the-finding",
      description: expect.pattern === false
        ? "Spar does not invent a standing mistake for a learner who does not have one."
        : "A finding seen more than once becomes a standing pattern rather than being written down again from scratch.",
      applies: hasLedger,
      run(trace) {
        const standing = (beforeIdle(trace)?.patterns ?? []).filter((pattern) => ["pattern", "monitoring", "resolved"].includes(pattern.status));
        const all = beforeIdle(trace)?.patterns ?? [];
        if (expect.pattern === false) {
          return standing.length === 0
            ? { outcome: "pass" as const, detail: `Nothing was promoted, from ${all.length} observation${all.length === 1 ? "" : "s"}.` }
            : { outcome: "fail" as const, detail: `Promoted "${standing[0]!.title}" for a learner whose attempts never repeated a mistake.` };
        }
        return standing.length > 0
          ? { outcome: "pass" as const, detail: `"${standing[0]!.title}" stands on ${standing[0]!.evidenceCount} linked observations.` }
          : { outcome: "fail" as const, detail: all.length ? `The finding was recorded ${all.length} time${all.length === 1 ? "" : "s"} and never got past "${all[0]!.status}" — nothing could see the earlier one to promote it.` : "No finding was recorded at all." };
      },
    },
    {
      id: "files-the-finding-once",
      description: "The same mistake is one row in the ledger, not one row per attempt.",
      applies: hasLedger,
      run(trace) {
        const titles = (beforeIdle(trace)?.patterns ?? []).map((pattern) => pattern.title.toLowerCase());
        const duplicated = titles.filter((title, index) => titles.indexOf(title) !== index);
        return duplicated.length
          ? { outcome: "fail" as const, detail: `"${duplicated[0]}" is filed ${titles.filter((title) => title === duplicated[0]).length} times.` }
          : { outcome: "pass" as const, detail: `${new Set(titles).size} distinct finding${new Set(titles).size === 1 ? "" : "s"}, none repeated.` };
      },
    },
  ];

  if (expect.statusNot?.length) {
    verifiers.push({
      id: "does-not-overclaim",
      description: `Spar does not file this learner as ${expect.statusNot.join(" or ")} on the record they actually produced.`,
      applies: hasLedger,
      run(trace) {
        const overclaimed = (beforeIdle(trace)?.abilities ?? []).filter((ability) => expect.statusNot!.includes(ability.status));
        return overclaimed.length
          ? { outcome: "fail" as const, detail: `"${overclaimed[0]!.title}" is filed as ${overclaimed[0]!.status} after a run of attempts that does not support it.` }
          : { outcome: "pass" as const, detail: `Filed as ${(beforeIdle(trace)?.abilities ?? []).map((ability) => ability.status).join(", ") || "nothing"}.` };
      },
    });
  }

  if (typeof expect.proficiencyBelow === "number" || typeof expect.proficiencyAbove === "number") {
    verifiers.push({
      id: "the-number-matches-the-record",
      description: "The number beside the ability reads the evidence rather than counting it.",
      applies: (trace) => Boolean(beforeIdle(trace)?.abilities.length),
      run(trace) {
        const ability = (beforeIdle(trace)?.abilities ?? [])[0]!;
        const proficiency = ability.proficiency;
        if (typeof expect.proficiencyBelow === "number" && proficiency >= expect.proficiencyBelow) {
          return { outcome: "fail" as const, detail: `${proficiency.toFixed(2)} on a record of ${describe(scenario)} — it should be under ${expect.proficiencyBelow}.` };
        }
        if (typeof expect.proficiencyAbove === "number" && proficiency <= expect.proficiencyAbove) {
          return { outcome: "fail" as const, detail: `${proficiency.toFixed(2)} on a record of ${describe(scenario)} — it should be over ${expect.proficiencyAbove}.` };
        }
        return { outcome: "pass" as const, detail: `${proficiency.toFixed(2)} on a record of ${describe(scenario)}.` };
      },
    });
  }

  if (expect.rating) {
    verifiers.push({
      id: "the-rating-is-earned",
      description: `The rating moves ${expect.rating} on this record — it is what the learner has shown against problems, not a second view of the ledger.`,
      applies: (trace) => Boolean(first(trace)?.rating && beforeIdle(trace)?.rating),
      run(trace) {
        const before = first(trace)!.rating!.rating;
        const after = beforeIdle(trace)!.rating!.rating;
        const moved = after - before;
        const right = expect.rating === "up" ? moved > 0 : moved < 0;
        return right
          ? { outcome: "pass" as const, detail: `${before} → ${after} (${moved > 0 ? "+" : ""}${moved}).` }
          : { outcome: "fail" as const, detail: `${before} → ${after} on a record of ${describe(scenario)}; it should have gone ${expect.rating}.` };
      },
    });
  }

  if (expect.trend) {
    verifiers.push({
      id: "improvement-is-visible",
      description: "A learner who got better over the run reads as having got better, rather than as an average of their attempts.",
      applies: (trace) => attemptSnapshots(trace).length >= 2,
      run(trace) {
        const series = attemptSnapshots(trace).map((entry) => entry.snapshot.abilities[0]?.proficiency ?? 0);
        const moved = (series.at(-1) ?? 0) - (series[0] ?? 0);
        const right = expect.trend === "improving" ? moved > 0.02 : expect.trend === "declining" ? moved < -0.02 : Math.abs(moved) <= 0.02;
        return right
          ? { outcome: "pass" as const, detail: `${series.map((value) => value.toFixed(2)).join(" → ")}.` }
          : { outcome: "fail" as const, detail: `${series.map((value) => value.toFixed(2)).join(" → ")} does not read as ${expect.trend}.` };
      },
    });
  }

  verifiers.push({
    id: "an-unchecked-ability-goes-stale",
    description: "An ability Spar has not verified in months stops counting as current on its own.",
    applies: (trace) => (beforeIdle(trace)?.abilities ?? []).some((ability) => ability.status === "independent"),
    run(trace) {
      const stale = (final(trace)?.abilities ?? []).filter((ability) => ability.status === "stale");
      return stale.length
        ? { outcome: "pass" as const, detail: `${stale.length} ability went stale after sixty idle days.` }
        : { outcome: "fail" as const, detail: "Sixty days passed with no evidence and the ability still reads as current." };
    },
  });

  return verifiers;
}

/**
 * The numbers a run produced that are not verdicts.
 *
 * `attemptsToFinding` is the one worth watching. Whether Spar eventually names
 * the mistake is a yes or no and it saturates quickly; *how long it took* keeps
 * moving long after the check has gone green, and a change that takes it from
 * four attempts to two is an improvement no pass rate can show.
 */
export function sparMeasures(trace: Trace): Measures {
  const calls = eventsOfKind(trace, "tool_call");
  const results = eventsOfKind(trace, "tool_result");
  const perAttempt = attemptSnapshots(trace);
  const firstStanding = perAttempt.findIndex((entry) => entry.snapshot.patterns.some((pattern) => ["pattern", "monitoring", "resolved"].includes(pattern.status)));
  const last = perAttempt.at(-1)?.snapshot;
  return {
    toolCalls: calls.length,
    refusals: results.filter((result) => !result.ok).length,
    /* Never-happened is recorded as one past the end rather than as infinity, so
       it can be averaged and bootstrapped with the runs where it did happen.
       Reading it needs the attempt count beside it, which is why that is here. */
    attemptsToFinding: firstStanding === -1 ? perAttempt.length + 1 : firstStanding + 1,
    attempts: perAttempt.length,
    finalProficiency: last?.abilities[0]?.proficiency ?? 0,
    finalConfidence: last?.abilities[0]?.confidence ?? 0,
    finalRating: last?.rating?.rating ?? 0,
    noticeCount: last?.notices.length ?? 0,
  };
}

function snapshots(trace: Trace): Array<{ label: string; snapshot: LedgerSnapshot }> {
  return eventsOfKind(trace, "ledger").map((event) => ({ label: event.label, snapshot: event.snapshot as unknown as LedgerSnapshot }));
}

/** What Spar believed after each attempt, in order. The opening snapshot and the
 *  one taken after the idle period are deliberately not in here: they are the
 *  two ends a run is measured between, not points on the curve. */
function attemptSnapshots(trace: Trace): Array<{ label: string; snapshot: LedgerSnapshot }> {
  return snapshots(trace).filter((entry) => entry.label.startsWith("after-attempt"));
}

/** The rating before any attempt was graded, which is what "moved" is measured
 *  from. Taken from the first snapshot rather than from a constant so a build
 *  that starts learners somewhere else is still measured against its own start. */
function first(trace: Trace): LedgerSnapshot | null {
  return snapshots(trace)[0]?.snapshot ?? null;
}

/** Whether this build's tool contract refuses an interpretation-free update.
 *  Recorded by the harness as a note, because it is a fact about the build
 *  rather than about the run, and a verifier may not go and ask. */
function contractProbe(trace: Trace): boolean | null {
  const note = eventsOfKind(trace, "note").find((event) => event.text.startsWith("contract "));
  if (!note) return null;
  try {
    return Boolean((JSON.parse(note.text.slice("contract ".length)) as { evidenceRequired?: boolean }).evidenceRequired);
  } catch {
    return null;
  }
}

function markerHits(statement: string, misconception: Misconception): number {
  const text = statement.toLowerCase();
  return misconception.markers.filter((marker) => text.includes(marker)).length;
}

function describe(scenario: Scenario): string {
  const passed = scenario.attempts.filter((attempt) => attempt.outcome === "passed").length;
  const assisted = scenario.attempts.filter((attempt) => attempt.hints > 0).length;
  return `${passed} of ${scenario.attempts.length} solved, ${assisted} with help`;
}

const clip = (value: string) => (value.length > 90 ? `${value.slice(0, 87)}…` : value);
