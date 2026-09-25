/**
 * The pointer in the film.
 *
 * It is not a recording of a mouse. It is a drawn cursor that travels to real
 * elements in the real DOM — the Run button, the composer — and presses them by
 * dispatching the same event sequence a click produces, so the component under
 * it does whatever it does in the app. Where it goes is looked up at the moment
 * it goes there, which is what keeps it on target at every size the page is
 * drawn at.
 */

const ARROW = `<svg width="22" height="22" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8.2 4.9v17.3l4.1-4 2.6 6.1 3-1.3-2.6-6h5.9L8.2 4.9Z" fill="#000" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
const BEAM = `<svg width="22" height="22" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M10.5 5.5c1.7 0 2.9.5 3.5 1.4.6-.9 1.8-1.4 3.5-1.4M10.5 22.5c1.7 0 2.9-.5 3.5-1.4.6.9 1.8 1.4 3.5 1.4M14 7v14M12 14h4" stroke="#000" stroke-width="3.2" stroke-linecap="round"/><path d="M10.5 5.5c1.7 0 2.9.5 3.5 1.4.6-.9 1.8-1.4 3.5-1.4M10.5 22.5c1.7 0 2.9-.5 3.5-1.4.6.9 1.8 1.4 3.5 1.4M14 7v14M12 14h4" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/></svg>`;

export type Cursor = ReturnType<typeof createCursor>;

export function createCursor(host: HTMLElement) {
  const node = document.createElement("div");
  node.className = "hero-cursor";
  node.innerHTML = ARROW;
  host.appendChild(node);
  let x = window.innerWidth * 0.62;
  let y = window.innerHeight * 0.7;
  let shape: "arrow" | "beam" = "arrow";
  place();

  function place() {
    node.style.transform = `translate3d(${x - 7}px, ${y - 4}px, 0)`;
  }

  function setShape(next: "arrow" | "beam") {
    if (shape === next) return;
    shape = next;
    node.innerHTML = next === "beam" ? BEAM : ARROW;
  }

  /** Glides there along a slight arc, easing out — how a hand moves a mouse. */
  function glide(toX: number, toY: number, duration: number) {
    const fromX = x;
    const fromY = y;
    const distance = Math.hypot(toX - fromX, toY - fromY);
    const time = duration || Math.min(900, 320 + distance * 0.7);
    const bend = Math.min(60, distance * 0.12);
    const normalX = -(toY - fromY) / (distance || 1);
    const normalY = (toX - fromX) / (distance || 1);
    const started = performance.now();
    return new Promise<void>((resolve) => {
      const frame = (now: number) => {
        const t = Math.min(1, (now - started) / time);
        const eased = 1 - (1 - t) ** 3;
        const arc = Math.sin(Math.PI * eased) * bend;
        x = fromX + (toX - fromX) * eased + normalX * arc;
        y = fromY + (toY - fromY) * eased + normalY * arc;
        place();
        if (t < 1) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });
  }

  return {
    node,
    /** Moves onto `target`, at a point inside it given as fractions of its box. */
    async moveTo(target: Element, options: { ax?: number; ay?: number; duration?: number; beam?: boolean } = {}) {
      const rect = target.getBoundingClientRect();
      const toX = rect.left + rect.width * (options.ax ?? 0.5);
      const toY = rect.top + rect.height * (options.ay ?? 0.5);
      await glide(toX, toY, options.duration ?? 0);
      setShape(options.beam ? "beam" : "arrow");
    },
    async moveToPoint(toX: number, toY: number, duration = 0) {
      await glide(toX, toY, duration);
    },
    /** Presses whatever is under the cursor now, the way a click does. */
    async click(target: Element) {
      node.classList.add("is-pressed");
      const init = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0, pointerId: 1, pointerType: "mouse", isPrimary: true } as PointerEventInit;
      target.dispatchEvent(new PointerEvent("pointerdown", { ...init, buttons: 1 }));
      target.dispatchEvent(new MouseEvent("mousedown", { ...init, buttons: 1 }));
      /* Only a field takes focus. A focused button would open whatever opens on
         focus — the session row's peek — and keep it open for the whole film. */
      if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) target.focus({ preventScroll: true });
      await new Promise((resolve) => setTimeout(resolve, 90));
      target.dispatchEvent(new PointerEvent("pointerup", init));
      target.dispatchEvent(new MouseEvent("mouseup", init));
      target.dispatchEvent(new MouseEvent("click", init));
      node.classList.remove("is-pressed");
    },
    hide() { node.classList.add("is-hidden"); },
    show() { node.classList.remove("is-hidden"); },
    setShape,
    remove() { node.remove(); },
  };
}
