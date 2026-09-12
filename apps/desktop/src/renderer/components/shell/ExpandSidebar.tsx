import { AnimatePresence, motion } from "motion/react";
import { SidebarGlyph } from "./NavIcons";
import { SIDEBAR_SLIDE } from "./sidebarMotion";

/**
 * The way back to a hidden sidebar, in whichever bar is showing.
 *
 * It animates because it is the only part of the window that appears *because*
 * the sidebar left. Both bars used to mount it outright and add their leading
 * inset in the same frame, so collapsing the sidebar was one smooth slide and
 * one hard jump: the title and everything after it stepped sideways by the
 * width of a button while the column beside them was still travelling. On the
 * way back it was worse, because the button vanished at the start of the slide
 * and left the row shifted for the whole of it.
 *
 * Running on the sidebar's own curve is what makes the two read as one
 * movement — the row opens exactly as fast as the column closes.
 *
 * The negative margin on exit is not a fudge. A flex gap is paid for a child of
 * zero width just the same as for a full one, so without it the row would keep
 * a button's worth of space forever after the button had gone.
 */
export function ExpandSidebar({ gap, onExpand }: { gap: number; onExpand?: (() => void) | undefined }) {
  return (
    <AnimatePresence initial={false}>
      {onExpand && (
        <motion.button
          animate={{ width: 24, marginRight: 0, opacity: 1 }}
          className="app-no-drag grid h-6 shrink-0 place-items-center overflow-hidden rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          exit={{ width: 0, marginRight: -gap, opacity: 0 }}
          initial={{ width: 0, marginRight: -gap, opacity: 0 }}
          onClick={onExpand}
          title="Show sidebar  ⌘B"
          transition={SIDEBAR_SLIDE}
          type="button"
        >
          <SidebarGlyph className="size-4" />
        </motion.button>
      )}
    </AnimatePresence>
  );
}
