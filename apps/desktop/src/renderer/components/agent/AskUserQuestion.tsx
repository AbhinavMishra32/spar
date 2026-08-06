import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, ArrowUp, Check, Loader2, Pencil } from "lucide-react";
import type { AskUserQuestionRequest } from "@spar/domain";
import { cn } from "@/lib/utils";

type Answer = { type: "select"; labels: string[] } | { type: "custom"; value: string };

/** Digit accelerators are offered for the first nine options and no further: a
 *  tenth would need two keystrokes and the hint would stop being true. */
const DIGITS = 9;

/**
 * The agent asking the learner one thing before it commits to a target.
 *
 * It stands in the composer's slot, so it is built as the composer: the same
 * glass shell at the same radius, and the same footer outside it — hint on the
 * left, one round send button on the right. A bordered card with its own pill
 * button was a different object arriving in the place the composer had been,
 * which is what made it read as borrowed from another app.
 *
 * Options are one line each. They used to carry a description underneath, and a
 * three-option question became six lines of prose to read before answering; the
 * whole choice belongs in the label where it can be scanned.
 */
export function AskUserQuestion({ request, busy, onSubmit }: { request: AskUserQuestionRequest; busy: boolean; onSubmit(answer: string): void }) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<number, Answer>>({});
  const customField = useRef<HTMLTextAreaElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const question = request.questions[step];
  const answer = answers[step] ?? { type: "select" as const, labels: [] };
  const last = step === request.questions.length - 1;
  const currentComplete = answer.type === "custom" ? answer.value.trim().length > 0 : answer.labels.length > 0;
  const allComplete = request.questions.every((_, index) => {
    const value = answers[index];
    return value?.type === "custom" ? value.value.trim().length > 0 : Boolean(value?.labels.length);
  });

  useEffect(() => {
    setStep(0);
    setAnswers({});
    /* Takes focus, which the digit accelerators need to be reachable at all —
       otherwise "press a number" is only true once you have tabbed here. Defensible
       because the session is suspended on this answer: there is nothing else to
       type into until it is given, and it also scrolls the prompt into view. */
    card.current?.focus({ preventScroll: false });
  }, [request.id]);

  useEffect(() => {
    if (answer.type === "custom") customField.current?.focus();
  }, [answer.type, step]);

  const serialized = useMemo(() => request.questions.map((item, index) => {
    const value = answers[index];
    const body = value?.type === "custom" ? value.value.trim() : value?.labels.join(", ") ?? "";
    return request.questions.length === 1 ? body : `${item.header}: ${body}`;
  }).join("\n"), [answers, request.questions]);

  if (!question) return null;

  const select = (label: string) => {
    const selected = answer.type === "select" ? answer.labels : [];
    const labels = question.multiple
      ? selected.includes(label) ? selected.filter((item) => item !== label) : [...selected, label]
      : [label];
    setAnswers((current) => ({ ...current, [step]: { type: "select", labels } }));
  };

  const writeOwn = () => setAnswers((current) => ({ ...current, [step]: { type: "custom", value: "" } }));

  const proceed = () => {
    if (!currentComplete || busy) return;
    if (!last) setStep((value) => value + 1);
    else if (allComplete) onSubmit(serialized);
  };

  /* Digits pick an option, Return commits — the two things the footer promises.
     Scoped to the card rather than the window, and both ignored while the custom
     field has the caret, which handles its own keys: typing "2 years of
     JavaScript" must not select the second option. */
  const shortcut = (event: React.KeyboardEvent) => {
    if (busy || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.target instanceof HTMLTextAreaElement) return;
    if (event.key === "Enter") {
      event.preventDefault();
      proceed();
      return;
    }
    const digit = Number(event.key);
    if (!Number.isInteger(digit) || digit < 1) return;
    const option = question.options[digit - 1];
    if (!option) return;
    event.preventDefault();
    select(option.label);
  };

  const custom = answer.type === "custom";
  const canSend = currentComplete && !busy && (!last || allComplete);

  return (
    <div className="app-no-drag" onKeyDown={shortcut} ref={card} tabIndex={-1}>
      <div className="composer-shell overflow-hidden p-2">
        {/* One muted line, not a titled header bar. A hairline under a label this
            short divides the surface into two rooms for no reason. */}
        <div className="flex items-center gap-1.5 px-1">
          <p className="min-w-0 flex-1 truncate text-ui-sm font-medium uppercase tracking-[0.06em] text-muted-foreground/80">
            {question.header}
          </p>
          {request.questions.length > 1 && (
            <span className="shrink-0 text-ui-sm tabular-nums text-muted-foreground/60">{step + 1}/{request.questions.length}</span>
          )}
        </div>

        {/* Reads at the size of a chat message, because that is what it is: the
            agent's turn, waiting on yours. */}
        <h3 className="mt-1 px-1 text-content font-medium leading-[1.5] text-foreground">{question.question}</h3>

        <div className="mt-2 flex flex-col gap-px" role={question.multiple ? "group" : "radiogroup"}>
          {question.options.map((option, index) => {
            const selected = answer.type === "select" && answer.labels.includes(option.label);
            return (
              <button
                key={option.label}
                aria-checked={selected}
                /* No border of its own. Rows boxed inside a boxed surface is a
                   pile of frames to read where the choice is the only thing that
                   matters; the fill carries selection and the hover carries
                   reachability, which is all a row of this kind needs. */
                className={cn(
                  "group/option flex w-full items-center gap-2 rounded-[var(--radius-item)] px-2 py-1.5 text-left transition-colors outline-none",
                  "focus-visible:ring-1 focus-visible:ring-ring",
                  selected ? "bg-accent/60" : "hover:bg-accent/35",
                  busy && "pointer-events-none opacity-60",
                )}
                disabled={busy}
                onClick={() => select(option.label)}
                role={question.multiple ? "checkbox" : "radio"}
                type="button"
              >
                <Marker multiple={question.multiple} selected={selected} />
                <span className={cn("min-w-0 flex-1 text-ui leading-[1.45]", selected ? "font-medium text-foreground" : "text-foreground/85")}>
                  {option.label}
                </span>
                {index < DIGITS && (
                  <kbd className="shrink-0 font-sans text-ui-sm tabular-nums text-muted-foreground/55 transition-colors group-hover/option:text-muted-foreground">
                    {index + 1}
                  </kbd>
                )}
              </button>
            );
          })}

          {/* Not an option in the list. Numbering it alongside the real choices
              made "Custom answer" look like a further thing the agent had offered,
              when it is the way out of the choices it offered. */}
          {question.custom && (custom ? (
            <div className="mt-0.5 rounded-[var(--radius-item)] bg-accent/35 px-2 py-1.5">
              <label className="flex items-center gap-1.5 text-ui-sm font-medium text-muted-foreground" htmlFor="ask-custom">
                <Pencil className="size-3" />
                In your own words
              </label>
              <textarea
                ref={customField}
                className="app-scroll mt-1 field-sizing-content block max-h-40 min-h-[2.25rem] w-full resize-none bg-transparent text-ui leading-[1.55] outline-none placeholder:text-muted-foreground/55"
                disabled={busy}
                id="ask-custom"
                onChange={(event) => setAnswers((current) => ({ ...current, [step]: { type: "custom", value: event.target.value } }))}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    proceed();
                  }
                }}
                placeholder="Whatever is actually true — it calibrates the first challenge."
                value={answer.value}
              />
            </div>
          ) : (
            <button
              className="inline-flex w-full items-center gap-2 rounded-[var(--radius-item)] px-2 py-1.5 text-ui text-muted-foreground transition-colors hover:bg-accent/35 hover:text-foreground disabled:pointer-events-none disabled:opacity-60"
              disabled={busy}
              onClick={writeOwn}
              type="button"
            >
              <Pencil className="size-3.5 shrink-0 text-muted-foreground/70" />
              None of these — let me write it
            </button>
          ))}
        </div>
      </div>

      {/* The composer's own toolbar row: hint left, one round control right,
          outside the shell rather than inside it. */}
      <div className="mt-1.5 flex items-center gap-1 px-0.5">
        <p className="min-w-0 flex-1 truncate px-1 text-ui text-muted-foreground/65">
          {busy
            ? "Sending…"
            : custom
              /* Digits are the textarea's own characters once it has the caret,
                 so the number hint would be a promise the field breaks. */
              ? "Return to send · Shift + Return for a new line"
              : question.multiple
                ? "Pick as many as apply · Return to send"
                : currentComplete ? "Return to send" : "Press a number, or click"}
        </p>
        {step > 0 && (
          <button
            className="shrink-0 rounded-full px-2 py-1 text-ui text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-60"
            disabled={busy}
            onClick={() => setStep((value) => value - 1)}
            type="button"
          >
            Back
          </button>
        )}
        <button
          aria-label={last ? "Send answer" : "Next question"}
          className={cn(
            "grid size-7 shrink-0 place-items-center rounded-full transition-[background-color,color,transform,opacity] duration-150",
            canSend
              ? "bg-primary text-primary-foreground hover:opacity-90 active:scale-95"
              : "bg-[var(--color-background-elevated-secondary)] text-muted-foreground/50",
          )}
          disabled={!canSend}
          onClick={proceed}
          title={last ? "Send answer" : "Next question"}
          type="button"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : last ? <ArrowUp className="size-3.5" /> : <ArrowRight className="size-3.5" />}
        </button>
      </div>
    </div>
  );
}

/**
 * The selected mark: a circle for one-of, a square for many-of, so the row says
 * which kind of choice it is before you click one and find out.
 */
function Marker({ multiple, selected }: { multiple: boolean; selected: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-3.5 shrink-0 place-items-center border transition-colors",
        multiple ? "rounded-[0.25rem]" : "rounded-full",
        selected
          ? "border-foreground bg-foreground text-background"
          : "border-[var(--border-strong)] group-hover/option:border-foreground/40",
      )}
    >
      {selected && <Check className="size-2.5" strokeWidth={3} />}
    </span>
  );
}
