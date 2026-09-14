import * as React from "react"
import { Tooltip as TooltipPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

/* Modelled on the ChatGPT desktop app's tooltip, down to the numbers: 8px
   radius, 8px/4px of padding, a 12px semibold label, 4px off the trigger and 8px
   off the viewport, and no arrow. It does not animate, which is most of why it
   feels quick — a label the pointer is already looking at should be there, not
   arrive.

   The one thing not copied is the colour. ChatGPT stamps `dark` on the chip and
   keeps it near-black in both themes; over a light sidebar that is a black brick
   floating on glass, so this one takes the popover surface and turns with the
   theme — white with a hairline in light, the dark slab in dark. */

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
          "z-50 max-w-72 rounded-[0.5rem] border border-border bg-popover px-2 py-1 text-xs font-semibold text-popover-foreground select-none",
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

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger }
