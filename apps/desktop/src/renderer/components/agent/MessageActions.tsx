import type * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * The controls under a message, in one place.
 *
 * Both footers — the learner's bubble and the agent's answer — had grown their
 * own copy of this: their own button size, their own icon size, their own gap.
 * They are the same control strip in the same transcript, two inches apart, so
 * any drift between them reads as a bug rather than a distinction. Whatever the
 * two rows do differently (rate, edit, which side the time sits on) they should
 * not differ in how big a button is or how close together buttons sit.
 */

/* `gap-0.5`: an icon button's hit box already pads its glyph, so a real gap
   between two of them reads as roughly double what was asked for and the row
   stops looking like one strip. */
export const MESSAGE_ACTION_ROW =
  "flex items-center gap-0.5 text-thread-tool font-normal text-muted-foreground";

/* 24px box around a 14px glyph. `icon-xs` alone gives a 12px glyph, which reads
   a size smaller than every other control in the thread. */
const ACTION_BUTTON = "size-6 [&_svg:not([class*='size-'])]:size-3.5";

/**
 * One action. `active` fills the glyph rather than only darkening it — at 14px
 * the difference between a muted outline and a foreground outline is not a
 * state you can read without hovering the thing to check.
 */
export function MessageActionButton({
  active = false,
  className,
  ...props
}: React.ComponentProps<typeof Button> & { active?: boolean }) {
  return (
    <Button
      className={cn(ACTION_BUTTON, active && "text-foreground [&_svg]:fill-current", className)}
      size="icon-xs"
      type="button"
      variant="ghost"
      {...props}
    />
  );
}

/**
 * The common case: an action with its name on hover.
 *
 * `tooltip` defaults to `label`, so the accessible name and the visible name
 * are the same string unless a caller has a reason to say more (a lit thumb
 * saying how to undo itself).
 */
export function MessageAction({
  label,
  tooltip,
  children,
  ...props
}: React.ComponentProps<typeof MessageActionButton> & {
  label: string;
  tooltip?: React.ReactNode;
}) {
  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>
        <MessageActionButton aria-label={label} {...props}>
          {children}
        </MessageActionButton>
      </TooltipTrigger>
      <TooltipContent>{tooltip ?? label}</TooltipContent>
    </Tooltip>
  );
}
