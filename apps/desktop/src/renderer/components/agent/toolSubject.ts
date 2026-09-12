/**
 * What a tool call was *about*, for the row that names it.
 *
 * Rows used to read "Read a file", "Ran a command", "Used a tool" — a list of
 * verbs with no objects. Five of them in a row say the agent did five things
 * and nothing about what, so the only way to find the one you care about was to
 * open all five.
 *
 * The subject is the answer: `Read main.py`, `Ran python main.py`. It comes out
 * of the call's own arguments, so it is what actually happened rather than a
 * label chosen in advance.
 *
 * Pure, and separate from the row that draws it, because the row reaches Monaco
 * through the detail views and this is the part with rules worth testing.
 */
export type ToolSubject = {
  /** Past tense, or present while the call is still running. */
  verb: string;
  /** What it acted on. A path is shortened to its last segment. */
  subject: string;
  /** The full path, when the subject is one — the row opens it, and the short
   *  name alone is ambiguous in a project with two `index.ts`. */
  path?: string;
};

/** Past tense, and what to say instead while it is still happening. */
const VERBS: Record<string, [done: string, running: string]> = {
  "read-file": ["Read", "Reading"],
  "write-file": ["Wrote", "Writing"],
  "list-files": ["Listed", "Listing"],
  "run-terminal-command": ["Ran", "Running"],
  "web-search": ["Searched for", "Searching for"],
  "web-fetch": ["Fetched", "Fetching"],
  "flow-memory-fetch": ["Recalled", "Recalling"],
  /* Not "Remembered". Memory is a thing that already exists and gets revised —
     the row is reporting a write to it, and the learner should be able to read
     the word "memory" and know that is what changed. */
  "flow-memory-patch": ["Updated memory", "Updating memory"],
};

/** What each memory file is *about*, in the learner's words.
 *
 *  The rows used to name the file — "Remembered learner.md" — which leaks an
 *  implementation detail and, worse, is the same four words every time whatever
 *  changed. Nobody has a mental model of `path.md`; everybody has one of "the
 *  plan". The file names stay the agent's business. */
const MEMORY_TOPIC: Record<string, string> = {
  "learner.md": "you",
  "project.md": "this project",
  "path.md": "the plan",
  "research.md": "the background",
};

/** One memory note, titled. What the detail view heads a section with, for the
 *  same reason the row does not name the file: `path.md` is a file on disk, and
 *  "The plan" is the thing the learner has. */
export function memoryLabel(file: string): string {
  const topic = MEMORY_TOPIC[baseName(file)];
  if (!topic) return "";
  return topic === "you" ? "About you" : topic.charAt(0).toUpperCase() + topic.slice(1);
}

/** The topics behind a list of memory files, in the order the map declares them
 *  so that two calls touching the same pair read the same way, and phrased as
 *  one clause. Three or more is everything Construct keeps, and reads better as
 *  that than as a list of all of it. */
function memoryTopics(files: readonly string[]): string {
  const named = Object.keys(MEMORY_TOPIC).filter((file) => files.includes(file));
  if (named.length === 0 || named.length > 2) return "";
  return named.map((file) => MEMORY_TOPIC[file]).join(" and ");
}

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/** The last segment of a path. What the reference shows, and what anybody
 *  actually reads — the directories are context the row has no width for. */
export function baseName(path: string): string {
  const cleaned = path.replace(/\/+$/, "");
  return cleaned.slice(cleaned.lastIndexOf("/") + 1) || cleaned;
}

/** Collapsed to one line and shortened, so a row stays a row. A command with a
 *  newline in it would otherwise break the transcript's rhythm. */
function oneLine(value: string, limit = 60): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}

export function toolSubject(tool: string, input: string, running = false): ToolSubject | null {
  const verbs = VERBS[tool];
  if (!verbs) return null;
  const verb = running ? verbs[1] : verbs[0];

  let args: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(input);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    args = parsed as Record<string, unknown>;
  } catch {
    /* Turns written before tool arguments were stored have nothing to read, and
       a truncated payload is ordinary. The row keeps its old label. */
    return null;
  }

  switch (tool) {
    case "read-file":
    case "write-file": {
      const path = text(args.path);
      return path ? { verb, subject: baseName(path), path } : null;
    }
    case "list-files": {
      const directory = text(args.directory);
      /* An empty directory is the project root, which is worth naming as such
         rather than leaving the verb bare. */
      return { verb, subject: directory ? baseName(directory) : "the project", ...(directory ? { path: directory } : {}) };
    }
    case "run-terminal-command": {
      const command = text(args.command);
      return command ? { verb, subject: oneLine(command) } : null;
    }
    case "web-search": {
      const query = text(args.query);
      return query ? { verb, subject: oneLine(query, 48) } : null;
    }
    case "web-fetch": {
      const url = text(args.url);
      if (!url) return null;
      try {
        return { verb, subject: new URL(url).host.replace(/^www\./, "") };
      } catch {
        return { verb, subject: oneLine(url, 48) };
      }
    }
    case "flow-memory-fetch": {
      const files = Array.isArray(args.files) ? args.files.map(String).filter(Boolean) : [];
      const topics = memoryTopics(files);
      /* All four is the default and reads as "everything", which is what it is. */
      return { verb, subject: topics ? `what it knows about ${topics}` : "what it knows" };
    }
    case "flow-memory-patch": {
      const patches = Array.isArray(args.patches) ? (args.patches as Array<Record<string, unknown>>) : [];
      const files = [...new Set(patches.map((patch) => text(patch.file)).filter(Boolean))];
      if (files.length === 0) return null;
      const topics = memoryTopics(files);
      return { verb, subject: topics ? `about ${topics}` : "about everything it knows" };
    }
    default:
      return null;
  }
}
