import { parseStreamingJson } from "@earendil-works/pi-ai";
import type { ChallengeDraft } from "../shared/api.js";

/** Enough of any one shown file to watch it being written; the whole of it is
 *  in the workspace once the challenge lands. */
const MAX_SHOWN = 6_000;
const MAX_STATEMENT = 2_400;

const GROUPS: Array<[key: string, group: ChallengeDraft["files"][number]["group"], shown: boolean]> = [
  ["starterFiles", "starter", true],
  ["visibleTests", "visible", true],
  ["referenceFiles", "reference", false],
  ["hiddenTests", "hidden", false],
];

/**
 * What of a half-written design may be drawn while it streams.
 *
 * This runs in the worker, the only process that sees the unredacted arguments,
 * for the same reason `toolPayload` does: the renderer and the store never hold
 * a reference line or a hidden case, so nothing downstream has to be trusted to
 * leave them out.
 */
export function challengeDraft(key: string, json: string): ChallengeDraft {
  let value: Record<string, unknown> = {};
  try {
    const parsed = parseStreamingJson<Record<string, unknown>>(json);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) value = parsed;
  } catch {
    value = {};
  }
  const files: ChallengeDraft["files"] = [];
  for (const [field, group, shown] of GROUPS) {
    const map = value[field];
    if (!map || typeof map !== "object" || Array.isArray(map)) continue;
    for (const [path, content] of Object.entries(map as Record<string, unknown>)) {
      if (!path) continue;
      const text = typeof content === "string" ? content : "";
      files.push({ group, path, lines: lineCount(text), ...(shown ? { content: text.length > MAX_SHOWN ? `${text.slice(0, MAX_SHOWN)}\n…` : text } : {}) });
    }
  }
  const incorrect = value.knownIncorrectFiles;
  if (Array.isArray(incorrect)) {
    incorrect.forEach((entry, index) => {
      if (!entry || typeof entry !== "object") return;
      const texts = Object.values(entry as Record<string, unknown>).filter((text): text is string => typeof text === "string");
      files.push({ group: "incorrect", path: Object.keys(entry as Record<string, unknown>).join(", ") || `#${index + 1}`, lines: texts.reduce((total, text) => total + lineCount(text), 0) });
    });
  }
  const text = (field: string) => (typeof value[field] === "string" ? (value[field] as string) : "");
  const draft: ChallengeDraft = { key, files, received: json.length };
  if (text("title")) draft.title = text("title");
  if (text("language")) draft.language = text("language");
  const statement = text("statement");
  if (statement) draft.statement = statement.length > MAX_STATEMENT ? `${statement.slice(0, MAX_STATEMENT)}…` : statement;
  return draft;
}

function lineCount(text: string): number {
  if (!text) return 0;
  return text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
}
