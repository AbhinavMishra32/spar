import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowUp, ChevronDown, Loader2, Paperclip, Plus, Square } from "lucide-react";
import { cn } from "@/lib/utils";

const MAX_ROWS_HEIGHT = 176;

export function Composer({
  value,
  onChange,
  onSubmit,
  onStop,
  onAttach,
  busy = false,
  placeholder = "Ask the Training Agent…",
  autoFocus = false,
  hint,
  leading,
  trailing,
  className,
}: {
  value: string;
  onChange(value: string): void;
  onSubmit(): void;
  onStop?(): void;
  onAttach?(): void;
  busy?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  hint?: React.ReactNode;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  className?: string;
}) {
  const field = useRef<HTMLTextAreaElement>(null);
  const [focused, setFocused] = useState(false);

  // Grows with the draft up to a ceiling, then scrolls — same behaviour as the
  // Aside composer, which never lets the input eat the transcript.
  const resize = useCallback(() => {
    const node = field.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, MAX_ROWS_HEIGHT)}px`;
  }, []);

  useLayoutEffect(resize, [value, resize]);

  // The first measurement can land before the stylesheet and webfont settle, which
  // reports a bogus scrollHeight. Re-measure once painted, and again once fonts load.
  useEffect(() => {
    const frame = requestAnimationFrame(resize);
    void document.fonts?.ready.then(resize);
    addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(frame);
      removeEventListener("resize", resize);
    };
  }, [resize]);

  const canSend = value.trim().length > 0 && !busy;

  const keydown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (canSend) onSubmit();
    }
  };

  return (
    <div className={cn("app-no-drag composer-shell", className)}>
      <div className="flex items-start gap-1 pl-1.5 pr-2 pt-1.5">
        {onAttach && (
          <button
            aria-label="Attach context"
            className="mt-px grid size-7 shrink-0 place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={onAttach}
            title="Attach context"
            type="button"
          >
            <Plus className="size-3.5" />
          </button>
        )}
        <textarea
          ref={field}
          autoFocus={autoFocus}
          className="app-scroll block w-full resize-none bg-transparent px-1.5 pb-1 pt-[0.3125rem] text-content leading-[1.55] outline-none placeholder:text-muted-foreground/65"
          onBlur={() => setFocused(false)}
          onChange={(event) => onChange(event.target.value)}
          onFocus={() => setFocused(true)}
          onKeyDown={keydown}
          placeholder={placeholder}
          rows={1}
          value={value}
        />
      </div>

      <div className="flex items-center gap-1 px-2 pb-1.5 pt-0.5">
        {leading}
        <div className="min-w-0 flex-1 truncate px-1 text-ui-sm text-muted-foreground/70">
          {hint ?? (focused && !value ? "Return to send · Shift + Return for a new line" : null)}
        </div>
        {trailing}
        {busy && onStop ? (
          <button
            aria-label="Stop"
            className="grid size-7 shrink-0 place-items-center rounded-full border border-[var(--border-strong)] bg-[var(--color-background-elevated-secondary)] text-foreground transition-colors hover:bg-accent"
            onClick={onStop}
            title="Stop"
            type="button"
          >
            <Square className="size-2.5 fill-current" />
          </button>
        ) : (
          <button
            aria-label="Send"
            className={cn(
              "grid size-7 shrink-0 place-items-center rounded-full transition-[background-color,color,transform,opacity] duration-150",
              canSend
                ? "bg-primary text-primary-foreground hover:opacity-90 active:scale-95"
                : "bg-[var(--color-background-elevated-secondary)] text-muted-foreground/50",
            )}
            disabled={!canSend}
            onClick={onSubmit}
            title="Send"
            type="button"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <ArrowUp className="size-3.5" />}
          </button>
        )}
      </div>
    </div>
  );
}

/** Small pill used in the composer footer for model/effort style metadata. */
export function ComposerPill({
  icon: Icon,
  children,
  onClick,
  title,
  active = false,
  chevron = false,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  onClick?(): void;
  title?: string;
  active?: boolean;
  chevron?: boolean;
}) {
  const Tag = onClick ? "button" : "span";
  return (
    <Tag
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-[min(var(--radius-md),11px)] px-1.5 text-ui-sm text-muted-foreground transition-colors",
        onClick && "hover:bg-[var(--color-background-elevated-secondary)] hover:text-foreground",
        active && "bg-[var(--color-background-elevated-secondary)] text-foreground",
      )}
      onClick={onClick}
      title={title}
      type={onClick ? "button" : undefined}
    >
      {Icon && <Icon className="size-3.5" />}
      <span className="truncate">{children}</span>
      {chevron && <ChevronDown className="size-3 opacity-50" />}
    </Tag>
  );
}

export { Paperclip };
