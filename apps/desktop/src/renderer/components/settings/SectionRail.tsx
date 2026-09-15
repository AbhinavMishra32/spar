import { useCallback, useEffect, useState } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * The marks in the left margin of a Settings page: one short dash per section,
 * the one you are reading at full strength and the rest nearly out.
 *
 * It is a position indicator that happens to be clickable, not a second
 * navigation — the sidebar already says which page you are on, and this says
 * where in the page you are. Which is why it carries no text: a column of words
 * beside a column of words is two tables of contents arguing, while a column of
 * dashes is a scrollbar you can aim.
 *
 * Fewer than two sections and it does not appear at all. One dash cannot
 * indicate anything, and a lone mark floating in the margin reads as a defect.
 */
export function SectionRail({
  contentRef,
  viewportRef,
}: {
  contentRef: React.RefObject<HTMLElement | null>;
  viewportRef: React.RefObject<HTMLElement | null>;
}) {
  const [sections, setSections] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);

  /* Read from the DOM rather than from a list passed in. The page renders one
     of seven bodies and each body decides its own sections; asking the rendered
     tree is the only way to stay right without every body registering itself. */
  const measure = useCallback(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;
    const nodes = Array.from(content.querySelectorAll<HTMLElement>("[data-settings-section]"));
    const titles = nodes.map((node) => node.dataset.settingsSection ?? "").filter(Boolean);
    setSections((previous) => (previous.length === titles.length && previous.every((t, i) => t === titles[i]) ? previous : titles));

    /* The last section whose top has passed the fold, not the nearest one: a
       section you have scrolled halfway through is the one you are reading,
       even when the next heading is closer to the middle of the screen. */
    const top = viewport.getBoundingClientRect().top;
    let current: string | null = titles[0] ?? null;
    for (const node of nodes) {
      const title = node.dataset.settingsSection;
      if (!title) continue;
      if (node.getBoundingClientRect().top - top <= 1) current = title;
    }
    setActive(current);
  }, [contentRef, viewportRef]);

  useEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;

    /* One measurement per frame. Scroll fires far faster than the rail can
       possibly change, and the read is a layout read. */
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; measure(); });
    };

    schedule();
    viewport.addEventListener("scroll", schedule, { passive: true });
    const observer = new MutationObserver(schedule);
    observer.observe(content, { childList: true, subtree: true });
    addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener("scroll", schedule);
      observer.disconnect();
      removeEventListener("resize", schedule);
    };
  }, [contentRef, measure, viewportRef]);

  if (sections.length < 2) return null;

  return (
    /* Transparent to the pointer as a whole, opaque on the dashes: the rail
       spans the full height of the sheet, and a full-height invisible column
       that eats clicks on the page behind it is a bug you find weeks later. */
    <nav
      aria-label="Settings sections"
      className="pointer-events-none absolute inset-y-0 left-3 z-20 hidden items-center @min-[45rem]:flex"
    >
      <div className="pointer-events-auto flex flex-col">
        {sections.map((title) => (
          <Tooltip key={title}>
            <TooltipTrigger
              aria-label={title}
              className="group flex w-5 items-center justify-start py-1 outline-none"
              onClick={() => {
                contentRef.current
                  ?.querySelector(`[data-settings-section="${CSS.escape(title)}"]`)
                  ?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
              type="button"
            >
              <span
                className="h-0.5 w-3 rounded-full bg-foreground transition-[width,opacity] group-hover:w-4 group-hover:opacity-100!"
                style={{ opacity: title === active ? 1 : 0.2 }}
              />
            </TooltipTrigger>
            <TooltipContent side="right">{title}</TooltipContent>
          </Tooltip>
        ))}
      </div>
    </nav>
  );
}
