/** Electron wraps anything an IPC handler throws as
 *  `Error invoking remote method 'x': <thrown>`, and a Zod failure stringifies
 *  as its raw issue array — so a goal one character too short reached the
 *  learner as a JSON dump. Both wrappers are peeled off here, at the one place
 *  every screen turns a bridge rejection into text it shows. */
const REMOTE_PREFIX = /^Error invoking remote method '[^']*':\s*/;

export function message(error: unknown): string {
  const raw = (error instanceof Error ? error.message : String(error)).replace(REMOTE_PREFIX, "");
  return validationMessages(raw) ?? raw;
}

/** The `message` of every Zod issue, joined — or null when this was never one,
 *  so an ordinary error is never mangled by trying to read it as one. */
function validationMessages(raw: string): string | null {
  if (!raw.startsWith("[")) return null;
  try {
    const issues = JSON.parse(raw) as unknown;
    if (!Array.isArray(issues) || !issues.length) return null;
    const sentences = issues.flatMap((issue) =>
      issue && typeof issue === "object" && typeof (issue as { message?: unknown }).message === "string"
        ? [(issue as { message: string }).message]
        : []);
    return sentences.length === issues.length ? sentences.join(" ") : null;
  } catch {
    return null;
  }
}

export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m`;
  return `${seconds}s`;
}

export function relativeTime(value: string): string {
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(value).toLocaleDateString([], { month: "short", day: "numeric" });
}

/**
 * {@link relativeTime} with the words removed: "now", "12m", "3h", "4d", "Mar 4".
 *
 * A metadata column only reads as a column if every value fits it, and "just now"
 * is three times the width of "3h ago". Six characters is the ceiling here, so the
 * timestamps line up on their right edge instead of fraying.
 */
export function shortTime(value: string): string {
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(value).toLocaleDateString([], { month: "short", day: "numeric" });
}

export function clockTime(date = new Date()): string {
  return date.toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function languageFor(path: string): string {
  if (path.endsWith(".ts")) return "typescript";
  if (path.endsWith(".tsx")) return "typescript";
  if (path.endsWith(".js") || path.endsWith(".mjs")) return "javascript";
  if (path.endsWith(".cpp") || path.endsWith(".cc") || path.endsWith(".h")) return "cpp";
  if (path.endsWith(".json")) return "json";
  if (path.endsWith(".md")) return "markdown";
  return "plaintext";
}

export function fileName(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}

export function initials(value: string): string {
  const parts = value.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part.charAt(0).toUpperCase()).join("") || "?";
}
