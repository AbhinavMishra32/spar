import { useEffect, useMemo, useState } from "react";
import { Clock3, CornerDownRight, Folder, Search as SearchMark } from "lucide-react";

import { Tabs } from "radix-ui";

import { languageForPath } from "@spar/domain";
import { cn } from "@/lib/utils";
import { FileTab } from "../common/FileTab";
import { LanguageGlyph, languageOf } from "../common/LanguageGlyph";
import { Inline } from "./Markdown";
import { useMarkdownLinks } from "./MarkdownLinks";
import { memoryLabel } from "./toolSubject";
import { closeOff, FadedScroll, RawPayload } from "./ToolPayload";
import { Snippet } from "./Snippet";
import { readAttempt } from "./attemptReport";
import { AttemptReadView } from "./AttemptRead";

/**
 * What a tool call actually did, drawn rather than dumped.
 *
 * Every call used to open into two `<pre>` blocks of JSON labelled Input and
 * Result. That is the shape the data happens to have, not the shape the
 * question has: nobody opens a `read-file` row wanting to see `{"path":
 * "main.py"}` — they want the file. Reading JSON to find out what happened is
 * work the interface is supposed to have already done.
 *
 * So each tool gets a view built for the one thing it does, and anything
 * unrecognised still falls back to the raw payload — a new tool is plain, never
 * broken.
 *
 * The house style throughout: a muted eyebrow naming the field, the value in
 * the app's own type, hairlines rather than boxes, and code in the same theme
 * the editor paints with. Nothing here draws a border it can express with a
 * rule.
 */
export function ToolDetail({
  input,
  output,
  tool,
}: {
  input: string;
  output: string;
  tool: string;
}) {
  /* Arguments are always an object; a result can be an object, an array, or a
     bare string, so the two are read with different expectations. */
  const args = useObject(input);
  const result = useJson(output);
  /* The replay is read back into the shapes its report was printed from, which
     is the one payload in the app that survives the 16k cap badly enough to need
     its own reader. Only for the calls that carry one — every other tool would
     be paying for a parse of a report it never returns. */
  const replay = useMemo(() => (ATTEMPT_TOOLS.has(tool) ? readAttempt(output) : null), [tool, output]);

  switch (tool) {
    case "read-file": {
      const path = text(args?.path);
      if (!path) break;
      return <FileView body={output} path={path} />;
    }

    case "write-file": {
      const path = text(args?.path);
      if (!path) break;
      return <FileView body={text(args?.content)} path={path} wrote />;
    }

    case "list-files":
      return Array.isArray(result) ? <Listing entries={result as Entry[]} where={text(args?.directory)} /> : null;

    case "run-terminal-command": {
      /* Turns written before tool arguments were stored have no command to
         show, and a lone `$` with nothing after it is worse than the raw
         payload. */
      const command = text(args?.command);
      if (!command) break;
      return (
        <Command
          command={command}
          exitCode={typeof record(result).exitCode === "number" ? Number(record(result).exitCode) : null}
          output={text(record(result).output) || output}
        />
      );
    }

    case "web-search": {
      const query = text(args?.query);
      if (!query) break;
      return <WebSearch query={query} result={result} />;
    }

    case "web-fetch": {
      /* The tool takes `urls`, plural, and always has. Reading `url` off it
         found nothing, so every page the agent read fell through to the raw
         payload — the one row in the transcript that showed the learner a wall
         of JSON. The old spelling is still read, for turns stored before this. */
      const urls = Array.isArray(args?.urls) ? (args.urls as unknown[]).map(text).filter(Boolean) : [text(args?.url)].filter(Boolean);
      if (urls.length === 0) break;
      return <WebPages result={result} urls={urls} />;
    }

    /* Both spellings: the transcript carries v0.7's underscored names as well as
       Construct's own. */
    case "ask_user_question":
    case "ask-user-question": {
      const question = text(args?.question);
      if (!question) break;
      return (
        <Exchange
          answer={answerText(output)}
          choices={Array.isArray(args?.choices) ? (args.choices as unknown[]).map(text).filter(Boolean) : []}
          question={question}
        />
      );
    }

    /* The visualiser, which is the one part of this agent the learner watches
       work. Three calls, three different questions, and all three of them were
       opening into raw JSON of a trace digest — the single worst payload in the
       app to read as JSON and the one with the most to show as itself. */
    case "visualize_run":
      return <TracedRun result={record(result)} />;
    case "visualize_find":
      return <FoundMoments args={args ?? {}} result={record(result)} />;
    case "visualize_read_step":
      return <ReadStep result={record(result)} />;
    /* The attempt, which since the code started coming back with the log is the
       most-read call in a turn and was the ugliest: five hundred lines of event
       JSON, and the learner's own file buried somewhere inside it. */
    case "inspect_current_attempt":
    case "read_attempt":
    case "replay_attempt":
    case "evaluate_attempt": {
      /* Only when the payload actually arrived. A result too damaged to read is
         the raw payload's job — a drawn view of nothing says the attempt is
         empty, which is a different and false claim. */
      if (replay && (replay.nothing || replay.log.length || replay.cases.length || replay.runs.length || replay.files.length)) {
        return <AttemptReadView read={replay} />;
      }
      const attempt = record(result);
      if (!Array.isArray(attempt.events) && !Array.isArray(attempt.files)) break;
      return <Attempt result={attempt} />;
    }
    case "flow-memory-fetch":
      return <Memory reads={result} />;

    case "flow-memory-patch":
      return <Patches patches={args?.patches} />;

    default:
      break;
  }

  /* No view for this tool, or not enough of its arguments survived to draw one.
     The raw payload is the honest answer — a tool nobody has drawn yet is
     plain, never blank. */
  return <RawPayload input={input} output={output} />;
}

/** The calls that come back with a solve log. `evaluate_attempt` and
 *  `inspect_current_attempt` are v0.7 spellings of the same read, and old turns
 *  still draw. */
const ATTEMPT_TOOLS = new Set(["read_attempt", "evaluate_attempt", "inspect_current_attempt", "replay_attempt"]);

/* ---- Pieces ------------------------------------------------------------- */

type Entry = { name?: unknown; path?: unknown; type?: unknown };

const text = (value: unknown): string => (typeof value === "string" ? value : "");

/** A parsed result read as an object, which it is not always. */
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

/** Parses a payload once. Tool payloads are strings the worker stringified, and
 *  a truncated one is common enough that failing has to be ordinary. */
function useJson(body: string): Record<string, unknown> | unknown[] | null {
  return useMemo(() => {
    const parsed = parseJson(body) ?? parseJson(closeOff(body));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown> | unknown[]) : null;
  }, [body]);
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

/** The same, narrowed to a tool's arguments. */
function useObject(body: string): Record<string, unknown> | null {
  const parsed = useJson(body);
  return parsed && !Array.isArray(parsed) ? parsed : null;
}

/** The label above a field. One idiom for all of them, so a detail panel reads
 *  as one thing rather than as several. */
function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="px-2.5 pt-2 pb-1 text-[length:inherit] font-medium tracking-wide text-muted-foreground uppercase">{children}</p>;
}

/** Plain output — a command's, a page's. Same cap, no grammar. */
function Lines({ body }: { body: string }) {
  const [full, setFull] = useState(false);
  const trimmed = body.replace(/\s+$/, "");
  if (!trimmed) return null;
  const lines = trimmed.split("\n").length;

  return (
    <>
      <pre
        className={cn(
          "app-scroll overflow-x-auto px-2.5 pb-2 font-mono text-[length:inherit] leading-[1.55] whitespace-pre text-muted-foreground/90",
          !full && lines > 14 && "max-h-[15.5rem] overflow-y-hidden",
        )}
      >
        {trimmed}
      </pre>
      {lines > 14 && (
        <button
          className="mx-2.5 mb-2 cursor-default rounded-md bg-[var(--accent)] px-2 py-1 text-[length:inherit] text-muted-foreground transition-colors hover:text-foreground"
          onClick={() => setFull((value) => !value)}
          type="button"
        >
          {full ? "Collapse" : `Show all ${lines} lines`}
        </button>
      )}
    </>
  );
}

/**
 * A file, headed by its own name and mark.
 *
 * The path is the answer to "which file", so it leads — and it is clickable,
 * because the next thing after seeing that the agent read something is opening
 * it yourself.
 */
function FileView({ body, path, wrote = false }: { body: string; path: string; wrote?: boolean }) {
  const { onOpenFile } = useMarkdownLinks();
  const language = languageForPath(path);
  const marked = languageOf(language ?? "");

  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-1.5 px-2.5 pt-2 pb-1.5">
        {marked ? (
          <LanguageGlyph className="size-3.5 shrink-0" language={marked} />
        ) : (
          <CornerDownRight className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <button
          className="min-w-0 truncate font-mono text-[length:inherit] text-foreground/85 transition-colors hover:text-foreground hover:underline"
          onClick={() => onOpenFile?.(path)}
          title={`Open ${path}`}
          type="button"
        >
          {path}
        </button>
        {wrote && <span className="shrink-0 text-[length:inherit] text-muted-foreground">written</span>}
      </div>
      <Snippet body={body} language={language ?? "text"} />
    </div>
  );
}

/** A directory listing, as a column of names. Folders keep their own glyph and
 *  sort first — the service already returns them that way. */
function Listing({ entries, where }: { entries: Entry[]; where: string }) {
  const { onOpenFile } = useMarkdownLinks();
  if (entries.length === 0) return <p className="px-2.5 py-2 text-[length:inherit] text-muted-foreground">Nothing in there.</p>;

  return (
    <div className="min-w-0">
      <Eyebrow>{where ? where : "Project root"}</Eyebrow>
      <ul className="pb-2">
        {entries.map((entry, index) => {
          const name = text(entry.name);
          const path = text(entry.path);
          const directory = entry.type === "directory";
          const marked = directory ? null : languageOf(languageForPath(name) ?? "");
          return (
            <li key={`${path}-${index}`}>
              <button
                className="flex w-full min-w-0 items-center gap-1.5 px-2.5 py-[3px] text-left transition-colors hover:bg-[color-mix(in_oklab,var(--foreground)_5%,transparent)] disabled:hover:bg-transparent"
                disabled={directory}
                onClick={() => onOpenFile?.(path)}
                type="button"
              >
                {directory ? (
                  <Folder className="size-3.5 shrink-0 text-[var(--brand)]/85" />
                ) : marked ? (
                  <LanguageGlyph className="size-3.5 shrink-0" language={marked} />
                ) : (
                  <span className="size-3.5 shrink-0" />
                )}
                <span className={cn("min-w-0 truncate font-mono text-[length:inherit]", directory ? "text-foreground/70" : "text-muted-foreground")}>
                  {name}
                  {directory && "/"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * A shell command and what it printed.
 *
 * Set as a terminal: the prompt mark, the command in full, then the output. The
 * exit code is named only when it is not zero — a green "0" on every command is
 * the same noise a green tick on every row was.
 */
function Command({ command, exitCode, output }: { command: string; exitCode: number | null; output: string }) {
  const failed = exitCode !== null && exitCode !== 0;

  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-start gap-1.5 px-2.5 pt-2 pb-1.5">
        <span aria-hidden className="mt-px shrink-0 font-mono text-[length:inherit] text-muted-foreground">
          $
        </span>
        <code className="min-w-0 flex-1 font-mono text-[length:inherit] break-all text-foreground/85">{command}</code>
        {failed && (
          <span className="shrink-0 rounded-full bg-[color-mix(in_oklab,var(--destructive)_16%,transparent)] px-1.5 py-px text-[length:inherit] font-medium text-destructive">
            exit {exitCode}
          </span>
        )}
      </div>
      {output.trim() ? (
        <Lines body={output} />
      ) : (
        <p className="px-2.5 pb-2 text-[length:inherit] text-muted-foreground">No output.</p>
      )}
    </div>
  );
}

/** A web search: what was asked, and what came back. */
/**
 * A web search, drawn as a search.
 *
 * This row used to be the worst-looking thing in the transcript: a query, then a
 * list of bare titles with a domain under each, and — because the fetch tool
 * takes `urls` and this file read `url` — a wall of raw JSON whenever the agent
 * actually read a page. What the learner wants from an open search row is the
 * same thing they want from a browser: the question that was asked, the sites
 * that answered it, and enough of each answer to know whether to go there.
 *
 * So: the query sits in something shaped like the search field it was typed
 * into, every result carries the site's real favicon, and the extract Exa
 * already returned is shown rather than thrown away. The whole row is a link,
 * because a result you cannot open is a screenshot of a search.
 */
function WebSearch({ query, result }: { query: string; result: unknown }) {
  const rows = resultRows(result);
  const note = text(record(result).note);

  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-2 px-2.5 pt-2.5 pb-1.5">
        <span className="flex min-w-0 flex-1 items-center gap-1.5 rounded-full bg-[var(--accent)] px-2.5 py-1">
          <SearchMark className="size-3.5 shrink-0 text-muted-foreground/85 [&_*]:[stroke-width:1.8]" />
          <span className="min-w-0 truncate text-[length:inherit] text-foreground/90">{query}</span>
        </span>
        {rows.length > 0 && (
          <span className="shrink-0 text-[length:inherit] tabular-nums text-muted-foreground">
            {rows.length === 1 ? "1 result" : `${rows.length} results`}
          </span>
        )}
      </div>
      {note && <Note>{note}</Note>}
      {rows.length === 0 && !note && <Note>Nothing came back for this one.</Note>}
      <ul className="pb-1.5">
        {rows.map((row, index) => (
          <li className="min-w-0" key={`${text(row.url)}-${index}`}>
            <Result row={row} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Pages read in full. The same result rows, opened out: everything the search
 *  view shows, plus the text the agent was actually reading. */
function WebPages({ result, urls }: { result: unknown; urls: string[] }) {
  const rows = resultRows(result);
  const note = text(record(result).note);
  /* A URL that came back with nothing — unreachable, or a page with no text —
     is still worth naming, because "it read three pages" and "it tried three
     and got one" are different things to have watched happen. */
  const missing = urls.filter((url) => !rows.some((row) => text(row.url) === url));

  return (
    <div className="min-w-0 pt-1">
      {note && <Note>{note}</Note>}
      {rows.map((row, index) => (
        <div className="min-w-0" key={`${text(row.url)}-${index}`}>
          {index > 0 && <div className="mx-2.5 border-t border-border/60" />}
          <Result row={row} />
          <Lines body={text(row.extract)} />
        </div>
      ))}
      {missing.map((url) => (
        <div className="flex min-w-0 items-center gap-2 px-2.5 py-1.5 text-[length:inherit] text-muted-foreground" key={url}>
          <Favicon host={host(url)} />
          <span className="min-w-0 truncate">{host(url)} returned nothing to read.</span>
        </div>
      ))}
    </div>
  );
}

/** One page: who published it, what it is called, and the first of what it says. */
function Result({ row }: { row: Record<string, unknown> }) {
  const links = useMarkdownLinks();
  const url = text(row.url);
  const title = text(row.title) || url;
  const extract = text(row.extract);
  const when = published(text(row.published));

  return (
    <button
      className="group/result flex w-full min-w-0 gap-2 rounded-md px-2.5 py-1.5 text-left transition-colors hover:bg-[var(--accent)] disabled:cursor-default"
      disabled={!url || !links.onOpenUrl}
      onClick={() => url && links.onOpenUrl?.(url)}
      type="button"
    >
      <span className="pt-[0.2rem]">
        <Favicon host={host(url)} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="min-w-0 truncate text-[length:inherit] text-foreground/90 group-hover/result:text-foreground">{title}</span>
        </span>
        <span className="flex min-w-0 items-baseline gap-1.5 text-[length:inherit] text-muted-foreground">
          <span className="min-w-0 truncate">{host(url)}</span>
          {when && <span className="shrink-0">· {when}</span>}
        </span>
        {extract && (
          <span className="mt-0.5 line-clamp-2 text-[length:inherit] leading-[1.5] text-muted-foreground/80">{extract}</span>
        )}
      </span>
    </button>
  );
}

/** A short aside in the detail panel: an Exa error, an unset key, an empty
 *  result. Said in a sentence, where the raw payload used to be. */
function Note({ children }: { children: React.ReactNode }) {
  return <p className="px-2.5 pb-2 text-[length:inherit] leading-[1.5] text-muted-foreground/85">{children}</p>;
}

/** The results out of a `WebSearchResult`, whichever shape the turn stored —
 *  the bare array of older turns, or today's `{ configured, note, results }`. */
function resultRows(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  const inner = record(result).results;
  return Array.isArray(inner) ? (inner as Array<Record<string, unknown>>) : [];
}

/** A publication date as a person writes one. Exa returns ISO timestamps, and
 *  the time of day a blog post went up is never the point. */
function published(value: string): string {
  if (!value) return "";
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return "";
  return at.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/**
 * A site's own icon.
 *
 * The real one, because that is what makes a list of results readable at a
 * glance — you recognise the Rust logo before you have read the domain beside
 * it. Two sources are tried in order and neither is a tracker: the site's own
 * `/favicon.ico`, which tells only the site itself that its icon was wanted and
 * which it learned anyway when the agent read the page; then DuckDuckGo's icon
 * service, for the many sites that declare an icon in markup and serve nothing
 * at the well-known path.
 *
 * The last tier is a monogram, so a site with no icon at all still gets
 * something the eye can use as one rather than a gap in the row. The hue is
 * derived from the host, which is what makes it work: the same site is the same
 * colour every time it appears.
 */
function Favicon({ host: site }: { host: string }) {
  const sources = useMemo(
    () => (site && !site.includes("/") ? [`https://${site}/favicon.ico`, `https://icons.duckduckgo.com/ip3/${site}.ico`] : []),
    [site],
  );
  const [tier, setTier] = useState(0);
  useEffect(() => setTier(0), [sources]);

  const source = sources[tier];
  if (!source) return <Monogram host={site} />;

  return (
    <img
      alt=""
      className="size-4 shrink-0 rounded-[3px] object-contain"
      loading="lazy"
      onError={() => setTier((value) => value + 1)}
      src={source}
    />
  );
}

function Monogram({ host: site }: { host: string }) {
  const letter = (site.replace(/^www\./, "")[0] ?? "?").toUpperCase();
  /* Deterministic, so one site keeps one colour across every row it appears in.
     A rotating palette would make the same source look like three. */
  let hash = 0;
  for (const character of site) hash = (hash * 31 + character.charCodeAt(0)) % 360;

  return (
    <span
      className="flex size-4 shrink-0 items-center justify-center rounded-[3px] text-[0.5625rem] font-semibold text-white/95"
      style={{ backgroundColor: `hsl(${hash} 42% 52%)` }}
    >
      {letter}
    </span>
  );
}

/** The host of a URL, for the line under a result. A full URL is unreadable at
 *  this size and the domain is the part that says whether to trust it. */
function host(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Flow Memory, read back. One section per note, named for what it holds. */
/**
 * A trace, as the shape of the run rather than as its digest.
 *
 * What was called, what came back, and which variables moved — the three facts
 * the agent took this trace to establish, in the order it would say them. The
 * variable lives are the part worth drawing: `w_sum: 0 → 10, 5 changes` is a
 * loop's whole story, and it was previously a nested array in a JSON dump.
 */
function TracedRun({ result }: { result: Record<string, unknown> }) {
  const digest = record(result.digest);
  const failed = text(digest.error) || text(result.error);
  const variables = Array.isArray(digest.variables) ? digest.variables.map(record) : [];
  const steps = typeof digest.steps === "number" ? digest.steps : null;

  if (failed && steps === null) return <Note>{text(result.note) || failed}</Note>;

  return (
    <div className="min-w-0">
      {text(result.setup) ? (
        <>
          <Eyebrow>Traced</Eyebrow>
          <Snippet body={text(result.setup)} language="python" />
        </>
      ) : null}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-2.5 pt-2 pb-2 text-[length:inherit] text-muted-foreground">
        {steps !== null && <span className="tabular-nums">{steps} steps</span>}
        {text(digest.returned) ? (
          <span>
            returned <code className="font-mono text-foreground/85">{text(digest.returned)}</code>
          </span>
        ) : null}
        {digest.truncated === true && <span>cut short</span>}
        {failed ? <span className="text-destructive">{failed}</span> : null}
      </div>
      {variables.length > 0 && (
        <>
          <Eyebrow>What moved</Eyebrow>
          <div className="px-2.5 pb-2">
            {variables.slice(0, 8).map((variable, index) => (
              <div className="relative flex min-w-0 items-baseline gap-2 border-l border-border/70 py-1.5 pl-3 ml-1" key={index}>
                <code className="shrink-0 font-mono text-[length:inherit] text-foreground/85">{text(variable.name)}</code>
                <span className="min-w-0 flex-1 truncate font-mono text-[length:inherit] text-muted-foreground">
                  {text(variable.first)}
                  <span className="mx-1 text-muted-foreground/50">→</span>
                  {text(variable.last)}
                </span>
                {typeof variable.changes === "number" && variable.changes > 0 && (
                  <span className="shrink-0 tabular-nums text-[length:inherit] text-muted-foreground/60">
                    {variable.changes}×
                  </span>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * A step search: what was looked for, and every moment that answered.
 *
 * `why` is already written for a reader — `w_sum: 6 → 10` — so the row is that
 * sentence against the step it happened at, with the line of source under it.
 * This is the view the whole visualiser exists to produce and it was a count.
 */
function FoundMoments({ args, result }: { args: Record<string, unknown>; result: Record<string, unknown> }) {
  const moments = Array.isArray(result.moments) ? result.moments.map(record) : [];
  const looked = [
    text(args.variable) && `variable ${text(args.variable)}`,
    typeof args.line === "number" && `line ${args.line}`,
    text(args.event) && `${text(args.event)} events`,
    text(args.value) && `value ${text(args.value)}`,
    typeof args.branch === "boolean" && `branches that went ${args.branch ? "true" : "false"}`,
  ].filter(Boolean) as string[];

  return (
    <div className="min-w-0">
      {looked.length > 0 && (
        <p className="px-2.5 pt-2 pb-1 text-[length:inherit] text-muted-foreground">Looked for {looked.join(", ")}</p>
      )}
      {moments.length === 0 ? (
        <Note>{text(result.note) || "Nothing in the run matched."}</Note>
      ) : (
        <div className="px-2.5 pt-1 pb-2">
          {moments.slice(0, 12).map((moment, index) => (
            <div className="flex min-w-0 items-baseline gap-2 py-0.5" key={index}>
              <span className="shrink-0 tabular-nums text-[length:inherit] text-muted-foreground/60">
                {typeof moment.step === "number" ? moment.step : "—"}
              </span>
              <span className="min-w-0 flex-1">
                <span className="text-[length:inherit] text-foreground/85">{text(moment.why)}</span>
                {text(moment.source) ? (
                  <code className="ml-2 font-mono text-[length:inherit] text-muted-foreground/70">{text(moment.source)}</code>
                ) : null}
              </span>
            </div>
          ))}
          {moments.length > 12 && (
            <p className="pt-1 text-[length:inherit] text-muted-foreground/60">
              {moments.length - 12} more
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * One instant of the run: the line it was on, what it changed, and everything
 * in scope. `changed` leads because it is the only part a snapshot cannot say —
 * the difference between "here is the state" and "here is what this step did".
 */
function ReadStep({ result }: { result: Record<string, unknown> }) {
  const changed = Array.isArray(result.changed) ? result.changed.filter((entry): entry is string => typeof entry === "string") : [];
  const locals = record(result.locals);
  const names = Object.keys(locals);
  if (typeof result.step !== "number") return <Note>{text(result.note) || "That step is not in this run."}</Note>;

  return (
    <div className="min-w-0">
      <p className="px-2.5 pt-2 pb-1 text-[length:inherit] text-muted-foreground">
        <span className="tabular-nums">
          Step {result.step}
          {typeof result.of === "number" ? ` of ${result.of}` : ""}
        </span>
        {typeof result.line === "number" ? <span className="tabular-nums"> · line {result.line}</span> : null}
      </p>
      {text(result.source) ? <Snippet body={text(result.source)} language="python" /> : null}
      {changed.length > 0 && (
        <>
          <Eyebrow>Changed here</Eyebrow>
          <div className="px-2.5 pb-2">
            {changed.map((entry, index) => (
              <p className="font-mono text-[length:inherit] text-foreground/85" key={index}>{entry}</p>
            ))}
          </div>
        </>
      )}
      {names.length > 0 && (
        <>
          <Eyebrow>In scope</Eyebrow>
          <div className="px-2.5 pb-2">
            {names.slice(0, 12).map((name) => (
              <div className="relative flex min-w-0 items-baseline gap-2 border-l border-border/70 py-1.5 pl-3 ml-1" key={name}>
                <code className="shrink-0 font-mono text-[length:inherit] text-foreground/85">{name}</code>
                <code className="min-w-0 flex-1 truncate font-mono text-[length:inherit] text-muted-foreground">{text(locals[name])}</code>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * What the learner has, and what they have done to it.
 *
 * Their code first and their history under it, because that is the order the
 * question comes in: what does it say, and then how did it get here. The log is
 * one line per event with its own time, which is the part the JSON could never
 * show — twelve `file_changed` records are a paragraph of identical objects and
 * a single glance at a column of stamps.
 */
function Attempt({ result }: { result: Record<string, unknown> }) {
  const files = Array.isArray(result.files) ? (result.files as Array<Record<string, unknown>>) : [];
  const events = Array.isArray(result.events) ? (result.events as Array<Record<string, unknown>>) : [];
  const opened = events.find((event) => text(event.type) === "attempt_started")?.occurredAt;
  const since = typeof opened === "string" ? Date.parse(opened) : NaN;
  if (files.length === 0 && events.length === 0) return <Note>Nothing has been recorded on this attempt yet.</Note>;

  return (
    <div className="min-w-0">
      {files.length > 0 && <AttemptFiles files={files} />}
      {events.length > 0 && (
        <>
          {files.length > 0 && <div className="mx-2.5 border-t border-border/60" />}
          <div className="flex items-center gap-1.5 px-2.5 pt-2.5 pb-1.5 text-muted-foreground">
            <Clock3 aria-hidden className="size-3.5" />
            <span className="font-medium">Activity</span>
            <span className="ml-auto tabular-nums">{events.length} {events.length === 1 ? "event" : "events"}</span>
          </div>
          {/* Held to a height. A long attempt is ninety events, and a panel that
              tall is one row pushing the rest of the turn off the screen — the
              same reason the thinking block inside a step is capped. */}
          <FadedScroll className="px-2.5 pb-2">
            <div>
              {events.map((event, index) => (
                <Moment event={event} key={text(event.id) || index} since={since} />
              ))}
            </div>
          </FadedScroll>
        </>
      )}
    </div>
  );
}

function AttemptFiles({ files }: { files: Array<Record<string, unknown>> }) {
  const [selected, setSelected] = useState("");
  const value = files.some((file, index) => `${text(file.path)}:${index}` === selected)
    ? selected : `${text(files[0]?.path)}:0`;

  return (
    <Tabs.Root value={value} onValueChange={setSelected}>
      <Tabs.List aria-label="Solution files" className="app-scroll flex items-center gap-1 overflow-x-auto border-b border-border/60 p-1.5">
        {files.map((file, index) => {
          const path = text(file.path);
          const tabValue = `${path}:${index}`;
          return (
            <Tabs.Trigger key={tabValue} value={tabValue} asChild>
              <FileTab path={path} active={value === tabValue} className="text-[length:inherit]" />
            </Tabs.Trigger>
          );
        })}
      </Tabs.List>
      {files.map((file, index) => (
        <Tabs.Content key={`${text(file.path)}:${index}`} value={`${text(file.path)}:${index}`} className="min-w-0 pt-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
          <Snippet body={text(file.text)} language={languageForPath(text(file.path)) ?? "text"} />
        </Tabs.Content>
      ))}
    </Tabs.Root>
  );
}

/** One recorded event: when it happened, what kind it was, and the one thing
 *  about it worth reading. The offset rather than the clock time — an attempt is
 *  read as a stretch of work, and 4:12 into it says something 14:06:22 does not. */
function Moment({ event, since }: { event: Record<string, unknown>; since: number }) {
  const payload = record(event.payload);
  const kind = text(event.type);

  return (
    <div className="relative flex min-w-0 items-baseline gap-2 border-l border-border/70 py-1.5 pl-3 ml-1">
      <span aria-hidden className="absolute -left-[3px] top-[0.9em] size-[5px] rounded-full bg-muted-foreground/50" />
      <span className={cn("shrink-0 text-[length:inherit]", kind === "test_run" && !payload.passed ? "text-[var(--warning)]" : "text-foreground/85")}>{MOMENT[kind] ?? kind.replace(/_/g, " ")}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-[length:inherit] text-muted-foreground">{momentDetail(kind, payload)}</span>
      <span className="shrink-0 font-mono tabular-nums text-muted-foreground/70">{offset(text(event.occurredAt), since)}</span>
    </div>
  );
}

const MOMENT: Record<string, string> = {
  attempt_started: "Attempt opened",
  file_changed: "edited",
  command_executed: "ran",
  test_run: "tested",
  submission_created: "submitted",
  submission_evaluated: "reviewed",
  attempt_completed: "closed",
  hint_requested: "asked for a hint",
  learner_remark: "said",
  agent_message: "replied",
};

/** The half-line beside an event. Each kind has exactly one thing worth
 *  reading — a score, a path, a verdict — and everything else in the payload is
 *  what made the raw version unreadable. */
function momentDetail(kind: string, payload: Record<string, unknown>): string {
  if (kind === "test_run") {
    const passed = typeof payload.passedCases === "number" ? payload.passedCases : null;
    const failed = typeof payload.failedCases === "number" ? payload.failedCases : null;
    const scope = text(payload.scope) === "visible" ? "" : text(payload.scope).replace(/-/g, " ");
    const score = passed === null || failed === null ? (payload.passed ? "passed" : "failed") : `${passed}/${passed + failed}`;
    return [score, scope].filter(Boolean).join(" · ");
  }
  if (kind === "submission_evaluated") return [text(payload.review), text(payload.approach)].filter(Boolean).join(" · ");
  if (kind === "attempt_completed") return text(payload.outcome);
  if (kind === "learner_remark" || kind === "agent_message" || kind === "hint_requested") return text(payload.body);
  if (kind === "command_executed") return text(payload.command);
  return text(payload.path);
}

/** How far into the attempt something happened. */
function offset(at: string, since: number): string {
  const when = Date.parse(at);
  if (!Number.isFinite(when) || !Number.isFinite(since)) return "";
  const seconds = Math.max(0, Math.round((when - since) / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 10) return `${minutes}m${seconds % 60}s`;
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h${minutes % 60}m`;
}

function Memory({ reads }: { reads: unknown }) {
  const rows = Array.isArray(reads) ? (reads as Array<Record<string, unknown>>) : [];
  if (rows.length === 0) return null;

  return (
    <div className="min-w-0">
      {rows.map((row, index) => (
        <div className="min-w-0" key={index}>
          {index > 0 && <div className="mx-2.5 border-t border-border/60" />}
          <Eyebrow>{memoryLabel(text(row.file)) || "Memory"}</Eyebrow>
          <Lines body={text(row.content)} />
        </div>
      ))}
    </div>
  );
}

/** How a patch changed the note, in words rather than in the tool's own
 *  vocabulary: "replace" is what the code does, "rewritten" is what happened to
 *  something the learner owns. */
const PATCH_MODE: Record<string, string> = {
  append: "added",
  prepend: "added at the top",
  replace: "rewritten",
};

/** Flow Memory, written. What was changed and how, per patch. */
function Patches({ patches }: { patches: unknown }) {
  const rows = Array.isArray(patches) ? (patches as Array<Record<string, unknown>>) : [];
  if (rows.length === 0) return null;

  return (
    <div className="min-w-0">
      {rows.map((row, index) => (
        <div className="min-w-0" key={index}>
          {index > 0 && <div className="mx-2.5 border-t border-border/60" />}
          <div className="flex min-w-0 items-baseline gap-1.5 px-2.5 pt-2 pb-1">
            <span className="shrink-0 text-[length:inherit] text-foreground/85">{memoryLabel(text(row.file)) || "Memory"}</span>
            <span className="shrink-0 text-[length:inherit] text-muted-foreground">{PATCH_MODE[text(row.mode)] ?? PATCH_MODE.append}</span>
            {text(row.reason) && <span className="min-w-0 truncate text-[length:inherit] text-muted-foreground">· {text(row.reason)}</span>}
          </div>
          <Lines body={text(row.content)} />
        </div>
      ))}
    </div>
  );
}

/**
 * A question the agent asked, and what the learner said back.
 *
 * This row is the only one in the transcript whose "input" is a sentence the
 * learner already read and whose "result" is something they wrote themselves.
 * Dumping it as INPUT/RESULT JSON made them read their own answer out of a
 * payload, with the question quoted beside `"allowOther": true`.
 *
 * So it is drawn as the exchange it is: the question in the app's own type,
 * with `[[file:…]]` references live the same way they were live in the card,
 * and the answer under it against a rule. The choices are shown only when the
 * answer was not one of them — offering "A / B" above an answer of "A" is the
 * interface saying the same thing twice.
 */
function Exchange({ answer, choices, question }: { answer: string; choices: string[]; question: string }) {
  const chosen = choices.some((choice) => choice.toLowerCase() === answer.trim().toLowerCase());
  const spare = chosen ? [] : choices;

  return (
    <div className="min-w-0 px-2.5 py-2">
      <p className="text-[length:inherit] leading-[1.55] text-foreground/90">
        <Inline text={question} />
      </p>

      {spare.length > 0 && (
        <ul className="mt-1.5 flex flex-wrap gap-1">
          {spare.map((choice, index) => (
            <li
              key={`${choice}-${index}`}
              className="rounded-[var(--radius-item)] bg-[color-mix(in_oklab,var(--foreground)_4%,transparent)] px-1.5 py-[2px] text-[length:inherit] text-muted-foreground/80"
            >
              <Inline text={choice} />
            </li>
          ))}
        </ul>
      )}

      {answer ? (
        <p className="mt-2 border-l border-border/70 pl-2.5 text-[length:inherit] leading-[1.55] whitespace-pre-wrap text-foreground">
          <Inline text={answer} />
        </p>
      ) : (
        /* The row is open while the card below it is still waiting. */
        <p className="mt-2 text-[length:inherit] text-muted-foreground/85">Waiting for your answer.</p>
      )}
    </div>
  );
}

/** The learner's answer as they typed it. The worker stores tool results as
 *  strings, and a string result arrives JSON-quoted; anything else is already
 *  the text. */
function answerText(output: string): string {
  const body = output.trim();
  if (!body.startsWith('"')) return body;
  try {
    const parsed: unknown = JSON.parse(body);
    return typeof parsed === "string" ? parsed : body;
  } catch {
    return body;
  }
}
