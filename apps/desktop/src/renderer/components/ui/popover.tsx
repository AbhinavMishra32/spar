import * as React from "react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { useControlledState } from "@/hooks/use-controlled-state";
import { cn } from "@/lib/utils";
import { overlaySurfaceVariants } from "@/components/ui/overlay-motion";

/* Mirrors Radix's open state so AnimatePresence decides when the panel leaves
   the tree, the same arrangement as the hover card's. */
const PopoverOpenContext = React.createContext(false);

/**
 * A panel of controls that opens from a button and stays until you leave it.
 *
 * The menu's cousin, not its replacement: a menu is a list you pick one thing
 * from and it closes; this is a small settings sheet you change several things
 * in, so it keeps focus inside, closes on Escape or an outside click, and moves
 * exactly like every other anchored surface.
 */
function Popover({ open, defaultOpen, onOpenChange, ...props }: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  const [isOpen, setIsOpen] = useControlledState<boolean>({
    ...(open === undefined ? {} : { value: open }),
    defaultValue: defaultOpen ?? false,
    ...(onOpenChange ? { onChange: onOpenChange } : {}),
  });
  return (
    <PopoverOpenContext.Provider value={isOpen}>
      <PopoverPrimitive.Root data-slot="popover" onOpenChange={setIsOpen} open={isOpen} {...props} />
    </PopoverOpenContext.Provider>
  );
}

function PopoverTrigger(props: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverContent({
  className,
  align = "end",
  side = "bottom",
  sideOffset = 6,
  children,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  const isOpen = React.useContext(PopoverOpenContext);
  const reduced = useReducedMotion() ?? false;
  const surface = React.useMemo(() => overlaySurfaceVariants({ side, reduced }), [side, reduced]);
  return (
    <AnimatePresence>
      {isOpen && (
        <PopoverPrimitive.Portal forceMount>
          <PopoverPrimitive.Content align={align} asChild forceMount side={side} sideOffset={sideOffset} {...props}>
            <motion.div
              animate="visible"
              className={cn(
                "floating-surface z-50 origin-(--radix-popover-content-transform-origin) text-popover-foreground outline-none",
                "data-[state=closed]:pointer-events-none",
                className,
              )}
              data-slot="popover-content"
              exit="exit"
              initial="hidden"
              variants={surface}
            >
              {children}
            </motion.div>
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      )}
    </AnimatePresence>
  );
}

export { Popover, PopoverContent, PopoverTrigger };
