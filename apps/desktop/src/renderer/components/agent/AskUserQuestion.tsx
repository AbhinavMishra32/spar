import { useEffect, useMemo, useRef, useState } from "react";
import { Check, CircleHelp, Loader2 } from "lucide-react";
import type { AskUserQuestionRequest } from "@spar/domain";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type Answer = { type: "select"; labels: string[] } | { type: "custom"; value: string };

export function AskUserQuestion({ request, busy, onSubmit }: { request: AskUserQuestionRequest; busy: boolean; onSubmit(answer: string): void }) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<number, Answer>>({});
  const customField = useRef<HTMLTextAreaElement>(null);
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

  const proceed = () => {
    if (!currentComplete || busy) return;
    if (!last) setStep((value) => value + 1);
    else if (allComplete) onSubmit(serialized);
  };

  return (
    <TooltipProvider>
    <FieldGroup className="app-no-drag overflow-hidden rounded-xl bg-card shadow-[var(--app-shadow-overlay)] ring-[0.5px] ring-[var(--border-strong)]">
      <Field className="gap-3 p-2.5 pb-1">
        <div className="flex items-center justify-between gap-2 px-1">
          <p className="text-ui-sm font-medium text-muted-foreground">{question.header}</p>
          {request.questions.length > 1 && (
            <span className="text-ui-sm font-medium tabular-nums text-muted-foreground">{step + 1}/{request.questions.length}</span>
          )}
        </div>
        <h3 className="px-1 text-base font-medium leading-snug text-foreground">{question.question}</h3>
      </Field>

      <Field className="gap-0 px-2.5 py-1.5">
        {question.options.map((option, index) => {
          const selected = answer.type === "select" && answer.labels.includes(option.label);
          return (
            <Tooltip key={option.label}>
              <TooltipTrigger asChild>
                <Button
                  aria-pressed={selected}
                  className={cn("h-auto min-h-8 w-full justify-start px-3 py-2 text-left ring-0", selected && "bg-accent text-accent-foreground")}
                  disabled={busy}
                  onClick={() => select(option.label)}
                  type="button"
                  variant="ghost"
                >
                  <span className="w-4.5 shrink-0 text-sm leading-none font-medium tabular-nums text-muted-foreground">{index + 1}.</span>
                  <span className="min-w-0 flex-1 truncate text-accent-foreground">{option.label}</span>
                  <CircleHelp data-icon="inline-end" className="text-muted-foreground" />
                  {selected && <Check data-icon="inline-end" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left">{option.description}</TooltipContent>
            </Tooltip>
          );
        })}

        {question.custom && (
          answer.type === "custom" ? (
            <div className="rounded-md bg-secondary px-3 py-2">
              <div className="flex items-start gap-1">
                <span className="w-4.5 shrink-0 pt-1 text-sm leading-none font-medium tabular-nums text-muted-foreground">{question.options.length + 1}.</span>
                <Textarea
                  ref={customField}
                  className="field-sizing-content min-h-5 resize-none rounded-none border-0 bg-transparent p-0 text-sm leading-5 shadow-none focus-visible:border-transparent focus-visible:ring-0 dark:bg-transparent"
                  disabled={busy}
                  onChange={(event) => setAnswers((current) => ({ ...current, [step]: { type: "custom", value: event.target.value } }))}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                      event.preventDefault();
                      proceed();
                    }
                  }}
                  placeholder="Custom answer"
                  value={answer.value}
                />
              </div>
            </div>
          ) : (
            <Button
              className="h-auto min-h-8 w-full justify-start px-3 py-2 text-left text-muted-foreground ring-0"
              disabled={busy}
              onClick={() => setAnswers((current) => ({ ...current, [step]: { type: "custom", value: "" } }))}
              type="button"
              variant="ghost"
            >
              <span className="w-4.5 shrink-0 text-sm leading-none font-medium tabular-nums">{question.options.length + 1}.</span>
              <span className="min-w-0 flex-1">Custom answer</span>
            </Button>
          )
        )}
      </Field>

      <Field orientation="horizontal" className="justify-end gap-2 p-3 pt-0">
        {step > 0 && <Button disabled={busy} onClick={() => setStep((value) => value - 1)} type="button" variant="outline">Back</Button>}
        <Button disabled={busy || !currentComplete || (last && !allComplete)} onClick={proceed} type="button">
          {busy && <Loader2 data-icon="inline-start" className="animate-spin" />}
          {last ? busy ? "Submitting…" : "Submit answer" : "Next question"}
        </Button>
      </Field>
    </FieldGroup>
    </TooltipProvider>
  );
}
