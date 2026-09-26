import { useCallback, useSyncExternalStore } from "react";

/**
 * The face every piece of code in the app is set in.
 *
 * One choice, applied everywhere code appears: it is written onto the document
 * as `--font-code`, which `--font-mono` — and so every `font-mono` span, chat
 * code block and inline code — reads, and the editors take the same stack as a
 * Monaco option, since Monaco measures glyphs from a string rather than from CSS.
 *
 * All but SF Mono ship with the app, so a choice looks the same on every
 * machine; SF Mono is the Mac's own and falls back to Geist Mono elsewhere.
 */
export type CodeFont = {
  id: string;
  name: string;
  /** What it is like to read, in a few words, for the picker. */
  note: string;
  stack: string;
  /** Whether it draws `=>`, `!=` and friends as single glyphs. */
  ligatures: boolean;
};

const FALLBACK = `ui-monospace, SFMono-Regular, Menlo, monospace`;

export const CODE_FONTS: readonly CodeFont[] = [
  { id: "geist", name: "Geist Mono", note: "Spar's own — crisp and even", stack: `"Geist Mono Variable", "SF Mono", ${FALLBACK}`, ligatures: false },
  { id: "sf", name: "SF Mono", note: "The Mac's system mono", stack: `"SF Mono", "Geist Mono Variable", ${FALLBACK}`, ligatures: false },
  { id: "jetbrains", name: "JetBrains Mono", note: "Tall, open, built for long sessions", stack: `"JetBrains Mono Variable", ${FALLBACK}`, ligatures: true },
  { id: "fira", name: "Fira Code", note: "Friendly, with operator ligatures", stack: `"Fira Code Variable", ${FALLBACK}`, ligatures: true },
  { id: "plex", name: "IBM Plex Mono", note: "Warm, a little bookish", stack: `"IBM Plex Mono", ${FALLBACK}`, ligatures: false },
];

export const DEFAULT_CODE_FONT = CODE_FONTS[0]!;

const STORAGE_KEY = "spar.codeFont";
const listeners = new Set<() => void>();

function read(): CodeFont {
  try {
    const id = localStorage.getItem(STORAGE_KEY);
    return CODE_FONTS.find((font) => font.id === id) ?? DEFAULT_CODE_FONT;
  } catch {
    return DEFAULT_CODE_FONT;
  }
}

let current = read();

/** Writes the face onto the document. Called once at startup, before the first
 *  paint, and again whenever the choice changes. */
export function applyCodeFont(font: CodeFont = current): void {
  document.documentElement.style.setProperty("--font-code", font.stack);
}

/** The family's first name, for `document.fonts.load`. */
export const primaryFamily = (font: CodeFont) => font.stack.split(",")[0]!.trim();

/** Called after the choice changes — main.tsx has Monaco measure again once the
 *  new face has actually loaded. */
export function onCodeFontChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const getCodeFont = () => current;

export function useCodeFont(): [CodeFont, (id: string) => void] {
  const font = useSyncExternalStore(subscribe, () => current);
  const choose = useCallback((id: string) => {
    const next = CODE_FONTS.find((candidate) => candidate.id === id);
    if (!next || next === current) return;
    current = next;
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* Still applies for this run. */
    }
    applyCodeFont(next);
    for (const listener of listeners) listener();
  }, []);
  return [font, choose];
}
