import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, ArrowUp, Check, Loader2, Pencil } from "lucide-react";
import type { AskUserQuestionRequest } from "@spar/domain";
import { cn } from "@/lib/utils";
import { Inline } from "./Markdown";

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
 * Options are one line each, with their digit drawn as a key. They
 * used to carry a description underneath, and a three-option question became
 * six lines of prose to read before answering; the whole choice belongs in the
 * label where it can be scanned.
 */
export function AskUserQuestion({ request, busy, onSubmit }: { request: AskUserQuestionRequest; busy: boolean; onSubmit(answer: string): void }) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<number, Answer>>({});
  const customField = useRef<HTMLTextAreaElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const question = request.questions[step];
  /* No offered choices means the answer is prose, not a one-item menu whose
     item merely reveals the prose field. This is the native Construct shape. */
  const sole = question ? question.options.length === 0 && question.custom : false;
  const answer = answers[step] ?? (sole ? { type: "custom" as const, value: "" } : { type: "select" as const, labels: [] });
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
  const many = request.questions.length > 1;

  return (
    <div className="app-no-drag outline-none" onKeyDown={shortcut} ref={card} tabIndex={-1}>
      {/* Built on the composer's own measurements — the shell, its p-2
          interior, text at px-1.5 py-1 — so the question reads as the composer
          asking, not as a panel that has replaced it. */}
      <div className="composer-shell overflow-hidden p-2">
        {/* The question leads; the header is metadata about it, so it rides
            the top-right corner as a tag, carrying the step count when there
            is more than one question. */}
        <div className="flex items-start gap-3">
          <h3 className="min-w-0 flex-1 px-1.5 py-1 text-thread font-medium leading-[1.55] text-foreground">
            <Inline text={question.question} />
          </h3>
          <span className="mt-1 inline-flex shrink-0 items-center gap-1.5 rounded-full bg-foreground/[0.06] px-2 py-0.5 text-thread-tool text-muted-foreground">
            <span className="max-w-[12rem] truncate">{question.header}</span>
            {many && <span aria-hidden className="size-0.5 rounded-full bg-muted-foreground/60" />}
            {many && <span className="tabular-nums">{step + 1}/{request.questions.length}</span>}
          </span>
        </div>

        <div className="mt-1 flex flex-col" role={question.multiple ? "group" : "radiogroup"}>
          {question.options.map((option, index) => {
            const selected = answer.type === "select" && answer.labels.includes(option.label);
            return (
              <button
                key={option.label}
                aria-checked={selected}
                /* Flat, like everything else inside the composer: the fill
                   carries hover and selection, the key carries the shortcut. */
                className={cn(
                  "group/option flex w-full items-center gap-2.5 rounded-[var(--radius-item)] px-1.5 py-1 text-left outline-none transition-colors duration-150",
                  "focus-visible:bg-accent/40",
                  selected ? "bg-accent/70" : "hover:bg-accent/40",
                  busy && "pointer-events-none opacity-60",
                )}
                disabled={busy}
                onClick={() => select(option.label)}
                role={question.multiple ? "checkbox" : "radio"}
                type="button"
              >
                <Keycap multiple={question.multiple} selected={selected}>{index < DIGITS ? index + 1 : null}</Keycap>
                <span className={cn("min-w-0 flex-1 text-thread leading-[1.55] transition-colors", selected ? "text-foreground" : "text-foreground/80 group-hover/option:text-foreground")}>
                  <Inline text={option.label} />
                </span>
              </button>
            );
          })}

          {/* The way out of the offered choices. It is drawn as the composer's
              own field, placeholder and all, and clicking it turns that same
              row into the textarea in place. */}
          {question.custom && (custom ? (
            <div className={cn("flex items-start gap-2.5 rounded-[var(--radius-item)] px-1.5 py-1", !sole && "bg-accent/40")}>
              {!sole && (
                <span aria-hidden className="grid h-[1.55em] w-5 shrink-0 place-items-center text-thread text-foreground/70">
                  <Pencil className="size-3.5" />
                </span>
              )}
              <textarea
                ref={customField}
                aria-label="Your own answer"
                className={cn(
                  "app-scroll field-sizing-content block max-h-40 w-full resize-none bg-transparent text-thread leading-[1.55] outline-none placeholder:text-muted-foreground/65",
                  sole && "min-h-[4rem]",
                )}
                disabled={busy}
                onChange={(event) => setAnswers((current) => ({ ...current, [step]: { type: "custom", value: event.target.value } }))}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    proceed();
                  }
                  if (event.key === "Escape" && !sole && !answer.value) {
                    event.preventDefault();
                    setAnswers((current) => ({ ...current, [step]: { type: "select", labels: [] } }));
                    card.current?.focus();
                  }
                }}
                placeholder={sole ? "Answer in your own words." : "Whatever is actually true. It sets where Spar starts you."}
                rows={1}
                value={answer.value}
              />
            </div>
          ) : (
            <button
              className="group/own flex w-full items-center gap-2.5 rounded-[var(--radius-item)] px-1.5 py-1 text-left text-thread leading-[1.55] text-muted-foreground/65 outline-none transition-colors duration-150 hover:bg-accent/40 hover:text-muted-foreground focus-visible:bg-accent/40 disabled:pointer-events-none disabled:opacity-60"
              disabled={busy}
              onClick={writeOwn}
              type="button"
            >
              <span aria-hidden className="grid size-5 shrink-0 place-items-center">
                <Pencil className="size-3.5" />
              </span>
              Or type your own answer…
            </button>
          ))}
        </div>
      </div>

      {/* The composer's own toolbar row, to the pixel: plain hint left, one
          round control right, outside the shell. */}
      <div className="mt-1.5 flex items-center gap-1 px-0.5">
        <p className="min-w-0 flex-1 truncate px-1 text-thread text-muted-foreground/65">
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
            className="shrink-0 rounded-full px-2 py-1 text-thread text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-60"
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
 * The option's key. Its digit is the accelerator; filled, it is the selection.
 * A many-of question shows a check once ticked, because a filled "2" among
 * filled "1" and "3" does not read as three things chosen. Past the ninth
 * option there is no key, and the empty slot keeps the labels aligned.
 */
function Keycap({ multiple, selected, children }: { multiple: boolean; selected: boolean; children: React.ReactNode }) {
  return (
    <kbd
      aria-hidden
      className={cn(
        "grid size-5 shrink-0 place-items-center rounded-[0.3125rem] font-sans text-[0.6875rem] font-medium tabular-nums transition-[background-color,color,box-shadow] duration-150",
        selected
          ? "bg-foreground text-background"
          : children == null
            ? ""
            : "bg-foreground/[0.06] text-muted-foreground group-hover/option:text-foreground",
      )}
    >
      {selected && multiple ? <Check className="size-3" strokeWidth={3} /> : children}
    </kbd>
  );
}
