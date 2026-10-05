import { Fragment, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { IconArrowLeftRight, IconBug, IconCheckmark1, IconConsoleSimple, IconCrossMedium } from "central-icons";
import type { CentralIcon } from "@/lib/icons";
import type { Language } from "@spar/domain";
import { cn } from "@/lib/utils";
import { LANGUAGE_LABEL, LanguageGlyph } from "../common/LanguageGlyph";
import { AFTER_QUESTION, CoachLine, Key, SURFACE, Swap, Tilt } from "./kit";
import { EASE_OUT, GLIDE, POP, SPRING } from "./motion";

/* The warm-up: three rounds, about a minute, no stakes. It stands in for any
   explanation of how Spar works — the learner works, the coach watches, and the
   recap at the end is that loop with their own numbers in it. What it sees goes
   into the notebook, and the first Track opens on whatever went wrong.

   Every snippet is written by hand for each language, in that language's own
   idiom, because a translated-looking loop is the first thing someone who
   writes that language would notice. */

export type RoundId = "predict" | "bug" | "sorted";
export const ROUNDS: RoundId[] = ["predict", "bug", "sorted"];
export type Answer = { round: RoundId; pick: number; right: boolean; ms: number };

export const ROUND: Record<RoundId, { name: string; title: string; caption: string; Icon: CentralIcon }> = {
  predict: { name: "Predict", title: "What does this print?", caption: "", Icon: IconConsoleSimple },
  bug: { name: "Spot the bug", title: "Which line is wrong?", caption: "It says [3, 4] has a pair that sums to 6. It doesn't.", Icon: IconBug },
  sorted: { name: "What if", title: "What if it's sorted?", caption: "Find two that sum to 10. What's the fastest way?", Icon: IconArrowLeftRight },
};

/** Which option is right, per round. For the bug round it is the line. */
const ANSWER: Record<RoundId, number> = { predict: 1, bug: 2, sorted: 1 };
export const grade = (round: RoundId, pick: number) => pick === ANSWER[round];

type Snippet = { file: string; lines: string[] };

const PREDICT: Record<Language, Snippet> = {
  javascript: { file: "sum.js", lines: ["let total = 0;", "for (let i = 1; i < 4; i++) total += i;", "console.log(total);"] },
  typescript: { file: "sum.ts", lines: ["let total = 0;", "for (let i = 1; i < 4; i++) total += i;", "console.log(total);"] },
  python: { file: "sum.py", lines: ["total = 0", "for i in range(1, 4):", "    total += i", "print(total)"] },
  java: { file: "Sum.java", lines: ["int total = 0;", "for (int i = 1; i < 4; i++) total += i;", "System.out.println(total);"] },
  c: { file: "sum.c", lines: ["int total = 0;", "for (int i = 1; i < 4; i++) total += i;", "printf(\"%d\\n\", total);"] },
  cpp: { file: "sum.cpp", lines: ["int total = 0;", "for (int i = 1; i < 4; i++) total += i;", "std::cout << total << \"\\n\";"] },
  go: { file: "sum.go", lines: ["total := 0", "for i := 1; i < 4; i++ {", "    total += i", "}", "fmt.Println(total)"] },
  rust: { file: "sum.rs", lines: ["let mut total = 0;", "for i in 1..4 {", "    total += i;", "}", "println!(\"{total}\");"] },
  swift: { file: "sum.swift", lines: ["var total = 0", "for i in 1..<4 {", "    total += i", "}", "print(total)"] },
  ruby: { file: "sum.rb", lines: ["total = 0", "(1...4).each { |i| total += i }", "puts total"] },
};
const PREDICTIONS = ["3", "6", "10"];

/** The same bug in every language: the inner loop starts at `i`, so an element
 *  pairs with itself. Always the third line, and `fix` is that line corrected. */
const PAIR: Record<Language, Snippet & { fix: string }> = {
  javascript: {
    file: "pair.js",
    lines: ["function hasPair(xs, target) {", "  for (let i = 0; i < xs.length; i++)", "    for (let j = i; j < xs.length; j++)", "      if (xs[i] + xs[j] === target) return true;", "  return false;", "}"],
    fix: "    for (let j = i + 1; j < xs.length; j++)",
  },
  typescript: {
    file: "pair.ts",
    lines: ["function hasPair(xs: number[], target: number) {", "  for (let i = 0; i < xs.length; i++)", "    for (let j = i; j < xs.length; j++)", "      if (xs[i] + xs[j] === target) return true;", "  return false;", "}"],
    fix: "    for (let j = i + 1; j < xs.length; j++)",
  },
  python: {
    file: "pair.py",
    lines: ["def has_pair(xs, target):", "    for i in range(len(xs)):", "        for j in range(i, len(xs)):", "            if xs[i] + xs[j] == target:", "                return True", "    return False"],
    fix: "        for j in range(i + 1, len(xs)):",
  },
  java: {
    file: "Pair.java",
    lines: ["static boolean hasPair(int[] xs, int target) {", "    for (int i = 0; i < xs.length; i++)", "        for (int j = i; j < xs.length; j++)", "            if (xs[i] + xs[j] == target) return true;", "    return false;", "}"],
    fix: "        for (int j = i + 1; j < xs.length; j++)",
  },
  c: {
    file: "pair.c",
    lines: ["bool has_pair(const int *xs, int n, int target) {", "    for (int i = 0; i < n; i++)", "        for (int j = i; j < n; j++)", "            if (xs[i] + xs[j] == target) return true;", "    return false;", "}"],
    fix: "        for (int j = i + 1; j < n; j++)",
  },
  cpp: {
    file: "pair.cpp",
    lines: ["bool hasPair(const std::vector<int>& xs, int target) {", "    for (size_t i = 0; i < xs.size(); i++)", "        for (size_t j = i; j < xs.size(); j++)", "            if (xs[i] + xs[j] == target) return true;", "    return false;", "}"],
    fix: "        for (size_t j = i + 1; j < xs.size(); j++)",
  },
  go: {
    file: "pair.go",
    lines: ["func hasPair(xs []int, target int) bool {", "    for i := range xs {", "        for j := i; j < len(xs); j++ {", "            if xs[i]+xs[j] == target {", "                return true", "            }", "        }", "    }", "    return false", "}"],
    fix: "        for j := i + 1; j < len(xs); j++ {",
  },
  rust: {
    file: "pair.rs",
    lines: ["fn has_pair(xs: &[i32], target: i32) -> bool {", "    for i in 0..xs.len() {", "        for j in i..xs.len() {", "            if xs[i] + xs[j] == target {", "                return true;", "            }", "        }", "    }", "    false", "}"],
    fix: "        for j in i + 1..xs.len() {",
  },
  swift: {
    file: "Pair.swift",
    lines: ["func hasPair(_ xs: [Int], _ target: Int) -> Bool {", "    for i in xs.indices {", "        for j in i..<xs.count {", "            if xs[i] + xs[j] == target { return true }", "        }", "    }", "    return false", "}"],
    fix: "        for j in (i + 1)..<xs.count {",
  },
  ruby: {
    file: "pair.rb",
    lines: ["def has_pair?(xs, target)", "  (0...xs.size).each do |i|", "    (i...xs.size).each do |j|", "      return true if xs[i] + xs[j] == target", "    end", "  end", "  false", "end"],
    fix: "    (i + 1...xs.size).each do |j|",
  },
};

const APPROACHES = [
  { label: "Check every pair", cost: "O(n²)" },
  { label: "Two pointers, one from each end", cost: "O(n)" },
  { label: "Binary search for each partner", cost: "O(n log n)" },
];

/** How many things the round's number keys can pick. */
export const optionCount = (round: RoundId, language: Language) => (round === "bug" ? PAIR[language].lines.length : round === "predict" ? PREDICTIONS.length : APPROACHES.length);

/** What the coach says back. Never "wrong" — what happened, in a line. */
export function reaction(answer: Answer) {
  if (answer.round === "predict") {
    if (answer.right) return "Right: 1 + 2 + 3. The range stops before 4.";
    return answer.pick === 2 ? "It's 6: 1 + 2 + 3. The range stops before 4." : "It's 6. The loop adds each i up rather than counting them.";
  }
  if (answer.round === "bug") return answer.right ? "Yes. j starts at i, so 3 pairs with itself." : "It's line 3. j starts at i, so 3 pairs with itself.";
  if (answer.right) return "Yes. One pass from both ends, no extra memory.";
  return answer.pick === 0 ? "That works, but it's O(n²). Two pointers is one pass." : "Close: that's O(n log n). Two pointers does it in one pass.";
}

const seconds = (ms: number) => `${Math.max(1, Math.round(ms / 1000))}s`;

/** What the coach does next about each miss, in the recap, the notebook's plan
 *  and on the first Track. */
const NEXT: Record<RoundId, { next: string; plan: string; first: string }> = {
  predict: { next: "Where a loop really stops", plan: "Open on loop bounds, then build towards the goal.", first: "Loop bounds" },
  bug: { next: "Where an inner loop starts", plan: "Open on nested loops and where each one starts.", first: "Nested loops" },
  sorted: { next: "Two pointers on sorted input", plan: "Open on two pointers, and what sorted input buys.", first: "Two pointers" },
};

function missNote(answer: Answer) {
  if (answer.round === "predict") return answer.pick === 2 ? "Predict: read the range as inclusive (said 10, it prints 6)." : "Predict: counted the iterations instead of summing them (said 3).";
  if (answer.round === "bug") return `Spot the bug: blamed line ${answer.pick + 1}; the inner loop starting at i, on line 3, was it.`;
  return answer.pick === 0 ? "Sorted input: reached for checking every pair, not two pointers." : "Sorted input: chose a binary search per element over two pointers.";
}

/** The warm-up, as the notebook files it and the first Track opens on it. */
export function warmupNotes(answers: Answer[]) {
  const right = answers.filter((answer) => answer.right).length;
  const total = answers.reduce((sum, answer) => sum + answer.ms, 0);
  const slow = [...answers].sort((a, b) => b.ms - a.ms)[0];
  const miss = answers.find((answer) => !answer.right);
  return {
    lines: [
      `- ${right} of ${answers.length} right in ${seconds(total)}.${slow ? ` Slowest on ${ROUND[slow.round].name.toLowerCase()} (${seconds(slow.ms)}).` : ""}`,
      ...answers.filter((answer) => !answer.right).map((answer) => `- ${missNote(answer)}`),
    ],
    plan: miss ? NEXT[miss.round].plan : "Open a notch harder than the warm-up.",
    first: miss ? NEXT[miss.round].first : "Something harder",
  };
}

/* ---- Code ------------------------------------------------------------------ */

const KEYWORDS = new Set([
  "let", "const", "var", "mut", "for", "in", "if", "else", "return", "function", "def", "fn", "func", "while", "do", "end",
  "static", "true", "false", "True", "False", "int", "bool", "boolean", "size_t", "number",
]);
const TOKEN = /(\s+)|("(?:\\.|[^"\\])*")|(\b\d+\b)|([A-Za-z_][A-Za-z0-9_]*[!?]?)|([^\sA-Za-z0-9_])/g;

/** A line of code in the app's monochrome: keywords carry the weight, strings
 *  and punctuation step back. No colour, so no language looks favoured. */
function Code({ text }: { text: string }) {
  return (
    <>
      {[...text.matchAll(TOKEN)].map((match) => {
        const [whole, space, string, number, word] = match;
        const tone = space ? undefined
          : string ? "text-foreground/55"
          : number ? "text-foreground"
          : word ? (KEYWORDS.has(word) ? "font-medium text-foreground" : "text-foreground/80")
          : "text-foreground/45";
        return <span className={tone} key={match.index}>{whole}</span>;
      })}
    </>
  );
}

function CodeCard({ file, language, children, footer }: { file: string; language: Language; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <motion.div animate={{ opacity: 1, y: 0 }} className={cn(SURFACE, "overflow-hidden rounded-xl")} initial={{ opacity: 0, y: 18 }} transition={{ ...GLIDE, delay: AFTER_QUESTION }}>
      <div className="flex h-8 items-center gap-2 border-b border-border px-3">
        <LanguageGlyph className="size-3.5" language={language} />
        <span className="font-mono text-[0.625rem] text-muted-foreground">{file}</span>
      </div>
      <div className="py-2 font-mono text-[0.71875rem] leading-[1.75]">{children}</div>
      {footer}
    </motion.div>
  );
}

/* ---- Rounds ---------------------------------------------------------------- */

/** A verdict drawn on an option once the round is answered. */
function Verdict({ right }: { right: boolean }) {
  return (
    <motion.span
      animate={{ scale: 1, opacity: 1 }}
      className={cn("grid size-[1.125rem] place-items-center rounded-full", right ? "bg-[color-mix(in_oklab,var(--success)_18%,transparent)] text-[var(--success)]" : "bg-[color-mix(in_oklab,var(--destructive)_15%,transparent)] text-destructive")}
      initial={{ scale: 0, opacity: 0 }}
      transition={POP}
    >
      {right ? <IconCheckmark1 className="size-2.5" /> : <IconCrossMedium className="size-2.5" />}
    </motion.span>
  );
}

export function PredictRound({ language, answer, onPick }: { language: Language; answer: Answer | undefined; onPick(pick: number): void }) {
  const snippet = PREDICT[language];
  return (
    <div className="mx-auto w-full max-w-[26rem]">
      <CodeCard
        file={snippet.file}
        footer={
          <AnimatePresence initial={false}>
            {answer && (
              <motion.div animate={{ height: "auto", opacity: 1 }} className="overflow-hidden" initial={{ height: 0, opacity: 0 }} transition={SPRING}>
                <div className="flex items-center gap-2 border-t border-border px-3 py-2 font-mono text-[0.71875rem]">
                  <span className="text-muted-foreground/60">▸</span>
                  <motion.span animate={{ opacity: 1 }} className="text-foreground" initial={{ opacity: 0 }} transition={{ delay: 0.25 }}>6</motion.span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        }
        language={language}
      >
        {snippet.lines.map((line, index) => (
          <div className="flex gap-3 px-3" key={index}>
            <span className="w-4 shrink-0 select-none text-right tabular-nums text-muted-foreground/40">{index + 1}</span>
            <span className="whitespace-pre"><Code text={line} /></span>
          </div>
        ))}
      </CodeCard>
      <div className="mt-3 grid grid-cols-3 gap-2 [perspective:1000px]" role="radiogroup">
        {PREDICTIONS.map((option, index) => {
          const picked = answer?.pick === index;
          const right = index === ANSWER.predict;
          return (
            <motion.div animate={{ opacity: answer && !picked && !right ? 0.45 : 1, y: 0 }} initial={{ opacity: 0, y: 24 }} key={option} transition={{ ...GLIDE, delay: answer ? 0 : AFTER_QUESTION + 0.12 + index * 0.06 }}>
              <Tilt
                aria-checked={picked}
                className={cn(SURFACE, "flex h-14 w-full items-center justify-center rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-foreground/25", answer && "pointer-events-none")}
                max={8}
                onClick={() => onPick(index)}
                role="radio"
                whileTap={{ scale: 0.95 }}
              >
                {answer && (picked || right) && <span className={cn("absolute inset-0 rounded-[inherit]", right ? "shadow-[inset_0_0_0_1.5px_color-mix(in_oklab,var(--success)_60%,transparent)]" : "shadow-[inset_0_0_0_1.5px_color-mix(in_oklab,var(--destructive)_50%,transparent)]")} />}
                <span className="absolute left-2 top-2"><Key on={picked}>{index + 1}</Key></span>
                {answer && (picked || right) && <span className="absolute right-2 top-2"><Verdict right={right} /></span>}
                <span className="font-mono text-[1.25rem] font-medium tabular-nums text-foreground">{option}</span>
              </Tilt>
            </motion.div>
          );
        })}
      </div>
      <div className="mt-4 flex h-5 justify-center">{answer && <CoachLine key="reaction" text={reaction(answer)} />}</div>
    </div>
  );
}

export function BugRound({ language, answer, onPick }: { language: Language; answer: Answer | undefined; onPick(pick: number): void }) {
  const snippet = PAIR[language];
  return (
    <div className="mx-auto w-full max-w-[28rem]">
      <CodeCard file={snippet.file} language={language}>
        {snippet.lines.map((line, index) => {
          const bug = index === ANSWER.bug;
          const picked = answer?.pick === index;
          return (
            <Fragment key={index}>
              <button
                className={cn(
                  "flex w-full gap-3 px-3 text-left outline-none transition-colors",
                  !answer && "hover:bg-[color-mix(in_oklab,var(--foreground)_6%,transparent)] focus-visible:bg-[color-mix(in_oklab,var(--foreground)_6%,transparent)]",
                  answer && bug && "bg-[color-mix(in_oklab,var(--destructive)_9%,transparent)]",
                  answer && picked && !bug && "bg-[color-mix(in_oklab,var(--foreground)_5%,transparent)]",
                )}
                data-choice=""
                disabled={Boolean(answer)}
                onClick={() => onPick(index)}
                type="button"
              >
                <span className={cn("w-4 shrink-0 select-none text-right tabular-nums", answer && bug ? "text-destructive" : "text-muted-foreground/40")}>{index + 1}</span>
                <span className={cn("min-w-0 flex-1 whitespace-pre", answer && bug && "line-through decoration-[color-mix(in_oklab,var(--destructive)_55%,transparent)]")}><Code text={line} /></span>
                {answer && picked && <span className="self-center"><Verdict right={bug} /></span>}
              </button>
              <AnimatePresence initial={false}>
                {answer && bug && (
                  <motion.div animate={{ height: "auto", opacity: 1 }} className="overflow-hidden" initial={{ height: 0, opacity: 0 }} transition={{ ...SPRING, delay: 0.3 }}>
                    <div className="flex gap-3 bg-[color-mix(in_oklab,var(--success)_10%,transparent)] px-3">
                      <span className="w-4 shrink-0 select-none text-right text-[var(--success)]">+</span>
                      <span className="whitespace-pre"><Code text={snippet.fix} /></span>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </Fragment>
          );
        })}
      </CodeCard>
      <div className="mt-4 flex h-5 justify-center">{answer && <CoachLine key="reaction" text={reaction(answer)} />}</div>
    </div>
  );
}

const SORTED = [1, 3, 4, 6, 8, 11];
const TARGET = 10;
/** Two pointers, walking in: too big moves the right one, too small the left. */
const WALK: Array<[number, number]> = [[0, 5], [0, 4], [1, 4], [1, 3], [2, 3]];

export function SortedRound({ answer, onPick }: { answer: Answer | undefined; onPick(pick: number): void }) {
  /* Once it is answered, the right approach plays out on the array, whichever
     was picked: showing it run is the explanation. */
  const [step, setStep] = useState(-1);
  useEffect(() => {
    if (!answer) return setStep(-1);
    if (step >= WALK.length - 1) return;
    const timer = setTimeout(() => setStep((value) => value + 1), step < 0 ? 420 : 620);
    return () => clearTimeout(timer);
  }, [answer, step]);
  const [left, right] = step >= 0 ? WALK[step]! : [-1, -1];
  const sum = step >= 0 ? SORTED[left]! + SORTED[right]! : null;
  const found = step === WALK.length - 1;

  return (
    <div className="mx-auto w-full max-w-[26rem]">
      <motion.div animate={{ opacity: 1, y: 0 }} className={cn(SURFACE, "rounded-xl px-4 pb-3 pt-3.5")} initial={{ opacity: 0, y: 18 }} transition={{ ...GLIDE, delay: AFTER_QUESTION }}>
        <div className="flex justify-center gap-1.5">
          {SORTED.map((value, index) => {
            const at = index === left || index === right;
            return (
              <div className="flex w-10 flex-col items-center gap-1" key={value}>
                <motion.span
                  animate={{ scale: at && found ? [1, 1.12, 1] : 1 }}
                  className={cn(
                    "grid h-10 w-10 place-items-center rounded-lg font-mono text-[0.875rem] tabular-nums transition-colors duration-300",
                    at && found ? "bg-[color-mix(in_oklab,var(--success)_16%,transparent)] text-[var(--success)]"
                      : at ? "bg-foreground text-background"
                      : "bg-[color-mix(in_oklab,var(--foreground)_6%,transparent)] text-foreground",
                  )}
                  transition={{ duration: 0.4 }}
                >
                  {value}
                </motion.span>
                <span className="relative h-3 w-full">
                  {index === left && <motion.span className="absolute inset-x-0 text-center font-mono text-[0.5625rem] leading-3 text-muted-foreground" layoutId="pointer-left" transition={SPRING}>L</motion.span>}
                  {index === right && <motion.span className="absolute inset-x-0 text-center font-mono text-[0.5625rem] leading-3 text-muted-foreground" layoutId="pointer-right" transition={SPRING}>R</motion.span>}
                </span>
              </div>
            );
          })}
        </div>
        <p className="mt-1 h-4 text-center font-mono text-[0.6875rem] tabular-nums text-muted-foreground">
          {sum === null ? (
            <>sorted · target {TARGET}</>
          ) : (
            <Swap value={step}>
              <span className={cn(found && "text-[var(--success)]")}>
                {SORTED[left]} + {SORTED[right]} = {sum}
                {sum > TARGET ? " · too big, move R" : sum < TARGET ? " · too small, move L" : " · found it"}
              </span>
            </Swap>
          )}
        </p>
      </motion.div>
      <div className="mt-3 flex flex-col gap-1.5">
        {APPROACHES.map((option, index) => {
          const picked = answer?.pick === index;
          const best = index === ANSWER.sorted;
          return (
            <motion.button
              animate={{ opacity: answer && !picked && !best ? 0.5 : 1, y: 0 }}
              className={cn(SURFACE, "relative flex h-11 w-full items-center gap-3 rounded-xl px-3.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-foreground/25", !answer && "hover:bg-[color-mix(in_oklab,var(--foreground)_4%,var(--color-background-elevated-secondary))]")}
              data-choice=""
              disabled={Boolean(answer)}
              initial={{ opacity: 0, y: 18 }}
              key={option.label}
              onClick={() => onPick(index)}
              transition={{ ...GLIDE, delay: answer ? 0 : AFTER_QUESTION + 0.1 + index * 0.05 }}
              type="button"
              whileTap={answer ? {} : { scale: 0.98 }}
            >
              {answer && (picked || best) && <span className={cn("absolute inset-0 rounded-[inherit]", best ? "shadow-[inset_0_0_0_1.5px_color-mix(in_oklab,var(--success)_60%,transparent)]" : "shadow-[inset_0_0_0_1.5px_color-mix(in_oklab,var(--destructive)_50%,transparent)]")} />}
              <Key on={picked}>{index + 1}</Key>
              <span className="min-w-0 flex-1 truncate text-content text-foreground">{option.label}</span>
              <AnimatePresence>
                {answer && (
                  <motion.span animate={{ opacity: 1, x: 0 }} className="font-mono text-ui tabular-nums text-muted-foreground" initial={{ opacity: 0, x: 8 }} transition={{ ...SPRING, delay: 0.1 + index * 0.06 }}>
                    {option.cost}
                  </motion.span>
                )}
              </AnimatePresence>
              {answer && (picked || best) && <Verdict right={best} />}
            </motion.button>
          );
        })}
      </div>
      <div className="mt-4 flex h-5 justify-center">{answer && <CoachLine key="reaction" text={reaction(answer)} />}</div>
    </div>
  );
}

/* ---- Before and after ------------------------------------------------------ */

/** The three rounds, dealt face up, so the ask is visible before it is made. */
export function WarmupReady({ language }: { language: Language }) {
  return (
    <div className="mx-auto flex w-full max-w-[26rem] flex-col items-center">
      <div className="flex justify-center [perspective:1200px]">
        {ROUNDS.map((round, index) => {
          const { name, Icon } = ROUND[round];
          const tilt = (index - 1) * 6;
          return (
            <motion.div
              animate={{ opacity: 1, y: Math.abs(index - 1) * 6, rotate: tilt, rotateX: 0 }}
              className={cn(SURFACE, "-mx-1.5 flex h-[8.5rem] w-[7.25rem] flex-col justify-between rounded-xl p-3", index === 1 && "z-10")}
              initial={{ opacity: 0, y: 60, rotate: 0, rotateX: 30 }}
              key={round}
              transition={{ ...GLIDE, delay: AFTER_QUESTION + index * 0.09 }}
              whileHover={{ y: Math.abs(index - 1) * 6 - 8, transition: SPRING }}
            >
              <span className="flex items-start justify-between">
                <span className="grid size-8 place-items-center rounded-lg bg-[color-mix(in_oklab,var(--foreground)_6%,transparent)] text-muted-foreground">
                  <Icon className="size-4" />
                </span>
                <span className="font-mono text-[0.625rem] tabular-nums text-muted-foreground/70">{index + 1}/3</span>
              </span>
              <span className="text-content font-medium leading-tight text-foreground">{name}</span>
            </motion.div>
          );
        })}
      </div>
      <motion.p animate={{ opacity: 1 }} className="mt-7 flex items-center gap-2 text-ui text-muted-foreground" initial={{ opacity: 0 }} transition={{ delay: AFTER_QUESTION + 0.45 }}>
        <LanguageGlyph className="size-3.5" language={language} />
        In {LANGUAGE_LABEL[language]}, about a minute
      </motion.p>
    </div>
  );
}

/** The loop, with their numbers in it: the four beats of every Track, each
 *  filled in with what just happened, played through once. */
export function WarmupRecap({ answers }: { answers: Answer[] }) {
  const total = answers.reduce((sum, answer) => sum + answer.ms, 0);
  const slow = [...answers].sort((a, b) => b.ms - a.ms)[0];
  const miss = answers.find((answer) => !answer.right);
  const quick = answers.every((answer) => answer.ms < 6_000);
  const beats: Array<{ beat: string; detail: React.ReactNode }> = [
    {
      beat: "You work.",
      detail: (
        <span className="flex items-center gap-2.5">
          <span className="tabular-nums">{answers.length} rounds · {seconds(total)}</span>
          <span className="flex gap-1">{answers.map((answer) => <Verdict key={answer.round} right={answer.right} />)}</span>
        </span>
      ),
    },
    { beat: "I watch.", detail: quick || !slow ? "Quick on all three" : <>{ROUND[slow.round].name} took longest <span className="tabular-nums">· {seconds(slow.ms)}</span></> },
    { beat: "I write what's next.", detail: miss ? NEXT[miss.round].next : "Something harder" },
    { beat: "I bring it back.", detail: <Returns miss={Boolean(miss)} /> },
  ];
  return (
    <div className={cn(SURFACE, "mx-auto w-full max-w-[28rem] overflow-hidden rounded-xl")}>
      {beats.map(({ beat, detail }, index) => (
        <motion.div
          animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
          className={cn("flex min-h-[3.25rem] items-center justify-between gap-4 px-4", index > 0 && "border-t border-border")}
          initial={{ opacity: 0, x: -14, filter: "blur(6px)" }}
          key={beat}
          transition={{ ...SPRING, delay: AFTER_QUESTION + 0.1 + index * 0.42 }}
        >
          <span className="shrink-0 text-content font-medium text-foreground">{beat}</span>
          <span className="min-w-0 truncate text-right text-ui text-muted-foreground">{detail}</span>
        </motion.div>
      ))}
    </div>
  );
}

/** When it comes back: widening gaps, and never as the same question twice —
 *  which is how Spar's review actually schedules an insight. */
function Returns({ miss }: { miss: boolean }) {
  const stops = miss ? ["Today", "2 days", "6 days", "3 weeks"] : ["Today", "1 week", "3 weeks", "2 months"];
  const [reached, setReached] = useState(0);
  useEffect(() => {
    if (reached >= 1) return;
    const timer = setTimeout(() => setReached(1), 2_300);
    return () => clearTimeout(timer);
  }, [reached]);
  return (
    <span className="flex items-center gap-3">
      <span>{miss ? "In 2 days, as a new question" : "In a week, a harder one"}</span>
      <span aria-hidden className="relative flex items-center gap-2">
        <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-[color-mix(in_oklab,var(--foreground)_14%,transparent)]" />
        {stops.map((stop, index) => (
          <motion.span
            animate={index <= reached ? { scale: [1, 1.5, 1], opacity: 1 } : { scale: 1, opacity: 0.3 }}
            className={cn("relative size-1.5 rounded-full", index <= reached ? "bg-foreground" : "bg-foreground/50")}
            initial={false}
            key={stop}
            title={stop}
            transition={{ duration: 0.45, ease: EASE_OUT }}
          />
        ))}
      </span>
    </span>
  );
}
