import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { dismissToast, useToasts, type Toast } from "@/hooks/use-toasts";

/**
 * Where the app says things back.
 *
 * Built in the challenge card's own vocabulary rather than in the generic
 * notification shape every toast library ships: the same glass surface, the same
 * superellipse corner, the same tile on the left carrying the mark, the same
 * title-over-muted-line pair. A receipt for filing a challenge that looks like a
 * browser notification pasted over the window is a second design system arriving
 * one component at a time — which is exactly what the transcript card was cut
 * back from, and the note there is worth honouring here.
 *
 * Bottom right, above everything, and never over the composer's own width: the
 * learner is reading or typing in the middle of the window, and a panel that
 * lands there to say "saved" interrupts the thing it is congratulating them for.
 */
export function Toaster() {
  const toasts = useToasts();
  const reduced = useReducedMotion() ?? false;

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-end gap-2 p-4 sm:inset-x-auto sm:right-0"
    >
      <AnimatePresence initial={false}>
        {toasts.map((item) => (
          <ToastRow key={item.id} reduced={reduced} toast={item} />
        ))}
      </AnimatePresence>
    </div>
  );
}

const TONE_TILE: Record<NonNullable<Toast["tone"]>, string> = {
  neutral: "text-[var(--transcript-step-mark)]",
  success: "text-[var(--success)]",
  warning: "text-[var(--warning)]",
  danger: "text-destructive",
};

function ToastRow({ reduced, toast }: { reduced: boolean; toast: Toast }) {
  return (
    <motion.div
      animate={{ opacity: 1, y: 0, scale: 1 }}
      /* Comes up from where it lives rather than in from off-screen. The card it
         is shaped like arrives the same way, and a receipt that flies in from the
         edge reads as an alert — which is the one thing this never is. */
      exit={reduced ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.97 }}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 14, scale: 0.97 }}
      layout={!reduced}
      transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 340, damping: 30, mass: 0.7 }}
      className={cn(
        /* The transcript card's own surface and corner, so a receipt about a
           challenge is shaped like the challenge it is about. */
        "transcript-block shadow-[var(--app-shadow-overlay)] backdrop-blur-[10px]",
        "pointer-events-auto flex w-[min(21rem,calc(100vw-2rem))] min-w-0 items-center gap-2.5 px-2.5 py-2",
        "group/toast",
      )}
      role="status"
    >
      {toast.glyph && (
        <span
          className={cn(
            "grid size-7 shrink-0 place-items-center rounded-[var(--radius-md)] bg-[var(--color-background-elevated-secondary)] ring-[0.5px] ring-[var(--border-surface-strong)] [&>svg]:size-4",
            TONE_TILE[toast.tone ?? "neutral"],
          )}
        >
          {toast.glyph}
        </span>
      )}

      {toast.onClick ? (
        <button
          className="min-w-0 flex-1 rounded-md text-left outline-none focus-visible:ring-1 focus-visible:ring-ring"
          onClick={() => {
            toast.onClick?.();
            dismissToast(toast.id);
          }}
          type="button"
        >
          <Body toast={toast} />
        </button>
      ) : (
        <div className="min-w-0 flex-1"><Body toast={toast} /></div>
      )}

      {toast.action && (
        <button
          className="shrink-0 rounded-md px-1.5 py-1 text-ui-sm font-medium text-foreground/80 outline-none transition-colors duration-150 hover:bg-[var(--color-background-elevated-secondary)] hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
          onClick={() => {
            toast.action?.onClick();
            dismissToast(toast.id);
          }}
          type="button"
        >
          {toast.action.label}
        </button>
      )}

      {/* Shown on hover of the toast, like the bookmark on a row: a close button
          lit on every receipt is a row of crosses down the corner of the window,
          and these leave on their own anyway. Focus keeps it reachable. */}
      <button
        aria-label="Dismiss"
        className="grid size-6 shrink-0 place-items-center rounded-[var(--radius-md)] text-muted-foreground opacity-0 outline-none transition-[color,background-color,opacity] duration-150 hover:bg-[var(--color-background-elevated-secondary)] hover:text-foreground focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-ring group-hover/toast:opacity-100"
        onClick={() => dismissToast(toast.id)}
        type="button"
      >
        <X className="size-3.5" />
      </button>
    </motion.div>
  );
}

function Body({ toast }: { toast: Toast }) {
  return (
    <>
      <p className="truncate text-thread font-medium text-foreground">{toast.title}</p>
      {toast.detail && <p className="mt-px truncate text-ui-sm text-muted-foreground">{toast.detail}</p>}
    </>
  );
}
