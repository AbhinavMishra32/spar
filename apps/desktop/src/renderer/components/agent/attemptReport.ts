import { closeOff } from "./ToolPayload";

/**
 * The replay, read back out of the call that fetched it.
 *
 * `read_attempt` is the one call a turn makes about the learner's own work, and
 * the only thing it ever showed them was its payload: a single 16k line of
 * escaped JSON with their solve log inside it. Everything in that payload is
 * already structured — it was printed from a fold of their events by
 * `formatSolveLog`, in a fixed layout, by this repo — so it is read back into
 * the shapes it was printed from and drawn.
 *
 * The report rather than the `events` array is the source, for two reasons.
 * The report is what the agent actually read, so a panel built from it cannot
 * show the learner more or less than the tutor saw. And the events are the part
 * of the payload that gets cut: they are the bulk of it, and a 16k cap lands
 * inside them on any attempt worth reading.
 *
 * Nothing here interprets. A line that does not match its section's layout is
 * dropped rather than guessed at, and a payload with no report in it at all
 * comes back null so the caller can fall back to the raw view — a drawn panel
 * of nothing claims the attempt was empty, which is a different and false
 * thing to say.
 */

export type CaseMark = "passed" | "failed" | "skipped" | "absent";

/** One case, followed across every run: the strip of marks, and the sentence
 *  the report wrote under it. */
export type ReadCase = {
  name: string;
  hidden: boolean;
  marks: CaseMark[];
  passes: number;
  failures: number;
  /** What became of it — "fixed at 6:12:10pm", "failed again at 6:14:02pm". */
  story: string;
};

export type ReadRun = {
  at: string;
  submission: boolean;
  passed: number | null;
  total: number | null;
  /** What the report printed where a case count was not available. */
  verdict: string;
  fixed: string[];
  broke: string[];
};

export type ReadLogCase = { status: CaseMark; name: string; note: string };

export type ReadLogLine = {
  at: string;
  sequence: number;
  source: string;
  type: string;
  detail: string;
  cases: ReadLogCase[];
};

export type ReadFile = { path: string; text: string };

export type AttemptRead = {
  title: string;
  language: string;
  /** As the report printed it: "today at 6:20pm" (an ISO instant in reports
   *  written before times were local), or "" when it had none. */
  openedAt: string;
  outcome: string;
  totals: { events: number; runs: number; submissions: number; saves: number; cases: number } | null;
  /** The scope sentences the report put in its own header. */
  notes: string[];
  /** What the call asked for, in the words the tool's filters use. */
  asked: string[];
  log: ReadLogLine[];
  /** Log lines the report dropped to stay inside `maxLines`. */
  omitted: number;
  cases: ReadCase[];
  runs: ReadRun[];
  timings: string[];
  files: ReadFile[];
  solve: ReadFile | null;
  /** The payload was cut off, so what is drawn is a prefix of what was read. */
  cut: boolean;
  /** The report said there was nothing recorded; this is that sentence. */
  nothing: string;
};

export function readAttempt(output: string): AttemptRead | null {
  const whole = parse(output) ?? parse(closeOff(output));
  const record = whole && typeof whole === "object" && !Array.isArray(whole) ? whole as Record<string, unknown> : {};
  /* The report is a string, and a string is exactly what `closeOff` cannot
     recover: it closes brackets, and a payload cut mid-report never finished a
     value for it to close back to. So the string is carved out by hand. */
  const report = typeof record.report === "string" ? record.report : carveString(output, "report");
  if (report === null) return null;

  const cut = output.includes("… truncated (") || typeof record.report !== "string";
  const read = fromReport(report, cut);
  read.files = files(record.files);
  read.solve = file(record.solve);
  read.asked = asked(record.filters);
  return read;
}

/* ---- The report, line by line ------------------------------------------- */

const SECTIONS = [
  { head: /^LOG \(/, name: "log" },
  { head: /^CASE HISTORY/, name: "cases" },
  { head: /^RUN DELTAS/, name: "runs" },
  { head: /^CODE CHANGES/, name: "code" },
  { head: /^TURNING POINTS/, name: "turning" },
  { head: /^TIMINGS$/, name: "timings" },
] as const;

type Section = (typeof SECTIONS)[number]["name"] | "head";

/* A moment is a local clock time, "6:20:14pm"; reports read back out of older
   turns still carry the "+29:12" offsets they were written with. */
const AT = String.raw`(\+[\d:]+|\d{1,2}:\d{2}(?::\d{2})?[ap]m)`;
const LOG_LINE = new RegExp(String.raw`^ {2}${AT}\s+#(\d+)\s+(\S+)\s+(\S+)\s?(.*)$`);
const LOG_CASE = /^\s{8,}(PASS|FAIL|SKIPPED|TODO)\s+(.*)$/;
const CASE_ROW = /^ {2}"(.+)"\s+([PFS\- ]*?)\s*((?:hidden|visible),.*)$/;
const RUN_ROW = new RegExp(String.raw`^ {2}${AT}\s+(submission|visible)\s+(\S+)(?:\s{2,}(.*))?$`);
const OMITTED = /^ {2}\((\d+) earlier lines? omitted/;

function fromReport(report: string, cut: boolean): AttemptRead {
  const read: AttemptRead = {
    title: "", language: "", openedAt: "", outcome: "", totals: null, notes: [], asked: [],
    log: [], omitted: 0, cases: [], runs: [], timings: [], files: [], solve: null, cut, nothing: "",
  };
  /* A cut payload ends mid-line, and half a log entry drawn as a whole one is
     the one kind of wrong this can be. */
  const lines = report.split("\n");
  if (cut && lines.length > 1) lines.pop();

  if (!/^SOLVE LOG/.test(lines[0] ?? "")) {
    /* The read found no events. That report is one sentence, and it is the
       honest thing to show. */
    read.nothing = (lines[0] ?? "").trim();
    return read;
  }

  let section: Section = "head";
  let entry: ReadLogLine | null = null;

  for (const line of lines) {
    const started = SECTIONS.find((candidate) => candidate.head.test(line));
    if (started) {
      section = started.name;
      entry = null;
      continue;
    }
    if (!line.trim()) continue;

    if (section === "head") {
      head(read, line);
      continue;
    }

    if (section === "log") {
      const nested = entry && LOG_CASE.exec(line);
      if (nested && entry) {
        entry.cases.push(logCase(nested[1]!, nested[2]!));
        continue;
      }
      const omitted = OMITTED.exec(line);
      if (omitted) {
        read.omitted = Number(omitted[1]);
        continue;
      }
      const matched = LOG_LINE.exec(line);
      if (!matched) continue;
      entry = { at: matched[1]!, sequence: Number(matched[2]), source: matched[3]!, type: matched[4]!, detail: matched[5]!.trim(), cases: [] };
      read.log.push(entry);
      continue;
    }

    if (section === "cases") {
      const matched = CASE_ROW.exec(line);
      if (matched) read.cases.push(caseRow(matched[1]!, matched[2]!, matched[3]!));
      continue;
    }

    if (section === "runs") {
      const matched = RUN_ROW.exec(line);
      if (matched) read.runs.push(runRow(matched[1]!, matched[2]!, matched[3]!, matched[4] ?? ""));
      continue;
    }

    // The code diffs are the agent's reading; the panel shows the files.
    if (section === "code" || section === "turning") continue;

    read.timings.push(line.trim());
  }

  return read;
}

/** The three or four lines the report opens with, before any section. */
function head(read: AttemptRead, line: string) {
  const titled = /^SOLVE LOG — (.*) \(([^()]*)\)$/.exec(line);
  if (titled) {
    read.title = titled[1]!;
    read.language = titled[2]!;
    return;
  }
  if (line.startsWith("opened ")) {
    const parts = line.split(" · ");
    const opened = parts[0]!.slice("opened ".length).trim();
    read.openedAt = /\(([^()]+)\)$/.exec(opened)?.[1] ?? opened;
    read.outcome = (parts.slice(1).find((part) => !part.trim().startsWith("it is now")) ?? "").trim();
    const count = (word: string) => {
      const found = parts.find((part) => part.trim().endsWith(word));
      return found ? Number.parseInt(found.trim(), 10) || 0 : 0;
    };
    read.totals = {
      events: count("events"),
      runs: count("runs"),
      submissions: count("submissions"),
      saves: count("saves"),
      cases: count("distinct test cases"),
    };
    return;
  }
  /* The sentence about offsets is the report telling the model how to read
     itself; the panel is that explanation. Everything else in the header is a
     scope the learner should see. */
  if (line.startsWith("Offsets are") || line.startsWith("Times are") || line.startsWith("When you mention")) return;
  read.notes.push(line.trim());
}

/** `FAIL  "sum of two" expected 5, got 4`, as its three parts. */
function logCase(mark: string, rest: string): ReadLogCase {
  const at = rest.search(/ {2}(expected|error) /);
  const name = at < 0 ? rest.trim() : rest.slice(0, at).trim();
  return { status: MARKS[mark] ?? "failed", name, note: at < 0 ? "" : rest.slice(at).trim() };
}

const MARKS: Record<string, CaseMark> = { PASS: "passed", FAIL: "failed", SKIPPED: "skipped", TODO: "skipped", P: "passed", F: "failed", S: "skipped", "-": "absent" };

function caseRow(name: string, strip: string, facts: string): ReadCase {
  const parts = facts.split(", ");
  const number = (word: string) => {
    const found = parts.find((part) => part.includes(word));
    return found ? Number.parseInt(found, 10) || 0 : 0;
  };
  /* Everything after the visible/hidden flag and the two counts is what became
     of the case, which the report already wrote as a phrase. */
  const story = parts.slice(3).join(", ");
  return {
    name,
    hidden: facts.startsWith("hidden"),
    marks: strip.split(" ").filter(Boolean).map((mark) => MARKS[mark] ?? "absent"),
    passes: number("pass"),
    failures: number("failure"),
    story,
  };
}

function runRow(at: string, kind: string, score: string, extras: string): ReadRun {
  const split = /^(\d+)\/(\d+)$/.exec(score);
  return {
    at,
    submission: kind === "submission",
    passed: split ? Number(split[1]) : null,
    total: split ? Number(split[2]) : null,
    verdict: split ? "" : score,
    fixed: names(extras, "newly passing:"),
    broke: names(extras, "newly failing:"),
  };
}

function names(extras: string, label: string): string[] {
  const at = extras.indexOf(label);
  if (at < 0) return [];
  const rest = extras.slice(at + label.length);
  const end = rest.search(/\s{2,}newly /);
  return [...(end < 0 ? rest : rest.slice(0, end)).matchAll(/"([^"]*)"/g)].map((match) => match[1]!);
}

/* ---- The rest of the payload -------------------------------------------- */

const FILTER_WORDS: Record<string, string> = {
  log: "full log",
  cases: "case history",
  runs: "run deltas",
  "turning-points": "turning points",
  timings: "timings",
};

/** What the call asked the replay for, as the learner would say it. */
function asked(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const filters = value as Record<string, unknown>;
  const sections = Array.isArray(filters.sections) ? filters.sections.filter((entry): entry is string => typeof entry === "string") : [];
  const words = sections.map((section) => FILTER_WORDS[section] ?? section);
  if (filters.cases === "still-failing") words.push("still failing");
  else if (filters.cases === "fixed") words.push("what you fixed");
  else if (filters.cases === "failed-ever") words.push("everything that failed");
  if (filters.scope === "since-last-submission") words.push("since your last submission");
  if (Array.isArray(filters.events) && filters.events.length) words.push(filters.events.join(", "));
  return words;
}

function files(value: unknown): ReadFile[] {
  return Array.isArray(value) ? value.map(file).filter((entry): entry is ReadFile => entry !== null) : [];
}

function file(value: unknown): ReadFile | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.text !== "string" || !record.text.trim()) return null;
  return { path: typeof record.path === "string" ? record.path : "", text: record.text };
}

function parse(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

/**
 * One string value, lifted out of a payload whose tail was sawn off.
 *
 * The report is the last and by far the largest field, so the cut lands inside
 * it more often than not — and a JSON string cut in half is unparseable in a
 * way brackets are not. Everything up to the cut is real text, so it is taken:
 * back off any half-written escape, close the quote, and let `JSON.parse` do
 * the unescaping rather than reimplementing it.
 */
function carveString(output: string, key: string): string | null {
  const at = output.indexOf(`"${key}"`);
  if (at < 0) return null;
  const open = output.indexOf('"', output.indexOf(":", at) + 1);
  if (open < 0) return null;

  let end = -1;
  for (let index = open + 1; index < output.length; index += 1) {
    const character = output[index];
    if (character === "\\") {
      index += 1;
      continue;
    }
    if (character === '"') {
      end = index;
      break;
    }
  }
  const body = end < 0 ? trailingEscape(unmarked(output.slice(open + 1))) : output.slice(open + 1, end);
  return parse(`"${escaped(body)}"`) as string | null;
}

/** The worker's own note about the cut, which is not part of the report. */
function unmarked(body: string): string {
  const at = body.indexOf("\n… truncated (");
  return at < 0 ? body : body.slice(0, at);
}

/** A cut string ends wherever the cap fell, including in the middle of the
 *  payload's own layout, so any raw control character is re-escaped before the
 *  value is handed back to `JSON.parse`. */
function escaped(body: string): string {
  // eslint-disable-next-line no-control-regex
  return body.replace(/[\u0000-\u001f]/g, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

/** A cut can land between a backslash and the character it escapes, and between
 *  the `\u` and its four digits. Both are dropped. */
function trailingEscape(body: string): string {
  const shortUnicode = /\\u[0-9a-fA-F]{0,3}$/;
  if (shortUnicode.test(body)) return body.replace(shortUnicode, "");
  let slashes = 0;
  while (body[body.length - 1 - slashes] === "\\") slashes += 1;
  return slashes % 2 === 1 ? body.slice(0, -1) : body;
}
