import * as React from "react"
import { Select as SelectPrimitive } from "radix-ui"
import { Check, ChevronDown, ChevronsUpDown, ChevronUp } from "lucide-react"

import { cn } from "@/lib/utils"

/* Radix's select, not Base UI's, and the reason is the dialogs. A Base UI popup
   portals outside a Radix dialog's trapped focus scope: the dialog pulls focus
   straight back, the popup closes because focus left it, and the menu appears
   for one frame and vanishes. Same-library primitives share that context and
   simply nest. Everything below is the app's own chrome on Radix's behaviour. */

function Select({ ...props }: React.ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />
}

function SelectGroup({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Group>) {
  return <SelectPrimitive.Group className={cn("scroll-my-1", className)} data-slot="select-group" {...props} />
}

function SelectValue({ ...props }: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />
}

function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & { size?: "sm" | "default" }) {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        "flex w-fit items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent py-1 pr-2 pl-2.5 text-sm transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-[size=default]:h-8 data-[size=sm]:h-7 data-placeholder:text-muted-foreground dark:bg-input/30 dark:hover:bg-input/50 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 *:data-[slot=select-value]:flex *:data-[slot=select-value]:min-w-0 *:data-[slot=select-value]:flex-1 *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-2 *:data-[slot=select-value]:text-left [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
        className
      )}
      data-size={size}
      data-slot="select-trigger"
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronsUpDown className="text-muted-foreground/70" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

/**
 * `item-aligned` is what makes this a select rather than a dropdown: the popup
 * opens *over* the trigger with the current row on the trigger's own line, the
 * way an AppKit popup button does.
 *
 * Deliberately the stock transition rather than the app's blur-and-settle: a
 * select is a field being edited in place, not a surface arriving over the
 * window, and Radix positions an item-aligned popup by measuring it — a scale
 * would move what it just measured, which is why shadcn suppresses the animation
 * in that mode too (`data-[align-trigger=true]:animate-none`).
 */
function SelectContent({
  className,
  children,
  position = "item-aligned",
  align = "center",
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        align={align}
        className={cn(
          "menu-surface-opaque app-scroll relative z-50 max-h-(--radix-select-content-available-height) min-w-[11rem] origin-(--radix-select-content-transform-origin) overflow-x-hidden overflow-y-auto duration-100 data-[align-trigger=true]:animate-none data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          position === "popper" && "w-(--radix-select-trigger-width)",
          className
        )}
        data-align-trigger={position === "item-aligned"}
        data-slot="select-content"
        position={position}
        {...props}
      >
        <SelectScrollUpButton />
        {/* No height or overflow of our own. An item-aligned popup is scrolled by
            Radix, which repositions the whole surface to keep the current row on
            the trigger's line — a second scroll container here fights that, and
            the list judders as soon as you touch the wheel. The height cap lives
            on the content, as `--radix-select-content-available-height`. */}
        <SelectPrimitive.Viewport className="p-1.5">{children}</SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
}

function SelectLabel({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      className={cn("px-2.5 pt-1 pb-1 text-ui-sm font-medium tracking-[0.05em] text-muted-foreground/75 uppercase", className)}
      data-slot="select-label"
      {...props}
    />
  )
}

/**
 * The 26px row the dropdown menu sets, so a select and a menu opening beside
 * each other read as one system.
 *
 * `hint` is trailing detail for the row — a shortcut, a raw id — and it sits
 * outside `ItemText` deliberately: the trigger mirrors `ItemText` verbatim, so
 * anything put inside it turns up in the closed field too.
 */
function SelectItem({
  className,
  children,
  hint,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item> & { hint?: React.ReactNode }) {
  return (
    <SelectPrimitive.Item
      className={cn(
        "relative flex min-h-[1.625rem] w-full cursor-default items-center gap-2 rounded-[var(--radius-item)] py-1 pr-7 pl-2.5 text-content leading-none outline-none transition-colors duration-75 select-none focus:bg-accent focus:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
        className
      )}
      data-slot="select-item"
      {...props}
    >
      {/* No `asChild` here. Radix clones this node into the trigger to show the
          current value, and handing it a child of our own to render breaks the
          item's own selection — clicking a row closed the popup and changed
          nothing. Style the span Radix renders instead. */}
      <SelectPrimitive.ItemText className="min-w-0 flex-1 truncate">{children}</SelectPrimitive.ItemText>
      {hint && <span className="shrink-0 text-ui text-muted-foreground">{hint}</span>}
      <span className="pointer-events-none absolute right-2 flex size-3.5 items-center justify-center opacity-70">
        <SelectPrimitive.ItemIndicator>
          <Check />
        </SelectPrimitive.ItemIndicator>
      </span>
    </SelectPrimitive.Item>
  )
}

function SelectSeparator({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return <SelectPrimitive.Separator className={cn("pointer-events-none -mx-1.5 my-1 h-px bg-border", className)} data-slot="select-separator" {...props} />
}

function SelectScrollUpButton({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  return (
    <SelectPrimitive.ScrollUpButton
      className={cn("z-10 flex cursor-default items-center justify-center bg-popover py-1 [&_svg:not([class*='size-'])]:size-3.5", className)}
      data-slot="select-scroll-up-button"
      {...props}
    >
      <ChevronUp />
    </SelectPrimitive.ScrollUpButton>
  )
}

function SelectScrollDownButton({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  return (
    <SelectPrimitive.ScrollDownButton
      className={cn("z-10 flex cursor-default items-center justify-center bg-popover py-1 [&_svg:not([class*='size-'])]:size-3.5", className)}
      data-slot="select-scroll-down-button"
      {...props}
    >
      <ChevronDown />
    </SelectPrimitive.ScrollDownButton>
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}
