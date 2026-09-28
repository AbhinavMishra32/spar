/**
 * Records the landing page's hero film from a real session.
 *
 * The hero is Spar's own renderer, driven by a mocked bridge. Everything that
 * bridge hands back is produced here, by the same code the main process runs:
 * the store answers `bootstrap` and `openSession`, the language stages run the
 * tests for real, and the agent turn is rebuilt as the exact `AgentStreamEvent`
 * sequence the worker emits for it. Nothing in the film is typed by hand except
 * the learner's attempt, which is the challenge's own known-incorrect solution.
 *
 * The source is a real turn from the local store: a submission that fails a
 * hidden case, a learner asking for something simpler, and the agent replacing
 * the challenge — reviewer, two failed validations, repairs, publish. The store
 * is copied with `.backup` (the original is only ever read), rewound to the
 * moment before the attempt, and then played forward on a virtual clock.
 *
 *   pnpm --filter @spar/desktop hero:record
 *
 * Writes `src/hero/recording.json`. Re-run it whenever the renderer's data
 * shapes change; the hero reads nothing else.
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import type { AgentActivityFile, AgentStreamEvent, BootstrapData, SubmissionResult, ToolStage, ToolStageRun } from "../shared/api.js";
import { runEvidence, STOPPED_AT_FAILURE } from "../shared/testReport.js";
import { resolveLanguageStages } from "../workers/languageStages.js";
import { truncateAtFailure } from "../workers/failFast.js";
import { challengeDraft } from "../workers/challengeDraft.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = process.env.SPAR_HERO_DB ?? path.join(os.homedir(), "Library/Application Support/@spar/desktop/spar/state.sqlite3");

/* ---- The session the film is cut from -------------------------------------- */

const SESSION = "27eb77f1-b603-4373-a115-44fbb282315c"; // "teach me trees"
const FIRST_QUESTION = "daf95400-1143-4ded-8a05-2a4348907b3a"; // Count the Root's Children
const SECOND_QUESTION = "1461fbfe-d6c3-4c88-9db9-e7eef6e3aacb"; // Identify a Tree's Root
/** The agent's reply to "simpler question", as persisted. */
const TURN_MESSAGE_AT = "2026-09-23T17:16:46.025Z";
/** When the learner sent it. The turn's own clock is measured from here. */
const REAL_SEND_AT = Date.parse("2026-09-23T17:15:01.608Z");
/** Just after the agent set the first challenge, before any attempt at it. */
const OPEN_AT = "2026-09-23T16:57:42.000Z";
const LEARNER_MESSAGE = "simpler question";

/** The rest of the sidebar. Real sessions, chosen so the list reads as a
 *  learner's history rather than as a test database. */
const KEEP_SESSIONS = [
  SESSION,
  "a0ee4927-e69f-426c-8e50-d1b8ccc6c3fb", // teach me monotonic stack (first principles)
  "dcc67a60-ac52-4d1b-97ba-b3cfe81f59f4", // learn trees in context of minecraft and graphics programming
  "c5711dd9-590e-45cd-924b-b6136cf44fc8", // count islands (dfs)
  "729d3de4-5935-4509-9fdc-5058790b340b", // sliding window for interviews
  "b0959220-40cd-47ba-b7ef-b7923c427177", // quant in python
  "03956507-aa10-4da6-9bfa-e3e9cbd3c289", // learn typescript
  "3688ff2b-39ad-458d-bc25-7373738d91fb", // learn nextjs
];

/* ---- The film's clock ------------------------------------------------------ */

/**
 * Virtual time, in milliseconds after `OPEN_AT`. These are the beats the
 * director in the page keys off — the page never invents a timestamp, it only
 * waits for the ones written here.
 */
const BEAT = {
  typeStart: 2_400,
  typeEnd: 13_000,
  run: 14_600,
  runSettles: 15_600,
  submit: 19_200,
  submitSettles: 21_000,
  composeStart: 24_600,
  send: 27_400,
};

const OPEN_EPOCH = Date.parse(OPEN_AT);
const at = (offset: number) => OPEN_EPOCH + offset;
/** The agent turn, moved so it starts when the film's learner presses send. */
const SHIFT = at(BEAT.send) - REAL_SEND_AT;

/* The store stamps rows with `new Date()`; pin that to the film's clock so every
   row it writes carries the time the film says it happened. */
let virtualNow = OPEN_EPOCH;
const RealDate = Date;
class FilmDate extends RealDate {
  constructor(...args: unknown[]) {
    if (args.length === 0) super(virtualNow);
    else super(...(args as [string | number]));
  }
  static now() { return virtualNow; }
}
globalThis.Date = FilmDate as DateConstructor;
const setClock = (epoch: number) => { virtualNow = epoch; };

/* ---- A private copy of the store, rewound ---------------------------------- */

const scratch = mkdtempSync(path.join(os.tmpdir(), "spar-hero-"));
const copy = path.join(scratch, "state.sqlite3");
const backup = spawnSync("sqlite3", [SOURCE, `.backup '${copy}'`], { encoding: "utf8" });
if (backup.status !== 0) throw new Error(`Could not snapshot ${SOURCE}: ${backup.stderr}`);

const original = new Database(SOURCE, { readonly: true, fileMustExist: true });
rewind(copy);

const { LocalStore } = await import("../main/store.js");
const store = new LocalStore(copy);

function rewind(file: string) {
  const db = new Database(file);
  db.pragma("foreign_keys = ON");
  const keep = KEEP_SESSIONS.map((id) => `'${id}'`).join(",");
  db.transaction(() => {
    const attemptsOf = `SELECT id FROM attempts WHERE session_id NOT IN (${keep})`;
    db.prepare(`DELETE FROM attempt_events WHERE attempt_id IN (${attemptsOf})`).run();
    db.prepare(`DELETE FROM sessions WHERE id NOT IN (${keep})`).run();
    /* Everything this session did after the first challenge was set. */
    const later = `SELECT a.id FROM attempts a JOIN questions q ON q.id=a.question_id WHERE q.session_id=? AND q.created_at>?`;
    db.prepare(`DELETE FROM attempt_events WHERE attempt_id IN (${later})`).run(SESSION, OPEN_AT);
    db.prepare("DELETE FROM attempt_events WHERE attempt_id IN (SELECT id FROM attempts WHERE session_id=?) AND occurred_at>?").run(SESSION, OPEN_AT);
    db.prepare("DELETE FROM questions WHERE session_id=? AND created_at>?").run(SESSION, OPEN_AT);
    db.prepare("DELETE FROM agent_messages WHERE session_id=? AND created_at>?").run(SESSION, OPEN_AT);
    for (const table of ["training_targets", "session_decisions", "agent_visualizations"]) {
      if (hasColumn(db, table, "created_at")) db.prepare(`DELETE FROM ${table} WHERE session_id=? AND created_at>?`).run(SESSION, OPEN_AT);
    }
    const attempt = db.prepare("SELECT id FROM attempts WHERE question_id=?").get(FIRST_QUESTION) as { id: string };
    const last = db.prepare("SELECT MAX(sequence) value FROM attempt_events WHERE attempt_id=?").get(attempt.id) as { value: number };
    db.prepare("UPDATE attempts SET status='active', completed_at=NULL, latest_event_sequence=? WHERE id=?").run(last.value, attempt.id);
    db.prepare("UPDATE questions SET status='active' WHERE id=?").run(FIRST_QUESTION);
    db.prepare("UPDATE sessions SET status='active', updated_at=? WHERE id=?").run(OPEN_AT, SESSION);
    db.prepare("UPDATE settings SET value=? WHERE key='active-track-id'").run(JSON.stringify(sessionTrack(db)));
  })();
  db.close();
}

function hasColumn(db: Database.Database, table: string, column: string) {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some((entry) => entry.name === column);
}

function sessionTrack(db: Database.Database) {
  return (db.prepare("SELECT track_id FROM sessions WHERE id=?").get(SESSION) as { track_id: string }).track_id;
}

/* ---- What the bridge answers ------------------------------------------------ */

type Snapshot = { bootstrap: BootstrapData; detail: NonNullable<ReturnType<typeof store.readSession>> };

function snapshot(): Snapshot {
  store.decayAbilities();
  const profile = store.getProfile();
  const sessions = store.listSessions();
  const bootstrap = {
    /* The account is the one thing not read from the store: it lives in the
       keychain, and the film has no business carrying anyone's email. */
    account: { id: "hero", displayName: profile?.name ?? "Abhinav", email: "" },
    profile,
    sessions,
    challenges: store.listChallenges(),
    saved: store.listSavedProblems(),
    abilities: store.listAbilities(),
    concepts: store.listConcepts(),
    /* Only the Tracks the kept sessions sit in; an empty Track is someone else's plan. */
    tracks: store.listTracks().filter((track) => sessions.some((session) => session.trackId === track.id)),
    activeTrack: store.activeTrack(),
    recommendation: store.todayRecommendation(),
    progress: store.learnerProgress(),
    /* Read only by the Tracks page, which the film never opens. */
    trackProgress: {},
    baseline: store.getBaseline(),
    trainingMode: store.getTrainingMode(),
    theme: "dark",
    syncState: "synced",
    restore: "done",
    serverConfigured: true,
  } as unknown as BootstrapData;
  const detail = store.readSession(SESSION);
  if (!detail) throw new Error("The film's session is missing from the copy");
  return { bootstrap, detail };
}

/* ---- Running the tests, for real ------------------------------------------- */

/** The runner's `safeEnvironment`, for the one language the film runs. */
const RUNNER_ENV = { PATH: "/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin", PYTHONPATH: ".", PYTHONUNBUFFERED: "1", LANG: "en_US.UTF-8", TMPDIR: process.env.TMPDIR ?? "/tmp" };

type Chunk = { at: number; stream: "stdout" | "stderr" | "exit"; data: string; exitCode?: number };

async function runSuite(files: Record<string, string>, failFast: boolean) {
  const root = mkdtempSync(path.join(scratch, "run-"));
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), content);
  }
  const resolved = resolveLanguageStages(root, "python", "test");
  if ("error" in resolved) throw new Error(resolved.error);
  const started = RealDate.now();
  let stdout = "";
  let stderr = "";
  const chunks: Chunk[] = [];
  let exitCode = 0;
  for (const stage of resolved.stages) {
    exitCode = await new Promise<number>((resolve) => {
      const child = spawn(stage.bin, stage.args, { cwd: root, env: RUNNER_ENV, stdio: ["ignore", "pipe", "pipe"] });
      child.stdout.on("data", (chunk: Buffer) => { stdout += chunk; chunks.push({ at: RealDate.now() - started, stream: "stdout", data: chunk.toString() }); });
      child.stderr.on("data", (chunk: Buffer) => { stderr += chunk; chunks.push({ at: RealDate.now() - started, stream: "stderr", data: chunk.toString() }); });
      child.once("close", (code) => resolve(code ?? 1));
    });
    if (exitCode !== 0) break;
  }
  /* The runner's fail-fast cut, applied the way it applies it on a submission. */
  const cut = failFast ? truncateAtFailure(stdout) : null;
  if (cut !== null) {
    stdout = cut;
    if (!stderr.includes(STOPPED_AT_FAILURE)) stderr += `\n${STOPPED_AT_FAILURE}\n`;
  }
  const durationMs = RealDate.now() - started;
  rmSync(root, { recursive: true, force: true });
  const output = `${stdout}${stderr ? `${stdout.endsWith("\n") || !stdout ? "" : "\n"}${stderr}` : ""}`;
  chunks.push({ at: durationMs, stream: "exit", data: `code:${exitCode}`, exitCode });
  return { exitCode, stdout, stderr, output, durationMs, chunks };
}

/* ---- The film --------------------------------------------------------------- */

const firstRecord = store.challengeRecord(FIRST_QUESTION);
if (!firstRecord) throw new Error("The first challenge's design is missing");
const firstDesign = firstRecord.design;
const solutionPath = Object.keys(firstDesign.starterFiles)[0]!;
/* The learner's attempt is the challenge's own plausible-wrong solution: it
   passes every visible case and forgets that a `None` root has no children. */
const attemptCode = Object.values(firstDesign.knownIncorrectFiles[0]!)[0]!;

const opening = snapshot();
const attemptId = opening.detail.question!.attemptId;
const append = (type: string, payload: Record<string, unknown>, source: "learner" | "runner" | "system") =>
  store.appendNextEvent({ id: crypto.randomUUID(), attemptId, type: type as never, occurredAt: new Date().toISOString(), payload, source, schemaVersion: 1 });

const learnerFiles = { ...firstDesign.starterFiles, [solutionPath]: attemptCode };

// Run: the visible suite, which the attempt passes.
setClock(at(BEAT.run));
append("file_changed", { path: solutionPath, bytes: attemptCode.length }, "learner");
append("command_executed", { command: "test", language: "python" }, "learner");
const visible = await runSuite({ ...learnerFiles, ...firstDesign.visibleTests }, false);
setClock(at(BEAT.runSettles));
append("test_run", { scope: "visible", exitCode: visible.exitCode, passed: visible.exitCode === 0, ...runEvidence(visible.output) }, "runner");
const afterRun = snapshot();

// Submit: visible and hidden, fail-fast, which the attempt does not survive.
setClock(at(BEAT.submitSettles));
const hidden = await runSuite({ ...learnerFiles, ...firstDesign.visibleTests, ...firstDesign.hiddenTests }, true);
append("submission_created", { questionId: FIRST_QUESTION, code: { path: solutionPath, text: attemptCode, truncated: false } }, "learner");
append("test_run", { scope: "visible-and-hidden", exitCode: hidden.exitCode, passed: hidden.exitCode === 0, durationMs: hidden.durationMs, ...runEvidence(hidden.output) }, "runner");
append("submission_evaluated", { outcome: hidden.exitCode === 0 ? "passed" : "failed", exitCode: hidden.exitCode }, "system");
if (hidden.exitCode === 0) throw new Error("The attempt was meant to fail its hidden cases");
const submission: SubmissionResult = {
  outcome: "failed",
  exitCode: hidden.exitCode,
  durationMs: hidden.durationMs,
  output: hidden.output,
  summary: "Some tests still fail. Keep going and submit again, or give up to move on.",
  requiresComplexity: false,
};
const afterSubmit = snapshot();

// Send: the learner's message lands before the turn starts, as it does in `agentSend`.
setClock(at(BEAT.send));
store.addMessage(SESSION, "learner", LEARNER_MESSAGE);
const afterSend = snapshot();

/* ---- The agent turn, as the worker streamed it ------------------------------ */

type Part = { kind: string; tool: string; label: string; actionTitle: string; detail: string; ok: boolean; input: string; output: string; stages?: ToolStage[] };
const turnRow = original.prepare("SELECT body, activity, worked_ms FROM agent_messages WHERE session_id=? AND created_at=?").get(SESSION, TURN_MESSAGE_AT) as { body: string; activity: string; worked_ms: number };
const parts = JSON.parse(turnRow.activity) as Part[];
const secondRow = original.prepare("SELECT design, validation_report, introduction_reason FROM questions WHERE id=?").get(SECOND_QUESTION) as { design: string; validation_report: string; introduction_reason: string };
const secondDesign = JSON.parse(secondRow.design) as typeof firstDesign & Record<string, unknown>;
const usage = original.prepare("SELECT input_tokens, started_at FROM agent_usage WHERE session_id=? AND started_at BETWEEN ? AND ?").get(SESSION, "2026-09-23T17:15:00Z", "2026-09-23T17:16:47Z") as { input_tokens: number; started_at: string } | undefined;

const runId = "hero-run";
const stream: Array<{ at: number; event: AgentStreamEvent }> = [];
const emit = (time: number, event: Omit<AgentStreamEvent, "runId" | "sessionId">) => stream.push({ at: time, event: { runId, sessionId: SESSION, ...event } as AgentStreamEvent });
const shifted = (real: number) => real + SHIFT;

const runStart = shifted(Date.parse(usage?.started_at ?? "2026-09-23T17:15:01.786Z"));
emit(runStart, { type: "status", detail: "phase-step:0;active:read_concept_graph" });
if (usage) emit(runStart + 900, { type: "status", detail: "context", context: { usedTokens: usage.input_tokens, totalTokens: 272_000 } });

const [conceptRead, replace] = parts as [Part, Part];
const replaceStages = replace.stages ?? [];
const replaceStart = shifted(replaceStages[0]!.startedAt);

/* The first call carries no timing of its own in the store; it sits where the
   turn left room for it, before the model began writing the challenge. */
const conceptCall = "call-concepts";
emit(runStart + 2_600, { type: "tool", tool: conceptRead.tool, phase: "start", callId: conceptCall, label: conceptRead.label, actionTitle: conceptRead.actionTitle, input: conceptRead.input });
emit(runStart + 3_400, { type: "tool", tool: conceptRead.tool, phase: "end", callId: conceptCall, ok: true, label: conceptRead.label, actionTitle: conceptRead.actionTitle, detail: conceptRead.detail, input: conceptRead.input, output: conceptRead.output });

/* The challenge being written. The worker parses the model's streaming tool
   arguments into a redacted draft; the same parser runs here over the design
   the call carried, a slice at a time, so the draft grows the way it did. */
const args = toolArguments(replace.input, secondDesign);
const draftFrom = runStart + 4_600;
const draftUntil = replaceStart - 400;
const slices = 90;
for (let index = 1; index <= slices; index += 1) {
  const cut = Math.round((args.length * index) / slices);
  emit(draftFrom + ((draftUntil - draftFrom) * index) / slices, { type: "draft", draft: challengeDraft("1-0", args.slice(0, cut)) });
}

const replaceCall = "call-replace";
const argsObject = JSON.parse(args) as Record<string, unknown>;
emit(replaceStart, { type: "tool", tool: replace.tool, phase: "start", callId: replaceCall, detail: "Validating the reference and tests", label: replace.label, actionTitle: replace.actionTitle, files: summarizeFiles(argsObject), input: replace.input });

/* Each stage as it started and as it settled. Present tense while running is
   the worker's own wording (`challengeFit`, `validateStaged`, the repair loop). */
const RUNNING_VERB: Record<ToolStage["kind"], (stage: ToolStage, index: number) => string> = {
  draft: () => "Drafted",
  outcome: (stage) => stage.verb,
  review: () => "Reviewer checking",
  revise: () => "Revising",
  validate: () => "Validating",
  redraft: () => "Reconsidering",
  repair: (_stage, index) => (index === 0 ? "Repairing" : `Repairing (attempt ${index + 1})`),
};
let repairRound = 0;
let previousKind = "";
const settledStages: ToolStage[] = [];
for (const stage of replaceStages) {
  const started = shifted(stage.startedAt);
  const ended = shifted(stage.endedAt ?? stage.startedAt);
  const final: ToolStage = { ...stage, startedAt: started, endedAt: ended };
  if (stage.kind === "repair") repairRound = previousKind === "repair" ? repairRound + 1 : 0;
  previousKind = stage.kind;
  const instant = ended - started < 5;
  if (!instant) {
    const { endedAt: _ended, findings: _findings, detail: _detail, badge, runs, ...rest } = final;
    const running: ToolStage = { ...rest, state: "running", verb: RUNNING_VERB[stage.kind](stage, repairRound), ...(stage.kind === "repair" && badge ? { badge } : {}), ...(stage.kind === "review" && badge ? { badge } : {}) };
    emit(started, { type: "tool", tool: replace.tool, phase: "progress", callId: replaceCall, stage: running });
    /* A validation reports every sandbox run as it starts and as it lands. */
    if (stage.kind === "validate" && runs?.length) {
      const span = ended - started;
      const progress: ToolStageRun[] = [];
      runs.forEach((run, index) => {
        const opens = started + (span * index) / runs.length;
        const lands = started + (span * (index + 0.8)) / runs.length;
        progress.push({ id: run.id, label: run.label, expect: run.expect, state: "running" });
        emit(opens, { type: "tool", tool: replace.tool, phase: "progress", callId: replaceCall, stage: { ...running, runs: progress.map((entry) => ({ ...entry })) } });
        progress[index] = { ...run };
        emit(lands, { type: "tool", tool: replace.tool, phase: "progress", callId: replaceCall, stage: { ...running, runs: progress.map((entry) => ({ ...entry })) } });
      });
    }
  }
  emit(ended, { type: "tool", tool: replace.tool, phase: "progress", callId: replaceCall, stage: final });
  settledStages.push(final);
}

const replaceEnd = settledStages.at(-1)!.endedAt! + 120;
emit(replaceEnd, { type: "tool", tool: replace.tool, phase: "end", callId: replaceCall, ok: replace.ok, detail: replace.detail, label: replace.label, actionTitle: replace.actionTitle, stages: settledStages, input: replace.input, output: replace.output, files: summarizeFiles(argsObject) });

/* The reply, in the small deltas a provider sends. */
const replyFrom = replaceEnd + 500;
const replyUntil = shifted(Date.parse(TURN_MESSAGE_AT)) - 200;

/* ---- The state the turn leaves behind --------------------------------------- */

setClock(replaceEnd - 200);
const trainingTarget = argsObject.trainingTarget as { ability: string; specificGap: string; desiredEvidence: string; avoidTesting: string[] };
const target = store.setTrainingTarget(SESSION, trainingTarget);
store.ensureAbility(target.abilityId, target.abilityTitle, store.trackIdForSession(SESSION));
const question = store.replaceQuestion(
  SESSION,
  secondDesign,
  JSON.parse(secondRow.validation_report),
  String(argsObject.reason ?? ""),
  [{ slug: "tree-structure-roles", role: "primary" }],
  undefined,
  secondRow.introduction_reason,
);
/* The reply links the challenge it set; the copy gave that challenge a new id. */
const reply = turnRow.body.replaceAll(SECOND_QUESTION, question.id);
const words = reply.match(/\S+\s*/g) ?? [reply];
const perDelta = 3;
for (let index = 0; index < words.length; index += perDelta) {
  emit(replyFrom + ((replyUntil - replyFrom) * index) / words.length, { type: "text", text: words.slice(index, index + perDelta).join("") });
}
const done = replyUntil + 200;
emit(done, { type: "done" });

setClock(done);
const activity = parts.map((part) => part === replace ? { ...part, stages: settledStages, output: part.output.replaceAll(SECOND_QUESTION, question.id) } : part);
store.addMessage(SESSION, "agent", reply, activity as never, turnRow.worked_ms);
const final = snapshot();

/* ---- Out -------------------------------------------------------------------- */

const recording = {
  version: 1,
  source: { session: SESSION, turn: TURN_MESSAGE_AT, recordedAt: new RealDate().toISOString() },
  clock: { open: OPEN_EPOCH, beats: Object.fromEntries(Object.entries(BEAT).map(([key, value]) => [key, at(value)])), agent: { start: runStart, end: done } },
  learner: { path: solutionPath, code: attemptCode, message: LEARNER_MESSAGE },
  files: {
    before: { ...firstDesign.starterFiles, ...firstDesign.visibleTests },
    after: { ...secondDesign.starterFiles, ...secondDesign.visibleTests },
  },
  run: { chunks: visible.chunks, exitCode: visible.exitCode },
  submission,
  states: deltas({ opening, afterRun, afterSubmit, afterSend, final }),
  stream: stream.sort((left, right) => left.at - right.at),
};

const out = path.join(here, "recording.json");
writeFileSync(out, `${JSON.stringify(recording)}\n`);
store.close();
original.close();
rmSync(scratch, { recursive: true, force: true });
console.log(`Recorded ${stream.length} agent events, ${visible.chunks.length + 1} runner chunks → ${path.relative(process.cwd(), out)}`);
console.log(`  visible run: exit ${visible.exitCode}; submission: exit ${hidden.exitCode}`);
console.log(`  film runs ${Math.round((done - OPEN_EPOCH) / 1000)}s of virtual time`);

/* ---- Helpers ---------------------------------------------------------------- */

/** Every state after the first, as the fields that changed since the one before
 *  it. The snapshots are nearly identical — five copies of the same sidebar —
 *  and the bridge rebuilds them on load (`expandStates`). */
function deltas(states: Record<string, Snapshot>) {
  let previous: Snapshot | null = null;
  const out: Record<string, unknown> = {};
  for (const [name, state] of Object.entries(states)) {
    if (!previous) out[name] = state;
    else {
      const changed = (next: Record<string, unknown>, before: Record<string, unknown>) =>
        Object.fromEntries(Object.entries(next).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(before[key])));
      out[name] = { bootstrap: changed(state.bootstrap as never, previous.bootstrap as never), detail: changed(state.detail as never, previous.detail as never) };
    }
    previous = state;
  }
  return out;
}

/**
 * The call's arguments as the model wrote them. The stored input is the
 * redacted payload the renderer was given; the withheld fields are filled back
 * from the published design so the draft parser sees what the worker saw, and
 * redacts it again on the way out.
 */
function toolArguments(redacted: string, design: Record<string, unknown>) {
  const value = JSON.parse(redacted) as Record<string, unknown>;
  for (const field of ["referenceFiles", "hiddenTests", "knownIncorrectFiles"]) {
    if (typeof value[field] === "string" && design[field] !== undefined) value[field] = design[field];
  }
  return JSON.stringify(value, null, 2);
}

/** The worker's `summarizeToolInput` for a challenge call: every file, counted. */
function summarizeFiles(record: Record<string, unknown>): AgentActivityFile[] {
  const files: AgentActivityFile[] = [];
  for (const [field, group] of [["starterFiles", "starter"], ["referenceFiles", "reference"], ["visibleTests", "visible"], ["hiddenTests", "hidden"]] as const) {
    const entries = record[field];
    if (!entries || typeof entries !== "object") continue;
    for (const [file, content] of Object.entries(entries as Record<string, unknown>)) {
      if (typeof content !== "string") continue;
      files.push({ path: file, added: content ? content.split("\n").length - (content.endsWith("\n") ? 1 : 0) : 0, removed: 0, group });
    }
  }
  return files;
}

