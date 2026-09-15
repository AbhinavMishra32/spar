import * as React from "react"
import { Tooltip as TooltipPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

/* Aside's tooltip, transcribed from its own bundle rather than measured off a
   screenshot: `rounded-md`, `px-2.5 py-1`, 12px, `shadow-md`, and a hairline —
   `font-medium` in light, `font-normal` in dark, because the dark chip is
   already the brighter thing on screen and medium there reads as shouting. The
   edge is their `border-glass`, which lives in `.tooltip-surface`.

   It animates, which the old one deliberately did not: `fade-in-0 zoom-in-95`
   plus 8px back toward the trigger, on the tw-animate default of 150ms and
   plain `ease` — the same gesture as a menu, a half-beat slower because a
   tooltip is answering a question rather than obeying a click.

   Radix keeps the node mounted through its exit (Presence waits for the
   animation), so the close animates too — but it reports state as
   `data-state="delayed-open" | "instant-open" | "closed"`, never the
   `data-open` / `data-closed` attributes Base UI uses. Tailwind compiles the
   short `data-open:` form to `[data-open]`, so spelling these out is what makes
   them fire at all. */

function TooltipProvider({
  delayDuration = 150,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  )
}

function Tooltip({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />
}

function TooltipTrigger({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

function TooltipContent({
  className,
  side = "top",
  sideOffset = 4,
  collisionPadding = 8,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        className={cn(
          /* 6px, not `rounded-md`: their `--radius-md` is 0.375rem where
             Spar's is 0.5rem, so the shared name is a different corner. */
          "tooltip-surface z-50 inline-flex w-fit max-w-xs origin-(--radix-tooltip-content-transform-origin) items-center gap-1.5 rounded-[0.375rem] bg-popover px-2.5 py-1 text-xs font-medium text-popover-foreground select-none dark:font-normal",
          /* The chip carries its own padding, so the edge beside it closes up. */
          "has-data-[slot=kbd]:pr-1.5",
          "data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95",
          "data-[state=instant-open]:animate-in data-[state=instant-open]:fade-in-0 data-[state=instant-open]:zoom-in-95",
          "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          "data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2",
          className
        )}
        collisionPadding={collisionPadding}
        data-slot="tooltip-content"
        side={side}
        sideOffset={sideOffset}
        {...props}
      >
        {children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

/**
 * The keys that do the same thing as the control you are pointing at. Aside's
 * `Kbd` exactly: 18px tall, never narrower than 20px so a single letter still
 * reads as a key rather than a letter on a tint, 4px corners, 11px medium on
 * `--muted`. The gap to the label is the tooltip's own `gap-1.5`.
 *
 * `data-slot="kbd"` is load-bearing — the tooltip closes up its right edge only
 * when it can see one of these inside it.
 */
function TooltipKeys({ className, children, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn(
        /* Their `rounded-sm` is `calc(var(--radius) * 0.6)` on a 0.625rem
           radius — 6px, the same corner as the tooltip around it. Spar's
           `rounded-sm` is 5px, which is the kind of 1px that reads as a
           different component. */
        "pointer-events-none inline-flex h-4.5 w-fit min-w-5 items-center justify-center gap-1 rounded-[0.375rem] bg-muted px-1.5 font-sans text-[11px] font-medium text-primary select-none [&_svg:not([class*='size-'])]:size-3",
        className
      )}
      data-slot="kbd"
      {...props}
    >
      {children}
    </kbd>
  )
}

export { Tooltip, TooltipContent, TooltipKeys, TooltipProvider, TooltipTrigger }
