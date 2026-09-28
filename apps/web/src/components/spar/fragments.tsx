/* eslint-disable @next/next/no-img-element */
import { ProviderGlyph } from "@/components/icons";
import { Bookmark, Check, Chevron, Clock, CodeforcesMark, Cross, Eye, Key, Play, Search, Send, Server, Spin, Warn } from "./icons";

/**
 * Pieces of Spar, drawn for the page.
 *
 * Each is a real surface from the app — the result panel, the stage tree, the
 * ability rows — reduced to what a card has room to say, in the app's own dark
 * palette. The words in them are the app's words: the stage verbs, the verdict
 * and the agent's reply are taken from the recorded session the hero plays.
 * Sizes are in em off the plate's `--ui`, so each one scales with its card.
 */

const C = {
  green: "#6fd08c",
  red: "#ff6b6b",
  amber: "#f0b350",
  violet: "#a78bfa",
  blue: "#7cb3ff",
  code: { keyword: "#ff8177", string: "#8bd891", number: "#79c0ff", comment: "#8b949e", fn: "#d2a8ff", text: "#c9d1d9" },
};

/** A fragment's place in its card's timeline, for the arrival classes in features.css. */
const at = (ms: number) => ({ ["--at" as string]: `${Math.round(ms)}ms` }) as React.CSSProperties;

const Py = () => <img alt="" src="/langs/python-original.svg" style={{ width: "1.1em", height: "1.1em" }} />;

/* ---- The attempt ---------------------------------------------------------- */

/** Run and Submit, as the toolbar floats them. */
export function Toolbar() {
  return (
    <div className="ui flex items-center gap-[0.9em] px-[0.9em] py-[0.6em]" style={{ fontSize: "calc(var(--ui) * 1.2)" }}>
      <span className="ui-muted flex items-center gap-[0.35em]"><Clock /> 1m 12s</span>
      <span className="flex items-center gap-[0.4em] rounded-[0.55em] border border-white/10 px-[0.6em] py-[0.25em]"><Play /> Run <span className="ui-faint text-[0.85em]">⌘↵</span></span>
      <span className="flex items-center gap-[0.4em] rounded-[0.55em] bg-[#f4f4f5] px-[0.65em] py-[0.25em] text-[#111]"><Send /> Submit</span>
    </div>
  );
}

/** The result panel after a submission: the dots, the verdict, the case that broke. */
export function Verdict() {
  const dots = Array.from({ length: 28 }, (_, index) => (index === 0 ? "pass" : index === 1 ? "fail" : "idle"));
  return (
    <div className="ui w-[32em] overflow-hidden">
      <div className="flex items-center gap-[1.4em] px-[1.2em] pt-[0.9em] pb-[0.7em]">
        <span className="ui-muted">Testcase <span className="ui-faint">4</span></span>
        <span className="rounded-[0.45em] bg-white/[0.07] px-[0.55em] py-[0.1em]">Test Result <span style={{ color: C.red }}>1/28</span></span>
        <span className="ui-muted">Attempt <span className="ui-faint">7</span></span>
      </div>
      <div className="ui-rule grid grid-cols-[10em_minmax(0,1fr)] gap-[1.2em] px-[1.2em] py-[1.1em]">
        <div>
          <div className="grid w-fit grid-cols-7 gap-[0.42em]">
            {dots.map((state, index) => (
              <span
                key={index}
                className={`block size-[0.62em] rounded-full ${index < 2 ? "arrive-mark" : ""}`}
                style={{
                  ...at(index * 220),
                  background: state === "pass" ? C.green : state === "fail" ? C.red : "rgb(255 255 255 / 0.16)",
                  boxShadow: state === "fail" ? `0 0 0 0.18em rgb(255 107 107 / 0.3)` : undefined,
                }}
              />
            ))}
          </div>
          <p className="arrive mt-[1.2em] text-[1.15em] font-medium" style={{ color: C.red, ...at(420) }}>Wrong Answer</p>
          <p className="arrive ui-faint mt-[0.15em]" style={at(480)}>failed on case 2 of 28</p>
        </div>
        <div className="arrive" style={at(560)}>
          <p className="flex items-center gap-[0.45em]"><Cross style={{ color: C.red }} /> null root with later entries</p>
          <p className="ui-faint mt-[0.9em] text-[0.9em]">Input</p>
          <p className="ui-mono mt-[0.3em] w-fit rounded-[0.5em] border border-white/[0.08] bg-black/25 px-[0.7em] py-[0.35em]">[None, 5, 8]</p>
          <div className="mt-[0.8em] grid grid-cols-2 gap-[0.8em]">
            <div>
              <p className="ui-faint text-[0.9em]">Output</p>
              <p className="ui-mono mt-[0.3em] rounded-[0.5em] border px-[0.7em] py-[0.35em]" style={{ borderColor: "rgb(255 107 107 / 0.35)", background: "rgb(255 107 107 / 0.08)" }}>2</p>
            </div>
            <div>
              <p className="ui-faint text-[0.9em]">Expected</p>
              <p className="ui-mono mt-[0.3em] rounded-[0.5em] border border-white/[0.08] bg-black/25 px-[0.7em] py-[0.35em]">0</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---- The map ------------------------------------------------------------- */

const BELIEFS = [
  { group: "In training", color: C.amber, rows: [{ text: "Array iteration with correct loop boundaries in Python", value: 70 }] },
  {
    group: "Needs evidence",
    color: C.violet,
    rows: [{ text: "Build a simple binary tree from a level-order list", value: 0 }],
  },
];

/** "What Spar believes", as the home page lists it. */
export function Beliefs() {
  return (
    <div className="ui w-[32em] px-[1.3em] py-[1.1em]">
      <p className="ui-muted">What Spar believes <span className="ui-faint">· 7</span></p>
      {BELIEFS.map((group) => (
        <div key={group.group} className="mt-[1em] rounded-[0.8em] border border-white/[0.07] bg-white/[0.025] px-[1em] py-[0.8em]">
          <p className="flex items-center gap-[0.45em] text-[0.92em]" style={{ color: group.color }}>
            <span className="size-[0.45em] rounded-full" style={{ background: group.color }} />
            {group.group}
          </p>
          {group.rows.map((row) => (
            <div key={row.text} className="mt-[0.55em] flex items-center gap-[1em]">
              <span className="min-w-0 flex-1 truncate">{row.text}</span>
              <span className="relative h-[0.28em] w-[5em] rounded-full bg-white/10">
                <span className="grow-x absolute inset-y-0 left-0 rounded-full" style={{ width: `${row.value}%`, background: group.color }} />
              </span>
              <span className="ui-faint w-[2.4em] text-right tabular-nums">{row.value}%</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** A concept's hover card: what the attempts behind it actually say. */
export function ConceptPeek() {
  return (
    <div className="ui arrive-card w-[19em] px-[1.1em] py-[0.95em]" style={at(600)}>
      <p className="ui-faint text-[0.88em]">Concept</p>
      <p className="mt-[0.15em] text-[1.08em] font-medium">Tree structure roles</p>
      <p className="mt-[0.5em] flex items-center gap-[0.45em] text-[0.92em]" style={{ color: C.amber }}>
        <span className="size-[0.45em] rounded-full" style={{ background: C.amber }} /> Forming
      </p>
      <div className="mt-[0.8em] grid grid-cols-3 gap-[0.5em] text-center">
        {[
          ["1", "passed", C.green],
          ["1", "failed", C.red],
          ["2", "open", "#a1a1aa"],
        ].map(([count, label, color]) => (
          <div key={label} className="rounded-[0.6em] bg-white/[0.05] py-[0.45em]">
            <p className="text-[1.15em] font-medium tabular-nums" style={{ color }}>{count}</p>
            <p className="ui-faint text-[0.82em]">{label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---- The rating ---------------------------------------------------------- */

/** The rating card from the home page, with the line it draws. */
export function RatingCard() {
  return (
    <div className="ui w-[30em] px-[1.4em] py-[1.2em]">
      <p className="ui-muted flex items-center gap-[0.3em]">Spar Rating <Chevron down /></p>
      <div className="mt-[0.2em] flex items-end gap-[0.6em]">
        <span className="font-semibold tracking-[-0.03em]" style={{ fontSize: "3.6em", lineHeight: 1 }}>1249</span>
        <span className="arrive pb-[0.5em] text-[1.15em]" style={{ color: C.green, ...at(900) }}>+2</span>
        <span className="mb-[0.55em] rounded-[0.5em] border border-white/10 px-[0.5em] text-[0.95em] text-white/70">Provisional</span>
      </div>
      <svg viewBox="0 0 300 70" className="mt-[0.8em] w-full" style={{ height: "5em" }} preserveAspectRatio="none">
        <defs>
          <linearGradient id="rating-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0.16" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
        </defs>
        <g className="sweep">
          <path d="M0 58 L40 50 L78 38 L110 34 L150 30 L178 22 L200 24 L222 40 L250 36 L276 31 L300 28 L300 70 L0 70 Z" fill="url(#rating-fill)" />
          <path d="M0 58 L40 50 L78 38 L110 34 L150 30 L178 22 L200 24 L222 40 L250 36 L276 31 L300 28" fill="none" stroke="#fff" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
        </g>
      </svg>
      <div className="ui-rule mt-[0.9em] flex items-center gap-[1.2em] pt-[0.9em]">
        <span className="ui-muted">Roughly</span>
        <span className="flex items-center gap-[0.35em]"><CodeforcesMark /> 1600</span>
        <span className="flex items-center gap-[0.35em]"><ProviderGlyph id="leetcode" className="size-[1em] text-[#FFA116]" /> ~1750</span>
      </div>
    </div>
  );
}

/** One line from the rating's history: what moved it, and why. */
export function RatingMove() {
  return (
    <div className="ui arrive-card w-[21em] px-[1.1em] py-[0.85em]" style={at(1000)}>
      <p className="ui-mono text-[0.95em]"><span className="ui-muted">1130 →</span> <span style={{ color: C.green }}>1240</span></p>
      <p className="mt-[0.3em] text-[0.98em] leading-snug text-white/85">Repaired a loop boundary without a hint, after failing the same shape twice last week.</p>
    </div>
  );
}

/* ---- Where problems come from -------------------------------------------- */

const FOUND = [
  { source: "leetcode", title: "Minimum Window Substring", level: "Hard", why: "shrinks until valid" },
  { source: "leetcode", title: "Fruit Into Baskets", level: "Medium", why: "restores a count" },
  { source: "codeforces", title: "Books", level: "279B", why: "window under a budget" },
] as const;

/** Problems Spar found for the target, as the problem search lists them. */
export function Found() {
  return (
    <div className="ui w-[32em] overflow-hidden">
      <div className="flex items-center gap-[0.6em] px-[1.1em] py-[0.8em]">
        <Search className="ui-faint" />
        <span className="thinking-shimmer">Searching for your target</span>
        <span className="ui-faint ml-auto flex items-center gap-[0.35em]"><Spin /> 3 found</span>
      </div>
      {FOUND.map((problem, index) => (
        <div key={problem.title} style={at(250 + index * 160)} className={`arrive ui-rule flex items-center gap-[0.8em] px-[1.1em] py-[0.75em] ${index === 0 ? "bg-white/[0.05]" : ""}`}>
          {problem.source === "leetcode" ? <ProviderGlyph id="leetcode" className="size-[1.15em] shrink-0 text-[#FFA116]" /> : <CodeforcesMark style={{ width: "1.15em", height: "1.15em" }} />}
          <span className="min-w-0 flex-1">
            <span className="block truncate">{problem.title}</span>
            <span className="ui-faint block text-[0.88em]">{problem.why}</span>
          </span>
          <span className="ui-pill bg-white/[0.06] text-white/70">{problem.level}</span>
        </div>
      ))}
    </div>
  );
}

/* ---- Written for you ----------------------------------------------------- */

const VISIBLE_TEST = [
  [["kw", "from"], ["t", " src.tree "], ["kw", "import"], ["t", " root_value"]],
  [],
  [["t", "cases = ["]],
  [["t", "    ("], ["s", '"ordinary tree"'], ["t", ", ["], ["n", "4"], ["t", ", "], ["n", "7"], ["t", ", "], ["n", "9"], ["t", "], "], ["n", "4"], ["t", "),"]],
  [["t", "    ("], ["s", '"single node"'], ["t", ", ["], ["n", "5"], ["t", "], "], ["n", "5"], ["t", "),"]],
  [["t", "    ("], ["s", '"empty list"'], ["t", ", [], "], ["kw", "None"], ["t", "),"]],
  [["t", "    ("], ["s", '"missing root"'], ["t", ", ["], ["kw", "None"], ["t", ", "], ["n", "2"], ["t", "], "], ["kw", "None"], ["t", "),"]],
  [["t", "]"]],
] as const;

const TOKEN = { kw: C.code.keyword, s: C.code.string, n: C.code.number, t: C.code.text } as const;

/** The draft arriving: the stage that is writing it, and the file as it lands. */
export function Drafting() {
  return (
    <div className="ui w-[33em] overflow-hidden">
      <div className="flex items-center gap-[0.55em] px-[1.1em] py-[0.8em]">
        <Spin style={{ color: C.blue }} />
        <span className="thinking-shimmer">Drafting</span>
        <span>Identify a Tree’s Root</span>
        <span className="ui-pill ml-auto" style={{ color: C.green, background: "rgb(111 208 140 / 0.1)" }}>+63</span>
      </div>
      <div className="ui-rule bg-black/30">
        <div className="flex items-center gap-[0.5em] px-[1.1em] py-[0.55em] text-[0.92em]">
          <Py />
          <span className="ui-mono">tests/visible_test.py</span>
          <span className="thinking-shimmer ml-auto">writing</span>
        </div>
        <pre className="ui-mono px-[1.1em] pb-[1em] text-[0.92em] leading-[1.7]">
          {VISIBLE_TEST.map((line, index) => (
            <div key={index} className="arrive-slide flex" style={at(200 + index * 130)}>
              <span className="ui-faint w-[2em] shrink-0 select-none">{index + 1}</span>
              <span className={index === VISIBLE_TEST.length - 1 ? "streaming-caret text-white/70" : undefined}>
                {line.map(([kind, text], token) => (
                  <span key={token} style={{ color: TOKEN[kind] }}>{text}</span>
                ))}
              </span>
            </div>
          ))}
        </pre>
      </div>
    </div>
  );
}

/* ---- Checked before you see it -------------------------------------------- */

type Stage = { state: "done" | "failed"; verb: string; subject: string; runs?: Array<[string, string, boolean]> };

const STAGES: Stage[] = [
  { state: "done", verb: "Drafted", subject: "Identify a Tree’s Root" },
  { state: "done", verb: "Reviewer accepted", subject: "fit against your recent work" },
  {
    state: "failed",
    verb: "Validation failed",
    subject: "reference, tests and known-incorrect solution",
    runs: [
      ["Reference solution against every test", "28/28", true],
      ["Plausible wrong solution passes the visible tests", "1/1", false],
      ["Hidden tests catch the wrong solution", "25/25", true],
    ],
  },
  { state: "done", verb: "Repaired", subject: "the visible and hidden tests" },
  { state: "done", verb: "Validation passed", subject: "the repaired challenge" },
  { state: "done", verb: "Published", subject: "Identify a Tree’s Root" },
];

/* When each stage lands: a beat apart, with room after the failed validation
   for its runs to list. */
const STAGE_AT = STAGES.reduce<number[]>((times, stage, index) => {
  const previous = STAGES[index - 1];
  times.push(index === 0 ? 0 : times[index - 1]! + 260 + (previous?.runs ? previous.runs.length * 90 + 120 : 0));
  return times;
}, []);

/** The stage tree a generated challenge climbs before it reaches you. */
export function StageTree() {
  return (
    <div className="ui w-[32em] px-[1.2em] py-[1em]">
      <p className="ui-muted flex items-center gap-[0.4em]">Simplifying the tree question <span className="ui-faint">· 1m 44s</span></p>
      <div className="mt-[0.7em] border-l border-white/10 pl-[0.9em]">
        {STAGES.map((stage, index) => (
          <div key={stage.verb + stage.subject} className="arrive py-[0.32em]" style={at(STAGE_AT[index]!)}>
            <p className="flex items-center gap-[0.5em]">
              {stage.state === "done" ? <Check className="arrive-mark" style={{ color: C.green, ...at(STAGE_AT[index]! + 90) }} /> : <Warn className="arrive-mark" style={{ color: C.amber, ...at(STAGE_AT[index]! + 90) }} />}
              <span className="shrink-0 whitespace-nowrap" style={stage.state === "failed" ? { color: C.amber } : undefined}>{stage.verb}</span>
              <span className="ui-faint min-w-0 truncate">{stage.subject}</span>
            </p>
            {stage.runs ? (
              <div className="mt-[0.35em] ml-[1.5em] grid grid-cols-1 gap-[0.25em] text-[0.92em]">
                {stage.runs.map(([label, count, ok], run) => (
                  <p key={label} className="arrive-slide flex items-center gap-[0.5em]" style={at(STAGE_AT[index]! + 160 + run * 90)}>
                    {ok ? <Check style={{ color: C.green }} /> : <Cross style={{ color: C.red }} />}
                    <span className="ui-muted min-w-0 flex-1 truncate">{label}</span>
                    <span className="ui-pill ui-mono" style={ok ? { color: C.green, background: "rgb(111 208 140 / 0.1)" } : { color: C.red, background: "rgb(255 107 107 / 0.1)" }}>{count}</span>
                  </p>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---- The agent ----------------------------------------------------------- */

const REPLY =
  "You asked for something simpler, so I replaced counting children with identifying just the root — the first entry in the list. That’s a small step toward understanding how trees are represented before working with their links.".split(" ");
const REPLY_AT = 700;
const WORD = 28;

/** The turn in the chat: what the learner asked, what came back. */
export function AgentTurn() {
  return (
    <div className="ui w-[36em] px-[1.3em] py-[1.2em]">
      <div className="flex justify-end">
        <span className="arrive rounded-[1em] bg-white/[0.09] px-[0.9em] py-[0.45em]">simpler question</span>
      </div>
      <p className="arrive ui-faint mt-[1.2em] flex items-center gap-[0.3em]" style={at(380)}>Worked for 1m 44s <Chevron /></p>
      <p className="mt-[0.9em] text-[1.06em] leading-[1.6] text-white/90">
        {REPLY.map((word, index) => (
          <span key={index} className="arrive-word" style={at(REPLY_AT + index * WORD)}>{word} </span>
        ))}
      </p>
      <div style={at(REPLY_AT + REPLY.length * WORD + 120)} className="arrive-card mt-[1em] flex items-center gap-[0.8em] rounded-[0.9em] border border-white/[0.08] bg-black/25 px-[0.9em] py-[0.75em]">
        <span className="grid size-[2.2em] place-items-center rounded-[0.6em] bg-white/[0.06]"><Py /></span>
        <span className="min-w-0 flex-1">
          <span className="block"><span className="ui-faint">#2</span> Identify a Tree’s Root</span>
          <span className="ui-faint block text-[0.9em]">Foundation · 4 cases will grade it</span>
        </span>
        <Bookmark className="ui-faint" />
      </div>
    </div>
  );
}

/** A tool the agent called, as its row reads once it has finished. */
export function ToolRow({ text, delay = 0 }: { text: string; delay?: number }) {
  return (
    <div className="ui arrive-card flex items-center gap-[0.55em] px-[0.95em] py-[0.6em]" style={{ fontSize: "calc(var(--ui) * 1.1)", ...at(delay) }}>
      <Check className="arrive-mark" style={{ color: C.green, ...at(delay + 140) }} />
      <span>{text}</span>
    </div>
  );
}

/* ---- Yours --------------------------------------------------------------- */

/** The judge's own report: TAP, not a model's opinion. */
export function Judge() {
  const lines: Array<[string, string]> = [
    ["$ submit visible + hidden tests", "#a1a1aa"],
    ["ok - ordinary tree", C.green],
    ["ok - one-element tree", C.green],
    ["ok - null root", C.green],
    ["not ok - null root with later entries", C.red],
    ["  expected: 0", "#a1a1aa"],
    ["  actual: 2", "#a1a1aa"],
  ];
  return (
    <div className="ui w-[27em] overflow-hidden">
      <div className="flex items-center gap-[0.4em] px-[1em] py-[0.6em]">
        <span className="size-[0.6em] rounded-full bg-white/15" />
        <span className="size-[0.6em] rounded-full bg-white/15" />
        <span className="size-[0.6em] rounded-full bg-white/15" />
        <span className="ui-faint ml-[0.6em] text-[0.9em]">Terminal</span>
      </div>
      <pre className="ui-rule ui-mono bg-black/35 px-[1em] py-[0.9em] text-[0.95em] leading-[1.75]">
        {lines.map(([text, color], index) => (
          <div key={text} className="arrive-slide" style={{ color, ...at(index * 170) }}>{text}</div>
        ))}
      </pre>
    </div>
  );
}

const HISTORY = [
  { title: "Identify a Tree’s Root", tag: "Foundation", state: "Open", color: "#a1a1aa" },
  { title: "Count the Root’s Children", tag: "Foundation", state: "Replaced", color: C.violet },
  { title: "Minimum Window Substring", tag: "LeetCode", state: "Passed", color: C.green },
  { title: "Longest Substring Without Repeating Characters", tag: "LeetCode", state: "Passed", color: C.green },
];

/** History: every challenge, whatever became of it. */
export function History() {
  return (
    <div className="ui w-[27em] p-[0.9em]">
      <div className="flex gap-[0.3em] text-[0.92em]">
        {["All 23", "Open 3", "Passed 9", "Replaced 4"].map((tab, index) => (
          <span key={tab} className={`rounded-[0.5em] px-[0.55em] py-[0.15em] ${index === 0 ? "bg-white/[0.08]" : "ui-muted"}`}>{tab}</span>
        ))}
      </div>
      <div className="mt-[0.7em] grid grid-cols-1 gap-[0.45em]">
        {HISTORY.map((row, index) => (
          <div key={row.title} style={at(index * 110)} className="arrive flex items-center gap-[0.7em] rounded-[0.7em] border border-white/[0.07] bg-white/[0.03] px-[0.8em] py-[0.6em]">
            <span className="size-[1.4em] shrink-0 rounded-full" style={{ background: `radial-gradient(circle at 35% 30%, #fff8, ${row.color} 60%, #0004)` }} />
            <span className="min-w-0 flex-1">
              <span className="block truncate">{row.title}</span>
              <span className="ui-faint block text-[0.86em]">{row.tag}</span>
            </span>
            <span className="ui-pill" style={{ color: row.color, background: "rgb(255 255 255 / 0.05)" }}>{row.state}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Where things live: the keychain, the disk, and no analytics anywhere. */
export function WhereItLives() {
  const rows = [
    { icon: <Key />, label: "Provider credentials", value: "System keychain" },
    { icon: <Server />, label: "Challenge files and attempts", value: "This machine" },
    { icon: <Eye />, label: "Analytics and telemetry", value: "None" },
  ];
  return (
    <div className="ui w-[27em] p-[0.5em]">
      {rows.map((row, index) => (
        <div key={row.label} style={at(index * 120)} className={`arrive flex items-center gap-[0.75em] px-[0.8em] py-[0.8em] ${index ? "ui-rule" : ""}`}>
          <span className="grid size-[2em] place-items-center rounded-[0.55em] bg-white/[0.07] text-white/80">{row.icon}</span>
          <span className="min-w-0 flex-1">{row.label}</span>
          <span className="ui-muted">{row.value}</span>
        </div>
      ))}
    </div>
  );
}

/** A learner's message, floated above a card the way the chat draws it. */
export function Said({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  return <span className="ui-bubble arrive-card inline-block" style={at(delay)}>{children}</span>;
}
