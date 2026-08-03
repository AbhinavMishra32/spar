import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowUp, ChevronDown, Loader2, Paperclip, Plus, Square, Unplug } from "lucide-react";
import { cn } from "@/lib/utils";
import { useProviders } from "../../hooks/use-providers";

const MAX_ROWS_HEIGHT = 176;

/**
 * The draft surface: a rounded field, with its toolbar on the row beneath rather
 * than inside the box. Keeping the controls out of the field is what lets the
 * field itself stay one uninterrupted piece of paper as the draft grows.
 *
 * Every composer in the app sends to the agent, so every one of them asks the
 * runtime whether there is a model to send to. Without one the send is refused
 * here rather than round-tripped into a red error: the answer is already known,
 * and the fix is a connection, not a retry.
 */
export function Composer({
  value,
  onChange,
  onSubmit,
  onStop,
  onAttach,
  onOpenSettings,
  busy = false,
  minLength = 1,
  placeholder = "Ask Spar anything…",
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
  onOpenSettings?(): void;
  busy?: boolean;
  /** Shortest draft the receiver will accept. A chat message needs one
   *  character; a session goal is validated at three in the main process, and
   *  refusing it here is what keeps that contract from arriving as an error. */
  minLength?: number;
  placeholder?: string;
  autoFocus?: boolean;
  hint?: React.ReactNode;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  className?: string;
}) {
  const field = useRef<HTMLTextAreaElement>(null);
  const [focused, setFocused] = useState(false);
  const { ready } = useProviders();

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

  const canSend = value.trim().length >= Math.max(1, minLength) && !busy && ready;

  const keydown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (canSend) onSubmit();
    }
  };

  return (
    <div className={cn("app-no-drag", className)}>
      <div className="composer-shell overflow-hidden">
        {/* Inside the shell rather than floated above it: this is a condition of
            the input, not a passing alert, and it stays until it is fixed. */}
        {!ready && (
          <div className="flex items-center gap-2 border-b border-[var(--glass-hairline)] px-3 py-2 text-ui">
            <Unplug className="size-3.5 shrink-0 text-warning" />
            <span className="min-w-0 flex-1 leading-[1.5] text-muted-foreground">
              <span className="font-medium text-foreground/90">No model provider connected.</span>{" "}
              Spar has nothing to answer with until you connect one.
            </span>
            {onOpenSettings && (
              <button
                className="shrink-0 rounded-md border border-[var(--border-strong)] px-2 py-0.5 text-ui font-medium text-foreground transition-colors hover:bg-accent"
                onClick={onOpenSettings}
                type="button"
              >
                Connect
              </button>
            )}
          </div>
        )}
        <div className="flex items-start gap-1.5 p-2" onClick={() => field.current?.focus()}>
        {onAttach && (
          <button
            aria-label="Attach context"
            className="grid size-7 shrink-0 place-items-center rounded-full bg-[var(--color-background-elevated-secondary)] text-muted-foreground transition-colors hover:text-foreground"
            onClick={(event) => { event.stopPropagation(); onAttach(); }}
            title="Attach context"
            type="button"
          >
            <Plus className="size-3.5" />
          </button>
        )}
        <textarea
          ref={field}
          autoFocus={autoFocus}
          // Vertical padding matches the 28px control height, so the first line
          // sits on the same centre line as the attach button beside it.
          className="app-scroll block w-full resize-none bg-transparent px-1.5 py-1 text-content leading-[1.55] outline-none placeholder:text-muted-foreground/65"
          onBlur={() => setFocused(false)}
          onChange={(event) => onChange(event.target.value)}
          onFocus={() => setFocused(true)}
          onKeyDown={keydown}
          placeholder={placeholder}
          rows={1}
          value={value}
        />
        </div>
      </div>

      <div className="mt-1.5 flex items-center gap-1 px-0.5">
        {leading}
        <div className="min-w-0 flex-1 truncate px-1 text-ui text-muted-foreground/65">
          {/* The notice above already says why nothing can be sent; a second
              line about Return would be instructions for a key that does nothing. */}
          {ready ? hint ?? (focused && !value ? "Return to send · Shift + Return for a new line" : null) : null}
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

/** Small pill used in the composer toolbar for model/effort style metadata. */
export function ComposerPill({
  icon: Icon,
  children,
  onClick,
  title,
  active = false,
  chevron = false,
  tone = "default",
}: {
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  onClick?(): void;
  title?: string;
  active?: boolean;
  chevron?: boolean;
  tone?: "default" | "warning";
}) {
  const Tag = onClick ? "button" : "span";
  return (
    <Tag
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[var(--radius-md)] px-2 text-ui transition-colors",
        tone === "warning" ? "text-warning" : "text-muted-foreground",
        onClick && "hover:bg-[var(--color-background-elevated-secondary)] hover:text-foreground",
        active && "bg-[var(--color-background-elevated-secondary)] text-foreground",
      )}
      onClick={onClick}
      title={title}
      type={onClick ? "button" : undefined}
    >
      {Icon && <Icon className="size-3.5" />}
      <span className="truncate">{children}</span>
      {chevron && <ChevronDown className="size-3.5 opacity-50" />}
    </Tag>
  );
}

export { Paperclip };
