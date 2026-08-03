import * as React from "react";
import { HoverCard as HoverCardPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

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
function HoverCard({ openDelay = 260, closeDelay = 120, ...props }: React.ComponentProps<typeof HoverCardPrimitive.Root>) {
  return <HoverCardPrimitive.Root closeDelay={closeDelay} data-slot="hover-card" openDelay={openDelay} {...props} />;
}

function HoverCardTrigger({ ...props }: React.ComponentProps<typeof HoverCardPrimitive.Trigger>) {
  return <HoverCardPrimitive.Trigger data-slot="hover-card-trigger" {...props} />;
}

function HoverCardContent({ className, align = "start", sideOffset = 6, ...props }: React.ComponentProps<typeof HoverCardPrimitive.Content>) {
  return (
    <HoverCardPrimitive.Portal>
      <HoverCardPrimitive.Content
        align={align}
        className={cn(
          "floating-surface z-50 w-[19rem] origin-(--radix-hover-card-content-transform-origin) p-3 text-popover-foreground outline-none",
          "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          className,
        )}
        data-slot="hover-card-content"
        sideOffset={sideOffset}
        {...props}
      />
    </HoverCardPrimitive.Portal>
  );
}

export { HoverCard, HoverCardContent, HoverCardTrigger };
