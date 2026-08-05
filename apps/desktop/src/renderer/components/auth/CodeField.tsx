import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

const LENGTH = 6;

/** The six digits from an email, entered as one field wearing six boxes.
 *
 *  It is deliberately a single `<input>` behind six drawn cells rather than six
 *  inputs. Six inputs have to reimplement everything a text field already does —
 *  paste across boxes, backspace into the previous one, arrow keys, undo — and
 *  they get autofill wrong, which is the thing that matters most here: macOS
 *  offers a code straight from Messages, and it only offers it to a field with
 *  `autocomplete="one-time-code"`. So the input is real and transparent, spanning
 *  the whole row, and the cells are decoration that follows its value.
 *
 *  Completing the code submits. Nobody types the sixth digit of a code and then
 *  looks for a button, and the form is one step of a flow rather than something
 *  being composed — there is nothing to review before sending. */
export function CodeField({
  value,
  onChange,
  onComplete,
  disabled = false,
  invalid = false,
  autoFocus = false,
}: {
  value: string;
  onChange(value: string): void;
  onComplete(value: string): void;
  disabled?: boolean;
  invalid?: boolean;
  autoFocus?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  /* Held in a ref so the effect below can fire on the value alone: with
     `onComplete` in the dependency list, a parent that re-creates the callback on
     every render would submit the same code repeatedly. */
  const complete = useRef(onComplete);
  complete.current = onComplete;

  useEffect(() => {
    if (value.length === LENGTH) complete.current(value);
  }, [value]);

  return (
    <div
      className="group/code relative grid grid-cols-6 gap-1.5"
      onClick={() => input.current?.focus()}
      role="presentation"
    >
      <input
        aria-invalid={invalid}
        aria-label="Six-digit code"
        autoComplete="one-time-code"
        autoFocus={autoFocus}
        className="absolute inset-0 z-10 w-full bg-transparent text-transparent caret-transparent outline-none selection:bg-transparent disabled:pointer-events-none"
        disabled={disabled}
        inputMode="numeric"
        /* Digits only, and never longer than the code: a pasted "code: 123456"
           becomes 123456 rather than a field the learner has to clean up. */
        onChange={(event) => onChange(event.target.value.replace(/\D/g, "").slice(0, LENGTH))}
        ref={input}
        type="text"
        value={value}
      />
      {Array.from({ length: LENGTH }, (_, index) => {
        const filled = index < value.length;
        /* Where the caret is, or the last box once all six are in. The cell is
           lit only while the field has focus — a highlighted box on a blurred
           field reads as an error. */
        const next = index === Math.min(value.length, LENGTH - 1);
        return (
          <div
            aria-hidden
            className={cn(
              "grid h-11 place-items-center rounded-[var(--radius-md)] bg-[var(--color-background-elevated-secondary)] font-mono text-[0.95rem] tabular-nums transition-[box-shadow,color,background-color] duration-150",
              "shadow-[inset_0_0_0_0.5px_var(--border-strong)]",
              filled ? "text-foreground" : "text-muted-foreground/40",
              next && "group-focus-within/code:shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_30%,transparent)]",
              invalid && "shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--destructive)_50%,transparent)]",
              disabled && "opacity-60",
            )}
            key={index}
          >
            {value[index] ?? "·"}
          </div>
        );
      })}
    </div>
  );
}
