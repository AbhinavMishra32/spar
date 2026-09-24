import { parseStreamingJson } from "@earendil-works/pi-ai";
import type { ToolStage } from "../shared/api.js";

type Extra = { [K in "detail" | "findings" | "badge" | "model" | "provider" | "subject" | "verb" | "runs" | "writing"]?: ToolStage[K] | undefined };

export type StageHandle = {
  update(patch: Extra): void;
  end(state: Exclude<ToolStage["state"], "running">, patch?: Extra): void;
};

export type StageLog = {
  readonly all: ToolStage[];
  begin(kind: ToolStage["kind"], verb: string, subject: string, extra?: Extra): StageHandle;
  /** A stage that is over the moment it is reported. */
  note(kind: ToolStage["kind"], state: Exclude<ToolStage["state"], "running">, verb: string, subject: string, extra?: Extra): void;
};

/**
 * The stages of one challenge-authoring call, in the order they ran.
 *
 * Every change is sent as a whole copy of the stage, so the renderer upserts by
 * id and never has to merge a partial. The list itself goes out once more on the
 * call's end event, which is what the stored turn keeps.
 */
export function stageLog(emit: (stage: ToolStage) => void): StageLog {
  const all: ToolStage[] = [];
  let next = 0;
  const send = (stage: ToolStage) => emit({ ...stage, ...(stage.findings ? { findings: [...stage.findings] } : {}), ...(stage.runs ? { runs: stage.runs.map((run) => ({ ...run })) } : {}) });
  const begin: StageLog["begin"] = (kind, verb, subject, extra = {}) => {
    const stage: ToolStage = { id: `stage-${next++}`, kind, verb, subject, state: "running", startedAt: Date.now(), ...clean(extra) };
    all.push(stage);
    send(stage);
    let settled = false;
    return {
      update(patch) {
        if (settled) return;
        Object.assign(stage, clean(patch));
        send(stage);
      },
      end(state, patch = {}) {
        if (settled) return;
        settled = true;
        delete stage.writing;
        Object.assign(stage, clean(patch), { state, endedAt: Date.now() });
        send(stage);
      },
    };
  };
  return {
    all,
    begin,
    note(kind, state, verb, subject, extra) {
      begin(kind, verb, subject, extra).end(state);
    },
  };
}

/**
 * A private model's answer, drawn while it is being written.
 *
 * The reviewer answers `{"verdict","reason"}` and the reason is shown as it
 * streams. A repair answers a JSON patch: the fields it touches are named as
 * they appear, and a starter file or visible test it rewrites is shown line by
 * line — the reference and hidden tests are only ever named, since this is the
 * worker and the renderer must never receive them.
 */
export function streamInto(stage: StageHandle | undefined, shape: "verdict" | "patch"): ((delta: string) => void) | undefined {
  if (!stage) return undefined;
  let text = "";
  let at = 0;
  return (delta) => {
    text += delta;
    const now = Date.now();
    if (now - at < 90) return;
    at = now;
    const start = text.indexOf("{");
    if (start < 0) return;
    let value: Record<string, unknown>;
    try {
      const parsed = parseStreamingJson<Record<string, unknown>>(text.slice(start));
      if (!parsed || typeof parsed !== "object") return;
      value = parsed;
    } catch {
      return;
    }
    if (shape === "verdict") {
      const reason = typeof value.reason === "string" ? value.reason : "";
      if (reason) stage.update({ detail: reason });
      return;
    }
    const writing = shownFile(value);
    stage.update({ detail: describeChanges(value).replace(/^Changed/, "Changing"), ...(writing ? { writing } : {}) });
  };
}

/** The last learner-visible file a patch has started writing. */
function shownFile(patch: Record<string, unknown>): { path: string; content: string } | undefined {
  let found: { path: string; content: string } | undefined;
  for (const field of ["starterFiles", "visibleTests"]) {
    const map = patch[field];
    if (!map || typeof map !== "object" || Array.isArray(map)) continue;
    for (const [path, content] of Object.entries(map as Record<string, unknown>)) {
      if (typeof content === "string" && content) found = { path, content: content.length > 6_000 ? `${content.slice(0, 6_000)}\n…` : content };
    }
  }
  return found;
}

function clean(extra: Extra): Partial<ToolStage> {
  return Object.fromEntries(Object.entries(extra).filter(([, value]) => value !== undefined && value !== "")) as Partial<ToolStage>;
}

/** The fields a patch touched, in the learner's terms: `statement`, and each
 *  file by its path rather than by the map it lives in. */
export function describeChanges(changes: Record<string, unknown> | null | undefined): string {
  if (!changes) return "";
  const named: string[] = [];
  for (const [key, value] of Object.entries(changes)) {
    if (["starterFiles", "referenceFiles", "visibleTests", "hiddenTests"].includes(key) && value && typeof value === "object") {
      for (const [path, content] of Object.entries(value as Record<string, unknown>)) named.push(content === null ? `removed ${path}` : path);
    } else if (key === "knownIncorrectFiles") named.push("known-incorrect solution");
    else if (key !== "actionTitle") named.push(FIELD_WORDS[key] ?? key);
  }
  if (!named.length) return "";
  return named.length > 4 ? `Changed ${named.slice(0, 4).join(", ")} and ${named.length - 4} more` : `Changed ${named.join(", ")}`;
}

const FIELD_WORDS: Record<string, string> = {
  statement: "statement",
  title: "title",
  trainingTarget: "training target",
  why: "rationale",
  solutionRequirements: "requirements",
  expectedFailureSignatures: "failure signatures",
  accidentalDifficulty: "accidental difficulty",
};

/** `4/6 checks`, from a compile report. */
export function checkBadge(value: unknown): string {
  const report = value && typeof value === "object" ? (value as { report?: { checks?: unknown } }).report : undefined;
  const checks = Array.isArray(report?.checks) ? report.checks as Array<{ passed?: unknown }> : [];
  if (!checks.length) return "";
  return `${checks.filter((check) => check?.passed !== false).length}/${checks.length} checks`;
}
