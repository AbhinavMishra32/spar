import * as React from "react";
import { Switch as SwitchPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

/**
 * A switch, for a setting that is simply on or off.
 *
 * The page's other controls are segmented: they pick between named options, and
 * a two-segment control forced to mean on/off makes the reader parse a choice
 * where there is only a state.
 *
 * Drawn the way macOS 26 draws one, in Spar's ink rather than a system colour:
 * a long track and a capsule knob with a little light on its top edge. The
 * knob and the track's colour move on one curve and one clock — a long,
 * decelerating ease-out, no overshoot — so the fill and the slide arrive
 * together. The travel is computed from the knob's own width, so it lands
 * flush with either end.
 *
 * On is the brand ink and the knob takes the page colour, so the pair inverts
 * cleanly in dark mode — a white knob on a white track would vanish.
 */
function Switch({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & { size?: "default" | "sm" }) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "peer group relative inline-flex shrink-0 cursor-pointer items-center rounded-full outline-none",
        /* `sm` is the menu-row size: a 32px row cannot carry a control built for
           a settings card without the row reading as a control in its own right. */
        size === "sm" ? "[--sw-h:1.125rem] [--sw-w:2.25rem]" : "[--sw-h:1.375rem] [--sw-w:2.875rem]",
        "h-(--sw-h) w-(--sw-w)",
        "bg-[color-mix(in_oklab,var(--foreground)_11%,transparent)] shadow-[inset_0_0.5px_1.5px_oklch(0%_0_0/14%)]",
        "transition-[background-color,box-shadow] duration-[320ms] ease-[cubic-bezier(0.25,1,0.5,1)] motion-reduce:transition-none",
        "hover:bg-[color-mix(in_oklab,var(--foreground)_15%,transparent)]",
        "data-[state=checked]:bg-[var(--brand)] data-[state=checked]:shadow-[inset_0_0.5px_0_oklch(100%_0_0/14%),inset_0_-1px_2px_oklch(0%_0_0/18%)] data-[state=checked]:hover:bg-[color-mix(in_oklab,var(--brand)_88%,var(--background))]",
        "focus-visible:ring-[3px] focus-visible:ring-ring/50",
        "disabled:cursor-default disabled:opacity-45",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "pointer-events-none absolute left-[2px] top-[2px] block rounded-full",
          /* The knob is a capsule half again as wide as it is tall. It keeps its
             shape the whole way: a knob that swells under the finger reads as
             the control wobbling, not as it being pressed. */
          "[--th:calc(var(--sw-h)-4px)] [--tw:calc(var(--th)*1.45)]",
          "h-(--th) w-(--tw)",
          "translate-x-0 data-[state=checked]:translate-x-[calc(var(--sw-w)-4px-var(--tw))]",
          "bg-[linear-gradient(180deg,oklch(100%_0_0),oklch(96.5%_0_0))] dark:bg-[linear-gradient(180deg,oklch(94%_0_0),oklch(86%_0_0))]",
          "data-[state=checked]:bg-[linear-gradient(180deg,var(--background),color-mix(in_oklab,var(--background)_94%,var(--foreground)))]",
          "shadow-[0_0_0_0.5px_oklch(0%_0_0/7%),0_1px_1px_oklch(0%_0_0/10%),0_2px_6px_oklch(0%_0_0/12%),inset_0_0.5px_0_oklch(100%_0_0/90%)]",
          "will-change-[translate] transition-[translate,background,box-shadow] duration-[320ms] ease-[cubic-bezier(0.25,1,0.5,1)] motion-reduce:transition-none",
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
