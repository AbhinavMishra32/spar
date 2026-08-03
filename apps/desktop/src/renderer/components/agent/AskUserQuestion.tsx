import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Loader2, MessageCircleQuestion, Pencil } from "lucide-react";
import type { AskUserQuestionRequest } from "@spar/domain";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Answer = { type: "select"; labels: string[] } | { type: "custom"; value: string };

/** Digit accelerators are offered for the first nine options and no further: a
 *  tenth would need two keystrokes and the hint would stop being true. */
const DIGITS = 9;

/**
 * The agent asking the learner one thing before it commits to a target.
 *
 * Built out of the app's own parts rather than the form primitives: `Field` and
 * `FieldGroup` bring their own generous gaps, which is what left a hand's width of
 * empty card between the question and its options and again above the button. The
 * spacing here is explicit and tight — a 26px header, options at 6px apart, a
 * footer bar — so the card reads as one dense object the size of what it contains.
 *
 * The option descriptions are on the rows now instead of behind a help icon per
 * row. They are the part that makes a choice possible, and a column of question
 * marks was both an orphan on every line and a promise that the useful text was
 * somewhere else.
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

  /* Digits pick an option, which is what earns the hint on each row. Scoped to the
     card rather than the window, and ignored while the custom field has the caret —
     typing "2 years of JavaScript" must not select the second option. */
  const shortcut = (event: React.KeyboardEvent) => {
    if (busy || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.target instanceof HTMLTextAreaElement) return;
    const digit = Number(event.key);
    if (!Number.isInteger(digit) || digit < 1) return;
    const option = question.options[digit - 1];
    if (!option) return;
    event.preventDefault();
    select(option.label);
  };

  const custom = answer.type === "custom";

  return (
    <div
      ref={card}
      /* One surface, one border, nothing inside it drawn as a box. */
      className="app-no-drag overflow-hidden rounded-xl border border-border bg-card shadow-[var(--app-shadow-card)] outline-none"
      onKeyDown={shortcut}
      tabIndex={-1}
    >
      <div className="p-3">
        {/* One muted line, not a titled header bar. A hairline under a label this
            short divides the card into two rooms for no reason. */}
        <div className="flex items-center gap-1.5">
          <MessageCircleQuestion className="size-3 shrink-0 text-muted-foreground/70" />
          <p className="min-w-0 flex-1 truncate text-ui-sm font-medium text-muted-foreground">{question.header}</p>
          {request.questions.length > 1 && (
            <span className="shrink-0 text-ui-sm tabular-nums text-muted-foreground/70">{step + 1}/{request.questions.length}</span>
          )}
        </div>

        {/* Between body text and a page title. The question is the point of the
            card and has to lead, but at 16px it was larger than any heading the app
            uses and the card read as a landing page. */}
        <h3 className="mt-1.5 text-[0.875rem] font-medium leading-[1.45] text-foreground">{question.question}</h3>

        <div className="mt-2.5 flex flex-col" role={question.multiple ? "group" : "radiogroup"}>
          {question.options.map((option, index) => {
            const selected = answer.type === "select" && answer.labels.includes(option.label);
            return (
              <button
                key={option.label}
                aria-checked={selected}
                /* No border of its own. Four bordered rows inside a bordered card
                   is five boxes to read where the choice is the only thing that
                   matters; the fill carries selection and the hover carries
                   reachability, which is all a row of this kind needs. */
                className={cn(
                  "group/option -mx-1.5 flex w-[calc(100%+0.75rem)] items-start gap-2 rounded-md px-1.5 py-1.5 text-left transition-colors outline-none",
                  "focus-visible:ring-1 focus-visible:ring-ring",
                  selected ? "bg-accent/55" : "hover:bg-accent/30",
                  busy && "pointer-events-none opacity-60",
                )}
                disabled={busy}
                onClick={() => select(option.label)}
                role={question.multiple ? "checkbox" : "radio"}
                type="button"
              >
                <Marker multiple={question.multiple} selected={selected} />
                <span className="min-w-0 flex-1">
                  <span className="block text-ui font-medium text-foreground/90">{option.label}</span>
                  <span className="mt-0.5 block line-clamp-2 text-ui-sm leading-[1.5] text-muted-foreground">{option.description}</span>
                </span>
                {index < DIGITS && (
                  <kbd className="mt-px shrink-0 font-sans text-ui-sm tabular-nums text-muted-foreground/45">{index + 1}</kbd>
                )}
              </button>
            );
          })}

          {/* Not an option in the list. Numbering it alongside the real choices
              made "Custom answer" look like a fourth thing the agent had offered,
              when it is the way out of the choices it offered. */}
          {question.custom && (custom ? (
            <div className="-mx-1.5 mt-0.5 rounded-md bg-accent/30 px-1.5 py-1.5">
              <label className="flex items-center gap-1.5 text-ui-sm font-medium text-muted-foreground" htmlFor="ask-custom">
                <Pencil className="size-3" />
                In your own words
              </label>
              <textarea
                ref={customField}
                className="app-scroll mt-1 field-sizing-content block max-h-40 min-h-[2.25rem] w-full resize-none bg-transparent text-ui leading-[1.55] outline-none placeholder:text-muted-foreground/60"
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
              className="-mx-1.5 mt-0.5 inline-flex h-6 w-fit items-center gap-1.5 rounded-md px-1.5 text-ui-sm text-muted-foreground transition-colors hover:bg-accent/30 hover:text-foreground disabled:pointer-events-none disabled:opacity-60"
              disabled={busy}
              onClick={writeOwn}
              type="button"
            >
              <Pencil className="size-3" />
              None of these — let me write it
            </button>
          ))}
        </div>

        {/* The action sits in the card's own padding. A footer bar with its own
            fill and its own top hairline was a second surface inside the first,
            for one button. */}
        <div className="mt-3 flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-ui-sm text-muted-foreground/60">
            {question.multiple ? "Pick as many as apply" : custom ? "Return to send" : "Press a number, or click"}
          </p>
          {step > 0 && (
            <Button disabled={busy} onClick={() => setStep((value) => value - 1)} size="sm" type="button" variant="ghost">
              Back
            </Button>
          )}
          <Button disabled={busy || !currentComplete || (last && !allComplete)} onClick={proceed} size="sm" type="button">
            {busy && <Loader2 className="animate-spin" data-icon="inline-start" />}
            {last ? busy ? "Submitting…" : "Send answer" : "Next"}
          </Button>
        </div>
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
        "mt-[0.15rem] grid size-3.5 shrink-0 place-items-center border transition-colors",
        multiple ? "rounded-[0.25rem]" : "rounded-full",
        selected
          ? "border-foreground/80 bg-foreground/85 text-background"
          : "border-[var(--border-strong)] group-hover/option:border-foreground/40",
      )}
    >
      {selected && <Check className="size-2.5" strokeWidth={3} />}
    </span>
  );
}
