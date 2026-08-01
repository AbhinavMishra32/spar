import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowUp, Loader2, Paperclip, Square } from "lucide-react";
import { cn } from "@/lib/utils";

const MAX_ROWS_HEIGHT = 176;

export function Composer({
  value,
  onChange,
  onSubmit,
  onStop,
  busy = false,
  placeholder = "Ask the Training Agent…",
  autoFocus = false,
  hint,
  leading,
  className,
}: {
  value: string;
  onChange(value: string): void;
  onSubmit(): void;
  onStop?(): void;
  busy?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  hint?: React.ReactNode;
  leading?: React.ReactNode;
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
      <textarea
        ref={field}
        autoFocus={autoFocus}
        className="app-scroll block w-full resize-none bg-transparent px-3 pt-2.5 pb-1 text-content leading-[1.5] outline-none placeholder:text-muted-foreground/70"
        onBlur={() => setFocused(false)}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => setFocused(true)}
        onKeyDown={keydown}
        placeholder={placeholder}
        rows={1}
        value={value}
      />
      <div className="flex items-center gap-1 px-2 pb-2 pt-0.5">
        {leading}
        <div className="min-w-0 flex-1 truncate text-ui-sm text-muted-foreground/70">
          {hint ?? (focused ? "Return to send · Shift + Return for a new line" : null)}
        </div>
        {busy && onStop ? (
          <button
            className="grid size-7 place-items-center rounded-full border border-border bg-[var(--color-background-elevated-secondary)] text-foreground transition hover:bg-accent"
            onClick={onStop}
            title="Stop"
            type="button"
          >
            <Square className="size-3 fill-current" />
          </button>
        ) : (
          <button
            className={cn(
              "grid size-7 place-items-center rounded-full transition",
              canSend
                ? "bg-primary text-primary-foreground hover:opacity-90"
                : "bg-[var(--color-background-elevated-secondary)] text-muted-foreground/60",
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
}: {
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  onClick?(): void;
  title?: string;
}) {
  const Tag = onClick ? "button" : "span";
  return (
    <Tag
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-ui-sm text-muted-foreground transition-colors",
        onClick && "hover:bg-[var(--color-background-elevated-secondary)] hover:text-foreground",
      )}
      onClick={onClick}
      title={title}
      type={onClick ? "button" : undefined}
    >
      {Icon && <Icon className="size-3.5" />}
      {children}
    </Tag>
  );
}

export { Paperclip };
