import { useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Dialog } from "radix-ui";
import { BookOpen, Maximize2, Minimize2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { LESSON_MORPH, lessonLayoutId } from "./taughtLesson";
import { ArtifactCardRow } from "./ArtifactCard";
import { LessonContent } from "./LessonContent";
import { useLesson } from "./useLesson";

export function LessonReader({ lessonId, onClose }: { lessonId: string | null; onClose(): void }) {
  const [full, setFull] = useState(false);
  const reading = useLesson(lessonId);
  const reduced = useReducedMotion();
  const opener = useRef<HTMLElement | null>(null);
  const close = () => { onClose(); };
  return (
    <Dialog.Root open={Boolean(lessonId)} onOpenChange={(open) => { if (!open) close(); }}>
      <AnimatePresence onExitComplete={() => setFull(false)}>
        {lessonId && <Dialog.Portal forceMount>
          <Dialog.Overlay asChild forceMount>
            <motion.div className="fixed inset-0 z-[80] bg-[var(--modal-scrim)]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : 0.14 }} />
          </Dialog.Overlay>
          <motion.div layoutRoot className="pointer-events-none fixed inset-0 z-[81] grid place-items-center">
            <Dialog.Content asChild forceMount aria-describedby={undefined}
              onOpenAutoFocus={() => { if (!opener.current) opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }}
              onCloseAutoFocus={(event) => { event.preventDefault(); opener.current?.focus({ preventScroll: true }); opener.current = null; }}
              onEscapeKeyDown={(event) => { if (full) { event.preventDefault(); setFull(false); } }}
              onPointerDownOutside={(event) => { if (full) { event.preventDefault(); setFull(false); } }}
            >
              <motion.div
                layout={!reduced}
                {...(!reduced ? { layoutId: lessonLayoutId(lessonId) } : {})}
                className={cn("transcript-block transcript-block-solid pointer-events-auto relative flex min-h-0 flex-col overflow-hidden outline-none", full ? "h-dvh w-screen" : "h-[min(42rem,calc(100dvh-6rem))] w-[min(42rem,calc(100vw-4rem))]")}
                style={{ borderRadius: full ? 0 : "1.4rem" }}
                transition={reduced ? { duration: 0 } : LESSON_MORPH}
              >
                <motion.div className="flex min-h-0 flex-1 flex-col" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : 0.12 }}>
                  <ArtifactCardRow className="px-5 py-3" icon={<BookOpen className="size-4 text-muted-foreground" />}>
                    <Dialog.Title className="min-w-0 flex-1 truncate text-thread font-semibold">{reading.lesson?.title ?? "Lesson"}</Dialog.Title>
                    <button type="button" aria-label={full ? "Leave fullscreen" : "Fill the window"} onClick={() => setFull((value) => !value)} className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">
                      {full ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
                    </button>
                    <Dialog.Close aria-label="Close lesson" className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"><X className="size-3.5" /></Dialog.Close>
                  </ArtifactCardRow>
                  {reading.status === "ready" && reading.lesson
                    ? <div className={cn("flex min-h-0 flex-1 flex-col border-t border-border/50", full && "mx-auto w-full max-w-[52rem]")}><LessonContent lesson={reading.lesson} page={reading.page} onPage={reading.setPage} /></div>
                    : <p role="status" className="px-4 py-3 text-thread text-muted-foreground">{reading.status === "missing" ? "This lesson could not be loaded." : "Opening the lesson…"}</p>}
                </motion.div>
              </motion.div>
            </Dialog.Content>
          </motion.div>
        </Dialog.Portal>}
      </AnimatePresence>
    </Dialog.Root>
  );
}
