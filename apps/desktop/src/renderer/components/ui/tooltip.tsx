import * as React from "react"
import { Tooltip as TooltipPrimitive } from "radix-ui"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"

import { useControlledState } from "@/hooks/use-controlled-state"
import { cn } from "@/lib/utils"
import { overlaySurfaceVariants } from "@/components/ui/overlay-motion"

/* Same trick as the menus: Radix drops a closed tooltip from the tree, so its
   open state is mirrored here and AnimatePresence owns the unmount. */
const TooltipOpenContext = React.createContext(false)

function TooltipProvider({
  delayDuration = 0,
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

function Tooltip({
  open,
  defaultOpen,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  const [isOpen, setIsOpen] = useControlledState<boolean>({
    ...(open === undefined ? {} : { value: open }),
    defaultValue: defaultOpen ?? false,
    ...(onOpenChange ? { onChange: onOpenChange } : {}),
  })

  return (
    <TooltipOpenContext.Provider value={isOpen}>
      <TooltipPrimitive.Root
        data-slot="tooltip"
        {...(open === undefined ? {} : { open })}
        {...(defaultOpen === undefined ? {} : { defaultOpen })}
        onOpenChange={setIsOpen}
        {...props}
      />
    </TooltipOpenContext.Provider>
  )
}

function TooltipTrigger({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

function TooltipContent({
  className,
  sideOffset = 0,
  side = "top",
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  const isOpen = React.useContext(TooltipOpenContext)
  const reduced = useReducedMotion() ?? false
  /* Tighter and quicker than a menu's: a tooltip is a label the pointer is
     already looking at, and anything with a visible settle reads as the label
     wobbling under the cursor. Same family of spring, less rope. */
  const surface = React.useMemo(
    () =>
      overlaySurfaceVariants({
        side,
        reduced,
        spring: { type: "spring", stiffness: 700, damping: 34, mass: 0.5 },
      }),
    [side, reduced]
  )

  return (
    <AnimatePresence>
      {isOpen && (
        <TooltipPrimitive.Portal forceMount>
          <TooltipPrimitive.Content
            asChild
            forceMount
            side={side}
            sideOffset={sideOffset}
            {...props}
          >
            <motion.div
              animate="visible"
              className={cn(
                "z-50 inline-flex w-fit max-w-xs origin-(--radix-tooltip-content-transform-origin) items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs text-background has-data-[slot=kbd]:pr-1.5 data-closed:pointer-events-none **:data-[slot=kbd]:relative **:data-[slot=kbd]:isolate **:data-[slot=kbd]:z-50 **:data-[slot=kbd]:rounded-sm",
                className
              )}
              data-slot="tooltip-content"
              exit="exit"
              initial="hidden"
              variants={surface}
            >
              {children}
              <TooltipPrimitive.Arrow className="z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px] bg-foreground fill-foreground" />
            </motion.div>
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      )}
    </AnimatePresence>
  )
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger }
