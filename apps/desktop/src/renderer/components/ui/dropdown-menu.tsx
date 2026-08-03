import * as React from "react"
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { Check, ChevronRight } from "lucide-react"

import { useControlledState } from "@/hooks/use-controlled-state"
import { useScrollFade } from "@/hooks/use-scroll-fade"
import { cn } from "@/lib/utils"
import { overlaySurfaceVariants, type OverlaySide } from "@/components/ui/overlay-motion"

/* Radix unmounts a closed menu, which leaves nothing to animate out. Mirroring
   its open state up here lets AnimatePresence hold the portal open for the
   length of the exit — the menu is `forceMount`ed and this state, not Radix's,
   decides when it actually leaves the tree. */
const MenuOpenContext = React.createContext(false)

/* The rows themselves don't animate. The surface is the thing that opens and
   closes; text that slides or fades on its own schedule inside it reads as the
   menu still assembling itself after it has already arrived. */

function DropdownMenu({
  open,
  defaultOpen,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  const [isOpen, setIsOpen] = useControlledState<boolean>({
    ...(open === undefined ? {} : { value: open }),
    defaultValue: defaultOpen ?? false,
    ...(onOpenChange ? { onChange: onOpenChange } : {}),
  })

  return (
    <MenuOpenContext.Provider value={isOpen}>
      <DropdownMenuPrimitive.Root
        data-slot="dropdown-menu"
        {...(open === undefined ? {} : { open })}
        {...(defaultOpen === undefined ? {} : { defaultOpen })}
        onOpenChange={setIsOpen}
        {...props}
      />
    </MenuOpenContext.Provider>
  )
}

function DropdownMenuTrigger({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
  return (
    <DropdownMenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />
  )
}

/* The macOS material lives in .menu-surface so menus, popovers and the file
   tree all read as the same pane of glass. The 6px rim is what --radius-menu is
   derived from — keep the two in step, or the row highlight stops sitting
   concentric inside the shell.

   `data-closed:pointer-events-none` is the price of forceMount: for the ~120ms
   the menu spends leaving it is still a real element under the cursor, and
   without this a click aimed at what's behind it lands on a dying menu. */
const surfaceClass =
  "menu-surface z-50 flex max-h-(--radix-dropdown-menu-content-available-height) min-w-[11rem] origin-(--radix-dropdown-menu-content-transform-origin) flex-col overflow-hidden data-closed:pointer-events-none"

/**
 * The rows scroll inside the surface rather than the surface scrolling itself,
 * so the edge fade can mask the list without taking the glass and its rim with
 * it. The inner wrapper is what the fade measures against — a filtered list
 * changes height without ever firing a scroll event.
 */
function MenuScroller({ children }: { children?: React.ReactNode }) {
  const { ref, style } = useScrollFade<HTMLDivElement>()

  return (
    <div className="app-scroll min-h-0 flex-1 overflow-y-auto p-1.5" ref={ref} style={style}>
      <div>{children}</div>
    </div>
  )
}

function DropdownMenuContent({
  className,
  sideOffset = 4,
  side = "bottom",
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  const isOpen = React.useContext(MenuOpenContext)
  const reduced = useReducedMotion() ?? false
  const surface = React.useMemo(() => overlaySurfaceVariants({ side, reduced }), [side, reduced])

  return (
    <AnimatePresence>
      {isOpen && (
        <DropdownMenuPrimitive.Portal forceMount>
          <DropdownMenuPrimitive.Content
            asChild
            forceMount
            side={side}
            sideOffset={sideOffset}
            {...props}
          >
            <motion.div
              animate="visible"
              className={cn(surfaceClass, className)}
              data-slot="dropdown-menu-content"
              exit="exit"
              initial="hidden"
              variants={surface}
            >
              <MenuScroller>{children}</MenuScroller>
            </motion.div>
          </DropdownMenuPrimitive.Content>
        </DropdownMenuPrimitive.Portal>
      )}
    </AnimatePresence>
  )
}

function DropdownMenuLabel({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Label>) {
  return (
    <DropdownMenuPrimitive.Label
      className={cn(
        "px-2.5 pb-1 pt-1 text-ui-sm font-medium tracking-[0.05em] text-muted-foreground/75 uppercase",
        className
      )}
      data-slot="dropdown-menu-label"
      {...props}
    >
      {children}
    </DropdownMenuPrimitive.Label>
  )
}

/* A submenu is anchored to the row beside it, not to something above it, so it
   opens sideways. It has its own AnimatePresence, so it opens on its own beat
   rather than on the parent's. */
const SUB_SIDE: OverlaySide = "right"

/* A 26px row at the app's 13px text, near the AppKit menu proportion. The web
   default — 32px and a 16px icon — is a touch target, and a desktop menu that
   opens under the pointer never needed one. `leading-none` is load-bearing:
   text-content carries a 22px line box that would otherwise set the height on
   its own and undo the min-height. */
const itemClass =
  "relative flex min-h-[1.625rem] cursor-default select-none items-center gap-2 rounded-[var(--radius-item)] px-2.5 py-1 text-content leading-none outline-none transition-colors duration-75 data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5"

function DropdownMenuItem({
  className,
  variant = "default",
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & {
  variant?: "default" | "destructive"
}) {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(
        itemClass,
        variant === "destructive" &&
          "text-destructive data-highlighted:bg-destructive/10 data-highlighted:text-destructive",
        className
      )}
      data-slot="dropdown-menu-item"
      {...props}
    >
      {children}
    </DropdownMenuPrimitive.Item>
  )
}

/**
 * Selectable row. The mark trails the label rather than sitting in a reserved
 * gutter — a gutter indents every row to make room for something only one row
 * ever shows, which reads as a stray left margin.
 */
function DropdownMenuCheckItem({
  checked,
  children,
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & {
  checked?: boolean
}) {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(itemClass, className)}
      data-slot="dropdown-menu-check-item"
      {...props}
    >
      {children}
      {/* Springs in on its own so switching selection reads as the mark
          moving to the new row, not as the row silently restyling. */}
      <AnimatePresence initial={false}>
        {checked && (
          <motion.span
            animate={{ opacity: 0.7, scale: 1 }}
            className="ml-auto flex"
            exit={{ opacity: 0, scale: 0.6 }}
            initial={{ opacity: 0, scale: 0.6 }}
            transition={{ type: "spring", stiffness: 700, damping: 30, mass: 0.5 }}
          >
            <Check className="size-3.5" />
          </motion.span>
        )}
      </AnimatePresence>
    </DropdownMenuPrimitive.Item>
  )
}

function DropdownMenuSub({
  open,
  defaultOpen,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Sub>) {
  const [isOpen, setIsOpen] = useControlledState<boolean>({
    ...(open === undefined ? {} : { value: open }),
    defaultValue: defaultOpen ?? false,
    ...(onOpenChange ? { onChange: onOpenChange } : {}),
  })

  return (
    <MenuOpenContext.Provider value={isOpen}>
      <DropdownMenuPrimitive.Sub
        data-slot="dropdown-menu-sub"
        {...(open === undefined ? {} : { open })}
        {...(defaultOpen === undefined ? {} : { defaultOpen })}
        onOpenChange={setIsOpen}
        {...props}
      />
    </MenuOpenContext.Provider>
  )
}

function DropdownMenuSubTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubTrigger>) {
  return (
    <DropdownMenuPrimitive.SubTrigger
      className={cn(itemClass, "data-[state=open]:bg-accent", className)}
      data-slot="dropdown-menu-sub-trigger"
      {...props}
    >
      {children}
      <ChevronRight className="ml-auto size-3.5 opacity-45" />
    </DropdownMenuPrimitive.SubTrigger>
  )
}

function DropdownMenuSubContent({
  className,
  sideOffset = 2,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubContent>) {
  const isOpen = React.useContext(MenuOpenContext)
  const reduced = useReducedMotion() ?? false
  const surface = React.useMemo(
    () => overlaySurfaceVariants({ side: SUB_SIDE, reduced }),
    [reduced]
  )

  return (
    <AnimatePresence>
      {isOpen && (
        <DropdownMenuPrimitive.Portal forceMount>
          <DropdownMenuPrimitive.SubContent
            asChild
            forceMount
            sideOffset={sideOffset}
            {...props}
          >
            <motion.div
              animate="visible"
              className={cn(surfaceClass, className)}
              data-slot="dropdown-menu-sub-content"
              exit="exit"
              initial="hidden"
              variants={surface}
            >
              <MenuScroller>{children}</MenuScroller>
            </motion.div>
          </DropdownMenuPrimitive.SubContent>
        </DropdownMenuPrimitive.Portal>
      )}
    </AnimatePresence>
  )
}

function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      className={cn("-mx-1.5 my-1 h-px bg-border", className)}
      data-slot="dropdown-menu-separator"
      {...props}
    />
  )
}

export {
  DropdownMenu,
  DropdownMenuCheckItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
}
