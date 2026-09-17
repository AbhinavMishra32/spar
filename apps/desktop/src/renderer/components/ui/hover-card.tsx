import * as React from "react";
import { HoverCard as HoverCardPrimitive } from "radix-ui";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { useControlledState } from "@/hooks/use-controlled-state";
import { cn } from "@/lib/utils";
import { overlaySurfaceVariants } from "@/components/ui/overlay-motion";

/* Mirrors Radix's open state so AnimatePresence, not Radix, decides when the
   card leaves the tree — otherwise there is nothing left to animate out. */
const HoverCardOpenContext = React.createContext(false);

/**
 * A panel that opens on hover and can be moved into. Distinct from a tooltip on
 * purpose: a tooltip is a label, its content is not reachable by the pointer, and
 * anything with a list or a link inside it belongs here instead.
 *
 * The open delay is real (not the tooltip's zero): this appears while the pointer
 * is crossing a row of chips on its way somewhere else, and a panel that arrives
 * instantly under a moving cursor reads as the app grabbing at you. The close
 * delay is shorter than the open one so leaving feels immediate.
 */
function HoverCard({
  openDelay = 260,
  closeDelay = 120,
  open,
  defaultOpen,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof HoverCardPrimitive.Root>) {
  const [isOpen, setIsOpen] = useControlledState<boolean>({
    ...(open === undefined ? {} : { value: open }),
    defaultValue: defaultOpen ?? false,
    ...(onOpenChange ? { onChange: onOpenChange } : {}),
  });

  return (
    <HoverCardOpenContext.Provider value={isOpen}>
      <HoverCardPrimitive.Root
        closeDelay={closeDelay}
        data-slot="hover-card"
        onOpenChange={setIsOpen}
        openDelay={openDelay}
        {...(open === undefined ? {} : { open })}
        {...(defaultOpen === undefined ? {} : { defaultOpen })}
        {...props}
      />
    </HoverCardOpenContext.Provider>
  );
}

function HoverCardTrigger({ ...props }: React.ComponentProps<typeof HoverCardPrimitive.Trigger>) {
  return <HoverCardPrimitive.Trigger data-slot="hover-card-trigger" {...props} />;
}

function HoverCardContent({
  className,
  align = "start",
  side = "bottom",
  sideOffset = 6,
  instant = false,
  children,
  ...props
}: React.ComponentProps<typeof HoverCardPrimitive.Content> & {
  /** Arrives already there. A hover card that explains the word under the
   *  pointer is read the moment it appears, and a card that grows into place is
   *  a card you wait for before you can read it — which is the opposite of what
   *  hovering is for. Reserved for cards on inline words; a card on a control
   *  the learner deliberately aimed at can still travel. */
  instant?: boolean;
}) {
  const isOpen = React.useContext(HoverCardOpenContext);
  const reduced = useReducedMotion() ?? false;
  const surface = React.useMemo(
    () => (instant ? INSTANT : overlaySurfaceVariants({ side, reduced })),
    [instant, side, reduced],
  );

  return (
    <AnimatePresence>
      {isOpen && (
        <HoverCardPrimitive.Portal forceMount>
          <HoverCardPrimitive.Content align={align} asChild forceMount side={side} sideOffset={sideOffset} {...props}>
            <motion.div
              animate="visible"
              className={cn(
                "floating-surface z-50 w-[19rem] origin-(--radix-hover-card-content-transform-origin) p-3 text-popover-foreground outline-none",
                "data-[state=closed]:pointer-events-none",
                className,
              )}
              data-slot="hover-card-content"
              exit="exit"
              initial={instant ? "visible" : "hidden"}
              variants={surface}
            >
              {children}
            </motion.div>
          </HoverCardPrimitive.Content>
        </HoverCardPrimitive.Portal>
      )}
    </AnimatePresence>
  );
}

/* Present on the first frame, gone on the last. The exit keeps a hint of a
   fade so the card does not vanish mid-sentence. */
const INSTANT = {
  hidden: { opacity: 1 },
  visible: { opacity: 1 },
  exit: { opacity: 0, transition: { duration: 0.08 } },
};

export { HoverCard, HoverCardContent, HoverCardTrigger };
