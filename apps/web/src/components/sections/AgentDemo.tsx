"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Mark } from "@/components/Mark";
import { ArrowGlyph } from "@/components/icons";
import { cn } from "@/lib/cn";

/**
 * The agent, playable.
 *
 * Everything is scripted, and the panel says so. That matters: the product
 * turns on the agent not being the authority on whether you passed, so a demo
 * that quietly pretended to be a live model would be making the one claim Spar
 * refuses to make.
 *
 * The replies are short on purpose. What is interesting here is what the agent
 * *produces* — a target, a split ledger, a refusal — not how much it can say
 * about it, and a paragraph in a chat bubble is the least interesting way to
 * show any of that.
 */

type Reply = {
  phases: string[];
  say: string;
  target?: { title: string; concepts: string[] };
  ledger?: { earned: string; uncertain: string };
  verdict?: string;
};

const SCRIPTS: readonly { q: string; a: Reply }[] = [
  {
    q: "Why this challenge?",
    a: {
      phases: ["reading your last four attempts", "checking what the evidence supports"],
      say: "You had the window model right in all four. Three of them failed the same way: you shrank once, the window was still invalid, and you carried on. So this one is that, on purpose — several removals before it is valid again.",
      target: {
        title: "Restore the invariant when one removal isn't enough",
        concepts: ["Variable-size windows", "Invariant restoration", "Frequency state"],
      },
    },
  },
  {
    q: "Am I getting better?",
    a: {
      phases: ["reading the ability map"],
      say: "Two things, and I will not merge them.",
      ledger: {
        earned: "Recognises variable-size window problems and maintains frequency state. 4 passing submissions, 2 with no hint asked for.",
        uncertain: "Whether that survives outside a string problem. Nothing you have submitted tests it, so I want a transfer next.",
      },
    },
  },
  {
    q: "Just tell me the answer.",
    a: {
      phases: ["no"],
      say: "I will talk about the invariant and the case that fails. I cannot move the verdict — it comes from running the committed cases and reading the exit code, and I am not in that path.",
      verdict: "graded by execution · exit code 1 · 2 of 7 cases failing",
    },
  },
];

const TYPED: Reply = {
  phases: ["reading the question"],
  say: "In the app this runs against your own history — the attempt you have open, every run behind it, the ability map it has built from all of them. From a landing page I have none of that.",
};

/** How long each announced phase sits before the next one. */
const PHASE_MS = 620;

export function AgentDemo() {
  const [asked, setAsked] = useState(SCRIPTS[0]!.q);
  const [reply, setReply] = useState<Reply>(SCRIPTS[0]!.a);
  const [step, setStep] = useState(99);
  const [draft, setDraft] = useState("");
  const timers = useRef<number[]>([]);

  function play(question: string, next: Reply) {
    timers.current.forEach(window.clearTimeout);
    timers.current = [];
    setAsked(question);
    setReply(next);
    setStep(0);
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

  const done = step > reply.phases.length;

  return (
    <div className="card card-spotlight flex h-full flex-col overflow-hidden">
      <div className="flex items-center gap-3 border-b border-line px-5 py-3">
        <Mark size={14} className="opacity-70" />
        <p className="font-mono text-[10.5px] tracking-[0.16em] text-faint uppercase">Chat</p>
        <span className="ml-auto rounded-full border border-line px-2.5 py-1 font-mono text-[10px] text-ghost">
          your model, your key
        </span>
      </div>

      <div className="flex min-h-[24rem] flex-1 flex-col gap-5 p-5 sm:p-6">
        <p className="ml-auto max-w-[78%] rounded-2xl rounded-br-md bg-white/[0.07] px-4 py-2.5 text-[0.92rem]">
          {asked}
        </p>

        <div className="flex flex-col gap-2">
          {reply.phases.map((phase, index) => (
            <p
              key={phase}
              className={cn(
                "flex items-center gap-2.5 font-mono text-[11px] transition-opacity duration-500",
                step > index ? "opacity-100" : "opacity-0",
                step > index + 1 ? "text-ghost" : "text-faint",
              )}
            >
              <Mark size={12} animated={step === index + 1} />
              {phase}
            </p>
          ))}
        </div>

        <div
          className={cn(
            "flex flex-col gap-4 transition-all duration-700",
            done ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0",
          )}
        >
          <p className="max-w-[58ch] text-[0.94rem] leading-relaxed text-muted">{reply.say}</p>

          {reply.target ? (
            <div className="rounded-2xl border border-line bg-white/[0.03] p-5">
              <div className="flex items-center gap-2.5">
                <span className="font-mono text-[10px] tracking-[0.16em] text-ghost uppercase">
                  Challenge #5
                </span>
                <span className="rounded-md bg-amber-400/15 px-2 py-0.5 font-mono text-[10px] text-amber-200/90">
                  Developing
                </span>
              </div>
              <p className="mt-3 font-display text-[1.02rem] leading-snug">{reply.target.title}</p>
              <ul className="mt-4 flex flex-wrap gap-2">
                {reply.target.concepts.map((concept) => (
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

          {reply.ledger ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-line bg-white/[0.05] p-4">
                <p className="flex items-center gap-2 font-mono text-[10px] tracking-[0.16em] text-paper uppercase">
                  <span aria-hidden className="size-1.5 rounded-full bg-paper" />
                  Earned
                </p>
                <p className="mt-2.5 text-[0.86rem] leading-relaxed text-muted">{reply.ledger.earned}</p>
              </div>
              {/* Dashed, because a hypothesis must never be drawn like a fact. */}
              <div className="rounded-2xl border border-dashed border-line p-4">
                <p className="flex items-center gap-2 font-mono text-[10px] tracking-[0.16em] text-faint uppercase">
                  <span aria-hidden className="size-1.5 rounded-full border border-faint" />
                  Uncertain
                </p>
                <p className="mt-2.5 text-[0.86rem] leading-relaxed text-muted">{reply.ledger.uncertain}</p>
              </div>
            </div>
          ) : null}

          {reply.verdict ? (
            <p className="inline-flex w-fit items-center gap-2.5 rounded-full border border-line bg-white/[0.03] px-3.5 py-1.5 font-mono text-[10.5px] tracking-[0.08em] text-faint">
              <span aria-hidden className="size-1.5 rounded-full bg-[var(--color-fringe-r)]" />
              {reply.verdict}
            </p>
          ) : null}
        </div>
      </div>

      {/* The composer, in the app's own shape: the plus inside the field, the
          controls on a row underneath rather than crowding what you type into. */}
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
