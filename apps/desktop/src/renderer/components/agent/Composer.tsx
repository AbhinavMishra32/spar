import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowUp, ChevronDown, Loader2, Paperclip, Plus, Square, Unplug } from "lucide-react";
import { cn } from "@/lib/utils";
import { useProviders } from "../../hooks/use-providers";
import { MentionPicker, type Mention, mentionRange, mentionSpans, useMentionSource } from "./Mentions";

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
  steerable = false,
  minLength = 1,
  placeholder = "Ask Spar anything…",
  autoFocus = false,
  focusRequest = 0,
  context,
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
  /** Whether a message sent during a running turn reaches that turn. When it
   *  does the field stays live, because the learner correcting course is the
   *  one moment they most need to be able to type — and the send button only
   *  yields to Stop once the draft is empty and there is nothing to say. */
  steerable?: boolean;
  /** Shortest draft the receiver will accept. A chat message needs one
   *  character; a session goal is validated at three in the main process, and
   *  refusing it here is what keeps that contract from arriving as an error. */
  minLength?: number;
  placeholder?: string;
  autoFocus?: boolean;
  focusRequest?: number;
  context?: React.ReactNode;
  hint?: React.ReactNode;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  className?: string;
}) {
  const field = useRef<HTMLTextAreaElement>(null);
  const mirror = useRef<HTMLDivElement>(null);
  const mentions = useMentionSource();
  /* Where the `@` being completed starts, and what has been typed after it.
     Recomputed from the field rather than remembered, because the caret can move
     without the value changing — an arrow key out of the mention is the end of
     it, and a remembered range would keep the panel open over nothing. */
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const syncMention = useCallback(() => {
    const node = field.current;
    if (!node || !mentions) return setMention(null);
    setMention(node.selectionStart === node.selectionEnd ? mentionRange(node.value, node.selectionStart) : null);
  }, [mentions]);

  /* Replaces the `@…` the learner was typing with the reference they picked, and
     puts the caret after it with a space — the mention is a word in a sentence
     they are still writing. */
  const insertMention = (picked: Mention) => {
    const node = field.current;
    if (!node || !mention) return;
    const next = `${value.slice(0, mention.start)}${picked.token} ${value.slice(node.selectionStart)}`;
    const caret = mention.start + picked.token.length + 1;
    setMention(null);
    onChange(next);
    /* Focus goes back now, not next frame. A click on a picker row lands on a
       button, and a learner who picks and keeps typing types into nothing for
       however long the frame takes to arrive. The caret has to wait for React to
       write the new value into the field, so only that part is deferred. */
    node.focus();
    requestAnimationFrame(() => node.setSelectionRange(caret, caret));
  };
  useEffect(() => {
    if (focusRequest) field.current?.focus();
  }, [focusRequest]);
  const [focused, setFocused] = useState(false);
  /* Counts sends rather than flagging one, so holding Return down animates each
     message instead of the first. */
  const [sent, setSent] = useState(0);
  const reduced = useReducedMotion();
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

  /* The draft cut at its tag boundaries. Recomputed on every keystroke, which is
     a scan of a few hundred characters against a handful of tokens — cheaper
     than the layout the textarea is doing on the same keystroke. */
  const tagged = useMemo(() => {
    const spans = mentionSpans(value);
    if (!spans.length) return [{ tag: false, text: value }];
    const pieces: Array<{ tag: boolean; text: string }> = [];
    let at = 0;
    for (const span of spans) {
      if (span.start > at) pieces.push({ tag: false, text: value.slice(at, span.start) });
      pieces.push({ tag: true, text: value.slice(span.start, span.end) });
      at = span.end;
    }
    if (at < value.length) pieces.push({ tag: false, text: value.slice(at) });
    return pieces;
  }, [value]);

  const drafted = value.trim().length >= Math.max(1, minLength);
  const canSend = drafted && (!busy || steerable) && ready;
  /* Stop is what an empty field offers while a turn runs. A draft in the field
     means the learner has something to say to the turn, and taking the send
     button away from them there is how the message used to get lost. */
  const showStop = busy && Boolean(onStop) && !(steerable && drafted);

  /* Every route out of the composer goes through here, so the arrow leaves the
     button whether the draft was sent with the mouse or with Return. */
  const send = () => {
    setSent((count) => count + 1);
    onSubmit();
  };

  const keydown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    /* The picker owns the arrows, Tab, Escape and Return while it is open — it
       binds them on the window at capture, so by the time one reaches here it
       has already been handled and this must not also send the draft. */
    if (mention && ["Enter", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab", "Escape"].includes(event.key)) return;
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (canSend) send();
    }
  };

  return (
    <div className={cn("app-no-drag", className)}>
      <div className="relative">
      {mention && mentions && (
        <MentionPicker onClose={() => setMention(null)} onPick={insertMention} query={mention.query} source={mentions} />
      )}
      <div className="composer-shell overflow-hidden">
        {/* Inside the shell rather than floated above it: this is a condition of
            the input, not a passing alert, and it stays until it is fixed. */}
        {!ready && (
          <div className="flex items-center gap-2 border-b border-[var(--border-surface-strong)] px-3 py-2 text-thread">
            <Unplug className="size-3.5 shrink-0 text-warning" />
            <span className="min-w-0 flex-1 leading-[1.5] text-muted-foreground">
              <span className="font-medium text-foreground/90">No model provider connected.</span>{" "}
              Spar has nothing to answer with until you connect one.
            </span>
            {onOpenSettings && (
              <button
                className="shrink-0 rounded-md border border-[var(--border-strong)] px-2 py-0.5 text-thread font-medium text-foreground transition-colors hover:bg-accent"
                onClick={onOpenSettings}
                type="button"
              >
                Connect
              </button>
            )}
          </div>
        )}
        {context}
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
        {/* The field and its shadow, in that order on screen and the reverse in
            the stack. The learner's own text stays in the textarea, where the
            caret, the selection, undo and the input method all keep working; the
            layer underneath carries nothing but the tag shapes, drawn from the
            same characters at the same metrics so a tag sits exactly under the
            words it belongs to however the draft wraps. */}
        <div className="relative min-w-0 flex-1">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words px-1.5 py-1 text-thread leading-[1.55] text-transparent"
            ref={mirror}
          >
            {tagged.map((piece, index) =>
              piece.tag
                ? (
                  <span
                    className="rounded-[5px] bg-[color-mix(in_oklab,var(--reference)_16%,transparent)] ring-[0.5px] ring-inset ring-[color-mix(in_oklab,var(--reference)_40%,transparent)] [box-decoration-break:clone]"
                    key={index}
                  >
                    {piece.text}
                  </span>
                )
                : <span key={index}>{piece.text}</span>,
            )}
            {/* A draft ending in a newline leaves the mirror a line short, and
                the last tag would ride up with it. */}
            {"\n"}
          </div>
          <textarea
            ref={field}
            autoFocus={autoFocus}
            // Vertical padding matches the 28px control height, so the first line
            // sits on the same centre line as the attach button beside it.
            className="app-scroll relative block w-full resize-none bg-transparent px-1.5 py-1 text-thread leading-[1.55] outline-none placeholder:text-muted-foreground/65"
            onBlur={() => { setFocused(false); setMention(null); }}
            onChange={(event) => { onChange(event.target.value); queueMicrotask(syncMention); }}
            onFocus={() => setFocused(true)}
            onKeyDown={keydown}
            onKeyUp={syncMention}
            onClick={syncMention}
            onScroll={(event) => { if (mirror.current) mirror.current.scrollTop = event.currentTarget.scrollTop; }}
            onSelect={syncMention}
            placeholder={placeholder}
            rows={1}
            value={value}
          />
        </div>
        </div>
      </div>
      </div>

      <div className="mt-1.5 flex items-center gap-1 px-0.5">
        {leading}
        <div className="min-w-0 flex-1 truncate px-1 text-thread text-muted-foreground/65">
          {/* The notice above already says why nothing can be sent; a second
              line about Return would be instructions for a key that does nothing.
              Nothing is said on a plain empty focused composer either — Return
              sends, which is what Return does in every composer the learner has
              used, and a line of standing instructions under the field is one
              more thing to read past on the way to typing. The steering line
              stays, because that one is not obvious: the turn is already
              running, and where the message lands is the question. */}
          {ready ? hint ?? (busy && steerable && drafted ? "Return to send — the agent picks this up at its next step" : null) : null}
        </div>
        {trailing}
        {showStop && onStop ? (
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
              "grid size-7 shrink-0 place-items-center overflow-hidden rounded-full transition-[background-color,color,transform,opacity] duration-150",
              canSend
                ? "bg-primary text-primary-foreground hover:opacity-90 active:scale-95"
                : "bg-[var(--color-background-elevated-secondary)] text-muted-foreground/50",
            )}
            disabled={!canSend}
            onClick={send}
            title="Send"
            type="button"
          >
            {/* The arrow goes with the message. It leaves through the top of the
                button and the next one rises into its place from the bottom,
                which is the same short journey the bubble makes into the
                transcript — the button is where the send starts and the send is
                the only thing it does. `overflow-hidden` on the button is what
                keeps that a departure rather than an arrow flying across the
                toolbar. */}
            <AnimatePresence initial={false} mode="popLayout">
              <motion.span
                animate={{ y: 0, opacity: 1 }}
                className="inline-flex"
                exit={reduced ? { opacity: 0 } : { y: -18, opacity: 0 }}
                initial={reduced ? false : { y: 14, opacity: 0 }}
                key={busy && !steerable ? "busy" : `idle-${sent}`}
                transition={reduced ? { duration: 0 } : { type: "spring", visualDuration: 0.34, bounce: 0.24 }}
              >
                {busy && !steerable ? <Loader2 className="size-3.5 animate-spin" /> : <ArrowUp className="size-3.5" />}
              </motion.span>
            </AnimatePresence>
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
        "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[var(--radius-md)] px-2 text-thread transition-colors",
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
