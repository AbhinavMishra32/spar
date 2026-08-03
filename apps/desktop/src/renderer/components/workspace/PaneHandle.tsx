import { PanelResizeHandle } from "react-resizable-panels";
import { cn } from "@/lib/utils";

/**
 * Sits in the gutter between two blobs rather than drawn as a rule on their
 * edge. Nothing shows until the pointer is on it: the gap is already the
 * boundary, and a permanent line through it would undo the inset.
 */
export function PaneHandle({ direction = "horizontal" }: { direction?: "horizontal" | "vertical" }) {
  return (
    <PanelResizeHandle
      className={cn(
        "group/handle relative shrink-0",
        direction === "horizontal" ? "w-2 cursor-col-resize" : "h-2 cursor-row-resize",
      )}
    >
      <span
        className={cn(
          "absolute rounded-full bg-transparent transition-colors",
          "group-hover/handle:bg-[var(--border-strong)] group-data-[resize-handle-state=drag]/handle:bg-[var(--border-strong)]",
          direction === "horizontal"
            ? "inset-y-3 left-1/2 w-[3px] -translate-x-1/2"
            : "inset-x-3 top-1/2 h-[3px] -translate-y-1/2",
        )}
      />
    </PanelResizeHandle>
  );
}
