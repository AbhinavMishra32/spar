import { useState } from "react";
import { Check } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

import { Switch } from "@/components/ui/switch";
import { CODE_FONTS, useCodeFont, type CodeFont } from "@/lib/code-font";
import { cn } from "@/lib/utils";
import { useIntellisense } from "../../hooks/use-intellisense";
import { Colorized } from "../agent/Markdown";
import { SettingsField, SettingsRow } from "./layout";

/* Short enough to fit the card, and chosen to show what tells faces apart:
   `0O` and `1lI`, an arrow and a comparison for the ligature faces, a comment,
   a string, a call. */
const SAMPLE = `def shortest(nums: list[int], k: int) -> int:
    """Shortest window whose sum reaches k, or 0."""
    best, total, left = float("inf"), 0, 0
    for right, n in enumerate(nums):
        total += n
        while total >= k and left <= right:  # 0O 1lI
            best = min(best, right - left + 1)
            total -= nums[left]; left += 1
    return 0 if best == float("inf") else best
`;

const EASE = [0.32, 0.72, 0, 1] as const;

/**
 * The code face, picked by looking at it.
 *
 * The preview is the thread's own code block, so what you see here is exactly
 * what chat and the editor will draw. Hovering a face previews it before you
 * commit; leaving puts the chosen one back.
 */
function CodeFontPicker() {
  const [font, choose] = useCodeFont();
  const [hovered, setHovered] = useState<CodeFont | null>(null);
  const shown = hovered ?? font;

  return (
    <div className="flex flex-col gap-3 bg-[var(--surface-secondary)] p-2.5">
      <SettingsField title="Code font" description="Used in the editor, in chat, and everywhere else code appears." />

      <div
        className="code-block relative !my-0 overflow-hidden"
        style={{ fontFamily: shown.stack, fontVariantLigatures: shown.ligatures ? "normal" : "none" }}
      >
        <AnimatePresence initial={false} mode="popLayout">
          <motion.div
            animate={{ opacity: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, filter: "blur(2px)" }}
            initial={{ opacity: 0, filter: "blur(2px)" }}
            key={shown.id}
            transition={{ duration: 0.18, ease: EASE }}
          >
            <Colorized body={SAMPLE} className="!max-h-none !overflow-hidden" language="python" />
          </motion.div>
        </AnimatePresence>
      </div>

      <div
        aria-label="Code font"
        className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-1.5"
        onMouseLeave={() => setHovered(null)}
        role="radiogroup"
      >
        {CODE_FONTS.map((option) => {
          const selected = option.id === font.id;
          return (
            <button
              aria-checked={selected}
              className={cn(
                "group relative flex min-w-0 flex-col items-start gap-1 rounded-lg border px-2.5 py-2 text-left outline-none transition-[background-color,border-color,box-shadow] duration-150",
                "focus-visible:ring-2 focus-visible:ring-ring/50",
                selected
                  ? "border-foreground/25 bg-background shadow-[0_1px_2px_oklch(0%_0_0/0.06)]"
                  : "border-transparent hover:bg-accent/60",
              )}
              key={option.id}
              onClick={() => choose(option.id)}
              onFocus={() => setHovered(option)}
              onBlur={() => setHovered(null)}
              onMouseEnter={() => setHovered(option)}
              role="radio"
              type="button"
            >
              <span className="flex w-full items-center gap-1.5">
                <span className="truncate text-[13px] text-foreground" style={{ fontFamily: option.stack }}>
                  {option.name}
                </span>
                <AnimatePresence initial={false}>
                  {selected && (
                    <motion.span
                      animate={{ opacity: 1, scale: 1 }}
                      className="ml-auto grid size-3.5 shrink-0 place-items-center rounded-full bg-foreground text-background"
                      exit={{ opacity: 0, scale: 0.6 }}
                      initial={{ opacity: 0, scale: 0.6 }}
                      transition={{ duration: 0.16, ease: EASE }}
                    >
                      <Check className="size-2.5" strokeWidth={3} />
                    </motion.span>
                  )}
                </AnimatePresence>
              </span>
              <span className="line-clamp-2 text-ui-sm text-muted-foreground">{option.note}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function EditorSettings() {
  const [intellisense, toggleIntellisense] = useIntellisense();
  return (
    <>
      <CodeFontPicker />
      <SettingsRow className="gap-4 py-2.5">
        <SettingsField
          title="Suggestions and hints"
          description="Completions, signature help and hovers while you type. Off by default — practice is the typing."
        />
        <Switch aria-label="Suggestions and hints" checked={intellisense} onCheckedChange={() => toggleIntellisense()} />
      </SettingsRow>
    </>
  );
}
