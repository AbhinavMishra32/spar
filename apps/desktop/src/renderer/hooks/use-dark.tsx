import { useEffect, useState } from "react";

/**
 * Whether the window is currently in its dark appearance.
 *
 * Read from the `dark` class on the document element, which is what every token
 * in `theme.css` is keyed off and what `App` maintains — rather than from the
 * media query, which is only the *system* preference and disagrees with the app
 * the moment the learner picks a theme explicitly.
 *
 * Needed because some colours are computed rather than declared: a hue whose
 * lightness has to run one way in dark and the other in light cannot be a CSS
 * variable, so the component mixing it has to know which way is up.
 */
export function useDark(): boolean {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));

  useEffect(() => {
    const element = document.documentElement;
    const observer = new MutationObserver(() => setDark(element.classList.contains("dark")));
    observer.observe(element, { attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return dark;
}
