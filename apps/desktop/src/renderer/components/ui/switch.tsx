import * as React from "react";
import { Switch as SwitchPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

/**
 * A switch, for a setting that is simply on or off.
 *
 * The page's other controls are segmented: they pick between named options, and
 * a two-segment control forced to mean on/off makes the reader parse a choice
 * where there is only a state. Sized and weighted to sit in the same row as one —
 * the track is the height of a segmented control's thumb, so a card holding both
 * keeps one horizontal rhythm.
 *
 * The thumb moves with the same curve the segmented control's does, because two
 * controls in one card animating differently is the kind of thing nobody names
 * and everybody feels.
 */
function Switch({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & { size?: "default" | "sm" }) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "peer group inline-flex shrink-0 items-center rounded-full border border-transparent p-px outline-none transition-colors duration-200",
        /* `sm` is the menu-row size: a 32px row cannot carry a control built for
           a settings card without the row reading as a control in its own
           right. */
        size === "sm" ? "h-[1.1rem] w-[1.8rem]" : "h-[1.35rem] w-[2.3rem]",
        "bg-[var(--color-background-elevated-secondary)] inset-shadow-[0_1px_0_0_color-mix(in_srgb,var(--foreground)_6%,transparent)]",
        "data-[state=checked]:bg-primary data-[state=checked]:inset-shadow-none",
        "focus-visible:ring-[3px] focus-visible:ring-ring/50",
        "disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "pointer-events-none block rounded-full bg-background shadow-[0_1px_2px_oklch(0%_0_0/18%)] ring-1 ring-black/5",
          size === "sm" ? "size-[0.8rem]" : "size-[1.05rem]",
          "transition-transform duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none",
          size === "sm" ? "translate-x-0 data-[state=checked]:translate-x-[0.7rem]" : "translate-x-0 data-[state=checked]:translate-x-[0.95rem]",
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
