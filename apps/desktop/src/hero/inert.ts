/**
 * The visitor's mouse: allowed to read, never to operate.
 *
 * Text in the film selects and copies like text in the app, which is what makes
 * it read as the app rather than a recording of it. Everything a real input
 * would *do* is stopped at the window, in the capture phase, before the app's
 * own listeners — React's root included — can hear it. Only trusted events are
 * stopped; the director's cursor dispatches untrusted ones, and those go
 * through.
 *
 * Stopping propagation leaves the browser's defaults alone, and the defaults
 * are what selection is. The exceptions are the defaults that would change
 * something: focusing a field or a button, following a link, the wheel.
 */
const STOPPED = [
  "pointerdown", "pointerup", "pointermove", "pointerover", "pointerout", "pointerenter", "pointerleave", "pointercancel",
  "mousedown", "mouseup", "mousemove", "mouseover", "mouseout", "mouseenter", "mouseleave",
  "click", "auxclick", "dblclick", "contextmenu",
  "touchstart", "touchmove", "touchend", "touchcancel",
  "dragstart", "drop",
  "keydown", "keyup", "keypress", "beforeinput", "input", "paste", "cut",
] as const;

/** What a press would take focus in, or act on, by default. */
const OPERABLE = "input, textarea, select, button, a[href], [contenteditable=''], [contenteditable='true'], [role=button], [role=tab], [tabindex]:not([tabindex='-1'])";

export function inertInput() {
  for (const type of STOPPED) {
    window.addEventListener(type, (event) => {
      if (!event.isTrusted) return;
      event.stopImmediatePropagation();
      const target = event.target instanceof Element ? event.target : null;
      /* A press on a control would focus it — and a focused field takes typing.
         Text elsewhere keeps its default, which is starting a selection. */
      if ((type === "mousedown" || type === "pointerdown") && (target?.closest(OPERABLE) || (event as MouseEvent).button === 1)) event.preventDefault();
      if (type === "click" && target?.closest("a[href]")) event.preventDefault();
      if (type === "dragstart" || type === "drop") event.preventDefault();
      /* Typing goes nowhere; copying is left to the browser. */
      if ((type === "keydown" || type === "beforeinput" || type === "paste" || type === "cut") && !isCopy(event)) event.preventDefault();
    }, { capture: true });
  }

  /* The film scrolls itself. The visitor's wheel belongs to the page around it,
     which is what they were scrolling when the frame passed under the pointer. */
  window.addEventListener("wheel", (event) => {
    if (!event.isTrusted) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    forwardWheel(event);
  }, { capture: true, passive: false });
}

function isCopy(event: Event) {
  return event instanceof KeyboardEvent && (event.metaKey || event.ctrlKey) && ["c", "a"].includes(event.key.toLowerCase());
}

function forwardWheel(event: WheelEvent) {
  if (window.parent === window) return;
  let host: Window;
  try {
    host = window.parent;
    void host.document;
  } catch {
    return;
  }
  /* The page eases its own scroll (Lenis, listening on its window), so the
     wheel is handed to it as a wheel rather than turned into a scroll here. If
     nothing there takes it, scroll natively. */
  const forwarded = new (host as Window & typeof globalThis).WheelEvent("wheel", {
    deltaX: event.deltaX,
    deltaY: event.deltaY,
    deltaMode: event.deltaMode,
    ctrlKey: event.ctrlKey,
    shiftKey: event.shiftKey,
    bubbles: true,
    cancelable: true,
  });
  if (host.dispatchEvent(forwarded)) host.scrollBy({ left: event.deltaX, top: event.deltaY * (event.deltaMode === 1 ? 16 : 1) });
}
