import { createContext, useContext, useEffect, useMemo } from "react";

import { EMPTY_CODE_THEME_SETTINGS, resolveCodeTheme, type CodeSlots, type CodeTheme } from "../../shared/codeTheme";
import { useDark } from "./use-dark";

/**
 * The active code palette, applied everywhere code is drawn.
 *
 * One source, two consumers. The transcript and the problem statement highlight
 * from these slots; `theme.css` declares the same values as `--code-*` tokens
 * for everything that paints in CSS. Neither keeps its own copy, so a snippet in
 * chat and the same snippet in the editor cannot drift apart — which they had,
 * because the editor's colours lived in `monaco-theme.ts` and chat's in the
 * stylesheet.
 *
 * A context rather than a plain function because it is read from several places
 * per render pass and the palette only changes when the appearance does.
 */
type CodeThemeContext = {
  /** The palette in force for the current appearance. */
  theme: CodeTheme;
  appearance: "light" | "dark";
};

const Context = createContext<CodeThemeContext | null>(null);

export function CodeThemeProvider({ children }: { children: React.ReactNode }) {
  const dark = useDark();
  const appearance: "light" | "dark" = dark ? "dark" : "light";
  const theme = useMemo(() => resolveCodeTheme(EMPTY_CODE_THEME_SETTINGS, appearance), [appearance]);

  useEffect(() => {
    /* Written onto the document as well as handed to the highlighter, so a rule
       in the stylesheet and a span in the transcript resolve the same colour. */
    const root = document.documentElement;
    for (const [slot, value] of Object.entries(theme.slots) as Array<[keyof CodeSlots, string]>) {
      root.style.setProperty(`--code-${slot.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`, value);
    }
  }, [theme]);

  const value = useMemo<CodeThemeContext>(() => ({ theme, appearance }), [theme, appearance]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/** Falls back to the built-in palette rather than throwing. A component that
 *  renders code outside the provider should draw in the default colours, not
 *  take the screen down with it. */
export function useCodeTheme(): CodeThemeContext {
  const dark = useDark();
  const value = useContext(Context);
  const appearance: "light" | "dark" = dark ? "dark" : "light";
  return value ?? { theme: resolveCodeTheme(EMPTY_CODE_THEME_SETTINGS, appearance), appearance };
}
