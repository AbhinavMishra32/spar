import * as React from "react";

/**
 * Fades the top and bottom edges of a scroll container in proportion to how far
 * it is from each end, so a list that continues past the fold says so.
 *
 * The fade is a mask on the *scrolling* element, never on the surface around it:
 * these menus are translucent glass, and masking the surface itself would eat
 * its background and its rim along with the text.
 *
 * The depth tracks scroll distance rather than snapping on at the first pixel —
 * a fade that pops to full strength on one wheel notch reads as a flicker, and
 * one that grows out of the edge reads as depth.
 */
export function useScrollFade<T extends HTMLElement>(maxFade = 14) {
  const ref = React.useRef<T | null>(null);
  const [fade, setFade] = React.useState({ top: 0, bottom: 0 });

  React.useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const measure = () => {
      const overflow = node.scrollHeight - node.clientHeight;
      const top = overflow <= 1 ? 0 : Math.min(maxFade, Math.max(0, node.scrollTop));
      const bottom = overflow <= 1 ? 0 : Math.min(maxFade, Math.max(0, overflow - node.scrollTop));
      setFade((current) =>
        Math.abs(current.top - top) < 0.5 && Math.abs(current.bottom - bottom) < 0.5 ? current : { top, bottom },
      );
    };

    measure();
    node.addEventListener("scroll", measure, { passive: true });

    // The box and its contents both move the ends around: the menu is resized by
    // the viewport, and filtered lists change height without any scroll event.
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    for (const child of Array.from(node.children)) observer.observe(child);

    return () => {
      node.removeEventListener("scroll", measure);
      observer.disconnect();
    };
  }, [maxFade]);

  const mask = `linear-gradient(to bottom, transparent 0px, #000 ${fade.top}px, #000 calc(100% - ${fade.bottom}px), transparent 100%)`;

  return {
    ref,
    style: { maskImage: mask, WebkitMaskImage: mask } satisfies React.CSSProperties,
  } as const;
}
