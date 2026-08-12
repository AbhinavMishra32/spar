"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Mark } from "@/components/Mark";
import { ArrowGlyph } from "@/components/icons";
import { cn } from "@/lib/cn";

/**
 * The agent, playable.
 *
 * Everything here is scripted, and the panel says so under it. That matters:
 * the whole product turns on the agent not being the authority on whether you
 * passed, and a landing-page demo that quietly pretends to be a live model
 * would be making exactly the claim Spar refuses to make. So the answers are
 * fixed, they are the answers the app actually gives, and the one about being
 * told the answer is the one worth reading.
 */

type Answer = {
  /** What the agent says it is doing, before it does it. */
  phases: string[];
  body: string;
  /** The target it sets, where the reply sets one. */
  target?: { title: string; concepts: string[] };
  /** The ledger split, where the reply is about evidence. */
  ledger?: { earned: string; uncertain: string };
  /** The line under the reply, in the app's own mono. */
  note?: string;
};

const SCRIPTS: readonly { q: string; a: Answer }[] = [
  {
    q: "Why did you set me this?",
    a: {
      phases: ["reading your last four attempts", "checking what the evidence supports"],
      body: "Three of your last four attempts failed on the first iteration of a loop rather than on the algorithm. Twice you fixed it by changing < to <= and re-running until it went green, which tells me the boundary got repaired but not traced. So I am not setting sorting again. I want to see whether you can state the invariant before you run anything.",
      target: {
        title: "Trace TypeScript loop state to diagnose boundary-condition bugs",
        concepts: ["Loop boundary tracing", "Off-by-one", "Invariants"],
      },
      note: "target set · challenge #5 · written for you",
    },
  },
  {
    q: "Am I actually getting better?",
    a: {
      phases: ["reading the ability ledger", "keeping what is earned apart from what is guessed"],
      body: "Two different things, and I will not merge them. One your submissions have demonstrated more than once, and one I wrote down when I set a target and have not confirmed. The next challenge goes at the guess, because that is the only one worth spending your hour on.",
      ledger: {
        earned: "You repair loop boundaries across scalar counters and array scans — 4 passing submissions aimed here, 2 with no hint asked for.",
        uncertain: "I think the same holds inside a nested scan. Nothing you have submitted proves it.",
      },
      note: "earned · uncertain — drawn differently, never merged",
    },
  },
  {
    q: "Just tell me the answer.",
    a: {
      phases: ["no"],
      body: "I will talk about the invariant, about the case that fails, and about what your last attempt shows. I cannot move the verdict. That comes from running the committed tests and reading the exit code, and I am not in that path — nothing you say to me and nothing I decide I like about you changes it. If I could be talked into passing you, none of the rest of this would mean anything.",
      note: "verdict · tests only · no model in this path",
    },
  },
];

/** Whatever you type, honestly answered. */
const TYPED: Answer = {
  phases: ["reading the question", "checking what I can answer from here"],
  body: "In the app this runs against your own history — the attempt you have open, every test run behind it, and the ledger it has built about you. On a landing page I have none of that, so this panel can only show you the shape of the answer rather than give you one. The three questions above are transcripts of real sessions.",
  note: "demo · scripted · the app answers this from your own evidence",
};

/** How long each announced phase sits before the next one. */
const PHASE_MS = 620;

export function AgentDemo() {
  const [asked, setAsked] = useState<string>(SCRIPTS[0]!.q);
  const [answer, setAnswer] = useState<Answer>(SCRIPTS[0]!.a);
  const [step, setStep] = useState<number>(99);
  const [draft, setDraft] = useState("");
  const timers = useRef<number[]>([]);

  function play(question: string, next: Answer) {
    timers.current.forEach(window.clearTimeout);
    timers.current = [];
    setAsked(question);
    setAnswer(next);
    setStep(0);
    // Each phase is announced, then the answer lands. The app does the same
    // thing for the same reason: you should never be watching a spinner
    // wondering what it is doing.
    for (let i = 1; i <= next.phases.length + 1; i++) {
      timers.current.push(window.setTimeout(() => setStep(i), i * PHASE_MS));
    }
  }

  useEffect(() => () => timers.current.forEach(window.clearTimeout), []);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const question = draft.trim();
    if (!question) return;
    setDraft("");
    play(question, TYPED);
  }

  const done = step > answer.phases.length;

  return (
    <div className="card card-spotlight overflow-hidden">
      {/* Window chrome, so the panel reads as the app rather than as a widget. */}
      <div className="flex items-center gap-3 border-b border-line px-4 py-3 sm:px-5">
        <span className="flex gap-1.5" aria-hidden>
          <span className="size-2.5 rounded-full bg-white/12" />
          <span className="size-2.5 rounded-full bg-white/12" />
          <span className="size-2.5 rounded-full bg-white/12" />
        </span>
        <p className="ml-1 font-mono text-[11px] tracking-[0.12em] text-faint uppercase">Chat</p>
        <span className="ml-auto rounded-full border border-line px-2.5 py-1 font-mono text-[10px] text-ghost">
          your model, your key
        </span>
      </div>

      <div className="flex min-h-[26rem] flex-col gap-5 p-4 sm:p-6">
        {/* You. */}
        <p className="ml-auto max-w-[80%] rounded-2xl rounded-br-md border border-line bg-white/[0.05] px-4 py-2.5 text-[0.92rem]">
          {asked}
        </p>

        {/* The agent, announcing each phase before it runs it. */}
        <div className="flex flex-col gap-2.5">
          {answer.phases.map((phase, index) => (
            <p
              key={phase}
              className={cn(
                "flex items-center gap-2.5 font-mono text-[11.5px] transition-opacity duration-500",
                step > index ? "opacity-100" : "opacity-0",
                step > index + 1 ? "text-ghost" : "text-faint",
              )}
            >
              <Mark size={13} animated={step === index + 1} />
              {phase}
            </p>
          ))}
        </div>

        <div
          className={cn(
            "flex flex-col gap-5 transition-all duration-700",
            done ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0",
          )}
        >
          <p className="max-w-[62ch] text-[0.95rem] leading-relaxed text-muted">{answer.body}</p>

          {answer.target ? (
            <div className="rounded-2xl border border-line bg-white/[0.02] p-5">
              <p className="font-mono text-[10px] tracking-[0.18em] text-ghost uppercase">
                Challenge set for you
              </p>
              <p className="mt-2.5 font-display text-[1.05rem] leading-snug">{answer.target.title}</p>
              <ul className="mt-4 flex flex-wrap gap-2">
                {answer.target.concepts.map((concept) => (
                  <li
                    key={concept}
                    className="flex items-center gap-2 rounded-full border border-line px-3 py-1 text-[0.8rem] text-muted"
                  >
                    <span aria-hidden className="size-1.5 rounded-full bg-paper/60" />
                    {concept}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {answer.ledger ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-line bg-white/[0.04] p-5">
                <p className="font-mono text-[10px] tracking-[0.18em] text-paper uppercase">Earned</p>
                <p className="mt-2.5 text-[0.88rem] leading-relaxed text-muted">{answer.ledger.earned}</p>
              </div>
              {/* Dashed, because a hypothesis must never be drawn like a fact. */}
              <div className="rounded-2xl border border-dashed border-line p-5">
                <p className="font-mono text-[10px] tracking-[0.18em] text-faint uppercase">Uncertain</p>
                <p className="mt-2.5 text-[0.88rem] leading-relaxed text-muted">{answer.ledger.uncertain}</p>
              </div>
            </div>
          ) : null}

          {answer.note ? (
            <p className="font-mono text-[10.5px] tracking-[0.12em] text-ghost uppercase">{answer.note}</p>
          ) : null}
        </div>
      </div>

      {/* The composer, in the app's own shape: the field is a box with the plus
          inside it, and the controls sit on a row underneath rather than
          crowding the thing you are typing into. */}
      <div className="border-t border-line p-4 sm:p-5">
        <form onSubmit={onSubmit}>
          <div className="flex items-center gap-3 rounded-2xl border border-line bg-white/[0.03] px-3 py-2.5 transition-colors focus-within:border-line-strong">
            <span
              aria-hidden
              className="grid size-7 shrink-0 place-items-center rounded-lg border border-line text-faint"
            >
              +
            </span>
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Ask the agent something…"
              aria-label="Ask the agent something"
              className="min-w-0 flex-1 bg-transparent text-[0.95rem] text-paper placeholder:text-ghost focus:outline-none"
            />
            <button
              type="submit"
              aria-label="Send"
              className="grid size-8 shrink-0 place-items-center rounded-full bg-paper text-ink transition-transform hover:scale-105 active:scale-95"
            >
              <ArrowGlyph className="size-4" />
            </button>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {SCRIPTS.map((script) => (
              <button
                key={script.q}
                type="button"
                onClick={() => play(script.q, script.a)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-[0.82rem] transition-colors",
                  asked === script.q
                    ? "border-line-strong bg-white/[0.07] text-paper"
                    : "border-line text-muted hover:border-line-strong hover:text-paper",
                )}
              >
                {script.q}
              </button>
            ))}
          </div>
        </form>
      </div>
    </div>
  );
}
