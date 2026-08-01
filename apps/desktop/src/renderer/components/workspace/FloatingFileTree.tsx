import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { ActiveQuestion } from "@spar/domain";
import { FileTree } from "./FileTree";

/**
 * A floating file browser anchored under its trigger. It materialises the way
 * macOS panels do — de-blurring and settling into place rather than popping —
 * so it reads as a surface arriving above the editor, not a div appearing.
 *
 * `MotionConfig reducedMotion="user"` is set at the root, so the whole sequence
 * degrades to a plain cross-fade when the system asks for reduced motion.
 */
export function FloatingFileTree({
  open,
  files,
  activePath,
  onSelect,
  onClose,
}: {
  open: boolean;
  files: ActiveQuestion["files"];
  activePath: string;
  onSelect(path: string): void;
  onClose(): void;
}) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Swallows the next click anywhere else so the panel dismisses like a menu. */}
          <div className="fixed inset-0 z-40" onMouseDown={onClose} />

          <motion.div
            ref={panel}
            animate={{ opacity: 1, scale: 1, y: 0, filter: "blur(0px)" }}
            className="floating-surface absolute left-1.5 top-[calc(100%+4px)] z-50 w-60 origin-top-left overflow-hidden"
            exit={{ opacity: 0, scale: 0.985, y: -4, filter: "blur(6px)" }}
            initial={{ opacity: 0, scale: 0.96, y: -8, filter: "blur(14px)" }}
            transition={{ type: "spring", stiffness: 460, damping: 34, mass: 0.7 }}
          >
            <div className="flex h-7 items-center justify-between border-b border-border/60 px-2.5">
              <span className="text-ui-sm font-medium tracking-[0.06em] text-muted-foreground/80">FILES</span>
              <span className="text-ui-sm tabular-nums text-muted-foreground/60">{files.length}</span>
            </div>

            <motion.div
              animate="open"
              className="app-scroll max-h-[19rem] overflow-y-auto p-1.5"
              initial="closed"
              transition={{ staggerChildren: 0.018, delayChildren: 0.04 }}
              variants={{ open: {}, closed: {} }}
            >
              <motion.div
                variants={{
                  closed: { opacity: 0, y: -4, filter: "blur(6px)" },
                  open: { opacity: 1, y: 0, filter: "blur(0px)" },
                }}
              >
                <FileTree
                  activePath={activePath}
                  files={files}
                  onSelect={(path) => {
                    onSelect(path);
                    onClose();
                  }}
                />
              </motion.div>
            </motion.div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
