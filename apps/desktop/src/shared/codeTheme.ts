/**
 * One palette for every surface that shows code.
 *
 * Three places render code and, until this existed, all three decided their own
 * colours: the editor from a hard-coded pair of palettes in `monaco-theme.ts`,
 * the agent transcript from `--code-*` CSS tokens, and inline code from
 * `--muted` — which is not a code colour at all. A snippet in chat and the same
 * snippet in the editor were different pictures of the same text.
 *
 * So the palette is data, and both consumers derive from it. Monaco is fed a
 * theme built from these slots; the renderer writes the same slots onto the
 * document as CSS variables. Neither holds its own copy, which is the only way
 * they stay in step.
 *
 * The slot names are ours, not TextMate's. A VSCode theme carries hundreds of
 * scopes; mapping them down to this many is a deliberate narrowing — see
 * `fromVsCodeTheme`.
 */
export type CodeSlots = {
  /** The editor canvas, and the fill behind a code block in chat. */
  background: string;
  foreground: string;
  /** Chrome the editor needs and chat does not. */
  selection: string;
  lineHighlight: string;
  lineNumber: string;
  lineNumberActive: string;
  border: string;
  /** The raised surface Monaco's own menus and hovers sit on. */
  surface: string;

  comment: string;
  keyword: string;
  type: string;
  entity: string;
  string: string;
  number: string;
  punctuation: string;
  variable: string;
  constant: string;
  operator: string;
};

export type CodeTheme = {
  id: string;
  name: string;
  /** Which app appearance this palette belongs under. A theme is only offered
   *  for the appearance it was built for: a light palette on a dark window is
   *  not a preference, it is a mistake. */
  appearance: "light" | "dark";
  /** Absent for the two that ship with Construct, set for anything imported, so
   *  the settings list can say where a theme came from and offer to remove it. */
  source?: string;
  slots: CodeSlots;
};

/* The built-ins are the palettes the app already used, moved here verbatim so
   that introducing the theme layer changed nothing about how Construct looks.
   The dark background is `--popover` — the editor shares a surface with the
   panel holding it, and a seam inside a panel is the thing that arrangement
   exists to avoid. */
export const SPAR_LIGHT: CodeTheme = {
  id: "spar-light",
  name: "Spar Light",
  appearance: "light",
  slots: {
    background: "#fcfcfc",
    foreground: "#33363b",
    selection: "#dcdcdc",
    lineHighlight: "#f5f5f5",
    lineNumber: "#a3a3a3",
    lineNumberActive: "#0a0a0a",
    border: "#e4e4e4",
    surface: "#ffffff",
    comment: "#727780",
    keyword: "#ce2734",
    type: "#7b4bd2",
    entity: "#1a6fc9",
    string: "#185a96",
    number: "#1660b5",
    punctuation: "#6f747c",
    variable: "#33363b",
    constant: "#1660b5",
    operator: "#6f747c",
  },
};

export const SPAR_DARK: CodeTheme = {
  id: "spar-dark",
  name: "Spar Dark",
  appearance: "dark",
  slots: {
    background: "#191919",
    foreground: "#c9d1d9",
    selection: "#2e2e2e",
    lineHighlight: "#212121",
    lineNumber: "#555555",
    lineNumberActive: "#fafafa",
    border: "#2b2b2b",
    surface: "#222222",
    comment: "#8b949e",
    keyword: "#ff8177",
    type: "#d2a8ff",
    entity: "#66b8ff",
    string: "#8bd891",
    number: "#79c0ff",
    punctuation: "#b3bac2",
    variable: "#c9d1d9",
    constant: "#79c0ff",
    operator: "#b3bac2",
  },
};

export const BUILT_IN_CODE_THEMES: readonly CodeTheme[] = [SPAR_LIGHT, SPAR_DARK];

export const DEFAULT_CODE_THEMES: { light: string; dark: string } = {
  light: SPAR_LIGHT.id,
  dark: SPAR_DARK.id,
};

/** Which theme each appearance uses, plus whatever has been imported. Held in
 *  settings so it survives a restart and follows the account, not the window. */
export type CodeThemeSettings = {
  light: string;
  dark: string;
  imported: CodeTheme[];
};

export const EMPTY_CODE_THEME_SETTINGS: CodeThemeSettings = {
  ...DEFAULT_CODE_THEMES,
  imported: [],
};

export function codeThemesFor(settings: CodeThemeSettings, appearance: "light" | "dark"): CodeTheme[] {
  return [...BUILT_IN_CODE_THEMES, ...settings.imported].filter((theme) => theme.appearance === appearance);
}

/** The theme to draw with, falling back to the built-in for that appearance —
 *  a removed or malformed import must never leave the editor unpainted. */
export function resolveCodeTheme(settings: CodeThemeSettings, appearance: "light" | "dark"): CodeTheme {
  const wanted = appearance === "dark" ? settings.dark : settings.light;
  const fallback = appearance === "dark" ? SPAR_DARK : SPAR_LIGHT;
  return codeThemesFor(settings, appearance).find((theme) => theme.id === wanted) ?? fallback;
}
