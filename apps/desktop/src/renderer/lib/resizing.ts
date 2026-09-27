/**
 * Whether a divider is being dragged, and a size observer that respects it.
 *
 * Dragging the sidebar or a pane changes the width of nearly everything in the
 * window on every frame. Components that measure themselves and put the result
 * in React state would each re-render on every one of those frames, and in a
 * long transcript that is hundreds of renders per pixel of drag. While a drag
 * is in flight, `observeSize` holds its callback and runs it once when the drag
 * ends.
 *
 * The flag is also written to `<html data-resizing>`, so CSS can switch off
 * transitions for the duration (see theme.css).
 */

import "./resizing.css";

let active = 0;
const waiting = new Set<() => void>();

export function beginResize() {
  active += 1;
  if (active === 1) document.documentElement.dataset.resizing = "";
}

export function endResize() {
  if (active === 0) return;
  active -= 1;
  if (active > 0) return;
  delete document.documentElement.dataset.resizing;
  const pending = [...waiting];
  waiting.clear();
  for (const run of pending) run();
}

export const isResizing = () => active > 0;

/** A ResizeObserver on `elements` that holds its callback while a drag is in
 *  flight and runs it once when the drag ends. Outside a drag it behaves as a
 *  plain ResizeObserver, measuring before paint. Returns the disconnect. */
export function observeSize(elements: Array<Element | null | undefined>, measure: () => void) {
  const observer = new ResizeObserver(() => {
    if (isResizing()) waiting.add(measure);
    else measure();
  });
  for (const element of elements) if (element) observer.observe(element);
  return () => {
    observer.disconnect();
    waiting.delete(measure);
  };
}
