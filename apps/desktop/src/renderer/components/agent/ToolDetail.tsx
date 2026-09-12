import { useEffect, useMemo, useState } from "react";
import { CornerDownRight, Folder, Search as SearchMark } from "lucide-react";

import { languageForPath } from "@spar/domain";
import { useCodeTheme } from "@/hooks/use-code-theme";
import { highlight, type Span } from "@/lib/highlight";
import { cn } from "@/lib/utils";
import { LanguageGlyph, languageOf } from "../common/LanguageGlyph";
import { Inline } from "./Markdown";
import { useMarkdownLinks } from "./MarkdownLinks";
import { memoryLabel } from "./toolSubject";
import { RawPayload } from "./ToolPayload";

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
    try {
      const parsed: unknown = JSON.parse(body);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown> | unknown[]) : null;
    } catch {
      return null;
    }
  }, [body]);
}

/** The same, narrowed to a tool's arguments. */
function useObject(body: string): Record<string, unknown> | null {
  const parsed = useJson(body);
  return parsed && !Array.isArray(parsed) ? parsed : null;
}

/** The label above a field. One idiom for all of them, so a detail panel reads
 *  as one thing rather than as several. */
function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="px-2.5 pt-2 pb-1 text-ui-sm font-medium tracking-wide text-muted-foreground uppercase">{children}</p>;
}

/**
 * Code, in the theme the editor uses.
 *
 * Capped by default and openable. A file the agent read can be four hundred
 * lines, and a transcript that grows by a screenful every time the agent looks
 * at something is a transcript nobody can scroll.
 */
function Snippet({ body, language }: { body: string; language: string }) {
  const { theme } = useCodeTheme();
  const [spans, setSpans] = useState<Span[] | null>(null);
  const [full, setFull] = useState(false);
  const trimmed = body.replace(/\s+$/, "");
  const lines = trimmed ? trimmed.split("\n").length : 0;

  useEffect(() => {
    let alive = true;
    void highlight(trimmed, language).then((next) => {
      if (alive) setSpans(next);
    });
    return () => {
      alive = false;
    };
  }, [trimmed, language]);

  if (!trimmed) return null;

  return (
    <>
      <pre
        className={cn(
          "app-scroll overflow-x-auto px-2.5 pb-2 font-mono text-ui-sm leading-[1.55]",
          !full && lines > 14 && "max-h-[15.5rem] overflow-y-hidden",
        )}
        style={{ color: theme.slots.foreground }}
      >
        {/* Plain until the grammar resolves, so a long file is readable
            immediately rather than blank for a beat. */}
        <code>
          {spans
            ? spans.map((span, index) => (
                <span key={index} style={span.slot ? { color: theme.slots[span.slot] } : undefined}>
                  {span.text}
                </span>
              ))
            : trimmed}
        </code>
      </pre>
      {lines > 14 && (
        <button
          className="mx-2.5 mb-2 cursor-default rounded-md bg-[var(--accent)] px-2 py-1 text-ui-sm text-muted-foreground transition-colors hover:text-foreground"
          onClick={() => setFull((value) => !value)}
          type="button"
        >
          {full ? "Collapse" : `Show all ${lines} lines`}
        </button>
      )}
    </>
  );
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
          "app-scroll overflow-x-auto px-2.5 pb-2 font-mono text-ui-sm leading-[1.55] whitespace-pre text-muted-foreground/90",
          !full && lines > 14 && "max-h-[15.5rem] overflow-y-hidden",
        )}
      >
        {trimmed}
      </pre>
      {lines > 14 && (
        <button
          className="mx-2.5 mb-2 cursor-default rounded-md bg-[var(--accent)] px-2 py-1 text-ui-sm text-muted-foreground transition-colors hover:text-foreground"
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
          className="min-w-0 truncate font-mono text-ui-sm text-foreground/85 transition-colors hover:text-foreground hover:underline"
          onClick={() => onOpenFile?.(path)}
          title={`Open ${path}`}
          type="button"
        >
          {path}
        </button>
        {wrote && <span className="shrink-0 text-ui-sm text-muted-foreground">written</span>}
      </div>
      <Snippet body={body} language={language ?? "text"} />
    </div>
  );
}

/** A directory listing, as a column of names. Folders keep their own glyph and
 *  sort first — the service already returns them that way. */
function Listing({ entries, where }: { entries: Entry[]; where: string }) {
  const { onOpenFile } = useMarkdownLinks();
  if (entries.length === 0) return <p className="px-2.5 py-2 text-ui-sm text-muted-foreground">Nothing in there.</p>;

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
                <span className={cn("min-w-0 truncate font-mono text-ui-sm", directory ? "text-foreground/70" : "text-muted-foreground")}>
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
        <span aria-hidden className="mt-px shrink-0 font-mono text-ui-sm text-muted-foreground">
          $
        </span>
        <code className="min-w-0 flex-1 font-mono text-ui-sm break-all text-foreground/85">{command}</code>
        {failed && (
          <span className="shrink-0 rounded-full bg-[color-mix(in_oklab,var(--destructive)_16%,transparent)] px-1.5 py-px text-ui-sm font-medium text-destructive">
            exit {exitCode}
          </span>
        )}
      </div>
      {output.trim() ? (
        <Lines body={output} />
      ) : (
        <p className="px-2.5 pb-2 text-ui-sm text-muted-foreground">No output.</p>
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
          <span className="min-w-0 truncate text-ui text-foreground/90">{query}</span>
        </span>
        {rows.length > 0 && (
          <span className="shrink-0 text-ui-sm tabular-nums text-muted-foreground">
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
        <div className="flex min-w-0 items-center gap-2 px-2.5 py-1.5 text-ui-sm text-muted-foreground" key={url}>
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
          <span className="min-w-0 truncate text-ui text-foreground/90 group-hover/result:text-foreground">{title}</span>
        </span>
        <span className="flex min-w-0 items-baseline gap-1.5 text-ui-sm text-muted-foreground">
          <span className="min-w-0 truncate">{host(url)}</span>
          {when && <span className="shrink-0">· {when}</span>}
        </span>
        {extract && (
          <span className="mt-0.5 line-clamp-2 text-ui-sm leading-[1.5] text-muted-foreground/80">{extract}</span>
        )}
      </span>
    </button>
  );
}

/** A short aside in the detail panel: an Exa error, an unset key, an empty
 *  result. Said in a sentence, where the raw payload used to be. */
function Note({ children }: { children: React.ReactNode }) {
  return <p className="px-2.5 pb-2 text-ui-sm leading-[1.5] text-muted-foreground/85">{children}</p>;
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
            <span className="shrink-0 text-ui-sm text-foreground/85">{memoryLabel(text(row.file)) || "Memory"}</span>
            <span className="shrink-0 text-ui-sm text-muted-foreground">{PATCH_MODE[text(row.mode)] ?? PATCH_MODE.append}</span>
            {text(row.reason) && <span className="min-w-0 truncate text-ui-sm text-muted-foreground">· {text(row.reason)}</span>}
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
      <p className="text-ui leading-[1.55] text-foreground/90">
        <Inline text={question} />
      </p>

      {spare.length > 0 && (
        <ul className="mt-1.5 flex flex-wrap gap-1">
          {spare.map((choice, index) => (
            <li
              key={`${choice}-${index}`}
              className="rounded-[var(--radius-item)] bg-[color-mix(in_oklab,var(--foreground)_4%,transparent)] px-1.5 py-[2px] text-ui-sm text-muted-foreground/80"
            >
              <Inline text={choice} />
            </li>
          ))}
        </ul>
      )}

      {answer ? (
        <p className="mt-2 border-l border-border/70 pl-2.5 text-ui leading-[1.55] whitespace-pre-wrap text-foreground">
          <Inline text={answer} />
        </p>
      ) : (
        /* The row is open while the card below it is still waiting. */
        <p className="mt-2 text-ui-sm text-muted-foreground/85">Waiting for your answer.</p>
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
