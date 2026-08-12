"use client";

import { useRef, type MouseEvent, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * A card with a light that follows the pointer across it.
 *
 * The position is written straight to CSS custom properties rather than held in
 * React state: this fires on every pointer move over the card, and a re-render
 * per move to reposition a gradient would be a lot of work for a highlight.
 */
export function Spotlight({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);

  function onMove(event: MouseEvent<HTMLDivElement>) {
    const element = ref.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    element.style.setProperty("--mx", `${event.clientX - rect.left}px`);
    element.style.setProperty("--my", `${event.clientY - rect.top}px`);
  }

  return (
    <div ref={ref} onMouseMove={onMove} className={cn("card card-spotlight", className)}>
      {children}
    </div>
  );
}
