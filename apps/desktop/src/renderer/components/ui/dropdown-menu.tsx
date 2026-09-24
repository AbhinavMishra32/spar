import * as React from "react"
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui"
import { AnimatePresence, motion } from "motion/react"
import { Check, ChevronRight } from "lucide-react"

import { useControlledState } from "@/hooks/use-controlled-state"
import { useScrollFade } from "@/hooks/use-scroll-fade"
import { cn } from "@/lib/utils"

const DropdownMenuGroup = DropdownMenuPrimitive.Group
export { DropdownMenuGroup }

/* Only one submenu in a menu is open at a time, so the menu owns that fact
   rather than each Sub keeping its own. That is what lets one sub trigger hand
   the submenu over to the next directly — see `useMenuHover`. */
type Corridor = { fromX: number; fromY: number; edgeX: number; top: number; bottom: number; deadline: number }
/** The last two places the pointer was seen inside this menu. A `pointerleave`
 *  reports where the pointer has *arrived*, not where it left from, so the
 *  direction it was travelling has to be remembered rather than read off the
 *  event that needs it. */
type Trail = { x: number; y: number; px: number; py: number }
type SubGroup = {
  active: string | null
  /** Set while one submenu is replacing another, which is the one transition
      that must not animate — see `DropdownMenuSubContent`. */
  instant: boolean
  open(id: string | null, instant: boolean): void
  corridor: React.RefObject<Corridor | null>
  trail: React.RefObject<Trail | null>
}
const SubGroupContext = React.createContext<SubGroup | null>(null)
const SubIdContext = React.createContext<string | null>(null)

/** Base UI's `delay: 100` / `closeDelay: 0`, which is also Radix's own — but
 *  only for the first submenu. Once one is open the menu is already in submenu
 *  mode, and the next one switches on the frame the pointer arrives. */
const SUB_OPEN_DELAY = 100
/** How long the diagonal into an open submenu is protected for. */
const CORRIDOR_MS = 250

/** Is the pointer inside the triangle from where it left the trigger to the
 *  near edge of the submenu it was heading for? */
function inCorridor(corridor: Corridor | null, x: number, y: number) {
  if (!corridor || performance.now() > corridor.deadline) return false
  const { fromX, fromY, edgeX, top, bottom } = corridor
  const side = (ax: number, ay: number, bx: number, by: number) => (x - bx) * (ay - by) - (ax - bx) * (y - by)
  const a = side(fromX, fromY, edgeX, top)
  const b = side(edgeX, top, edgeX, bottom)
  const c = side(edgeX, bottom, fromX, fromY)
  return !((a < 0 || b < 0 || c < 0) && (a > 0 || b > 0 || c > 0))
}

function composeHandler<E extends React.SyntheticEvent>(theirs: ((event: E) => void) | undefined, ours: (event: E) => void) {
  return (event: E) => {
    theirs?.(event)
    ours(event)
  }
}

/**
 * Hover, owned by the menu rather than by Radix.
 *
 * Radix gates every row on a grace polygon: when the pointer leaves an open
 * sub trigger it lays a five-point region over the *whole* submenu and holds it
 * for 300ms, and while the pointer is inside it and still drifting that way,
 * every item's `onItemEnter` is `preventDefault`ed — which skips the focus that
 * is the highlight. The intent is right and the shape is not. With the submenu
 * overlapping the parent's edge, that region covers most of the menu, so moving
 * down the list beside an open submenu lights up nothing for a third of a
 * second. Fast movement across several providers spends its whole time inside
 * it, which is the stall.
 *
 * So the rows answer to the pointer directly. Every handler here runs before
 * Radix's and calls `preventDefault()`, which is what `composeEventHandlers`
 * reads as "this one is handled" — Radix's polygon, its own open timer and its
 * own focus call all stay out of it. In exchange this owes the menu the one
 * thing the polygon was for, and pays it with a real triangle: from the point
 * the pointer left the trigger to the near edge of the submenu, and nothing
 * else. The diagonal reach is protected; the rows below it are not blocked.
 */
function useMenuHover(subId: string | null) {
  const group = React.useContext(SubGroupContext)
  const timer = React.useRef(0)

  const cancel = React.useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = 0
  }, [])

  React.useEffect(() => cancel, [cancel])

  const onPointerMove = (event: React.PointerEvent<HTMLElement>) => {
    /* `defaultPrevented` here is somebody upstream claiming the pointer — the
       model picker holds focus in the search field that way while a query is
       typed. */
    if (event.pointerType !== "mouse" || event.defaultPrevented) return
    const item = event.currentTarget
    if (group) {
      const last = group.trail.current
      group.trail.current = { x: event.clientX, y: event.clientY, px: last?.x ?? event.clientX, py: last?.y ?? event.clientY }
    }
    if (item.hasAttribute("data-disabled")) return
    if (group && inCorridor(group.corridor.current, event.clientX, event.clientY)) {
      event.preventDefault()
      return
    }
    event.preventDefault()
    if (group) group.corridor.current = null
    if (document.activeElement !== item) item.focus({ preventScroll: true })
    if (!group) return

    if (!subId) {
      /* A plain row takes the menu back from whatever submenu was open. */
      cancel()
      if (group.active !== null) group.open(null, false)
      return
    }
    if (group.active === subId) return
    if (group.active !== null) {
      /* Already in submenu mode: switch on this frame, and without an
         animation — see `DropdownMenuSubContent`. */
      cancel()
      group.open(subId, true)
      return
    }
    if (timer.current) return
    timer.current = window.setTimeout(() => {
      timer.current = 0
      group.open(subId, false)
    }, SUB_OPEN_DELAY)
  }

  const onPointerLeave = (event: React.PointerEvent<HTMLElement>) => {
    if (event.pointerType !== "mouse") return
    cancel()
    if (!subId || !group || group.active !== subId) return
    /* Radix keeps the open submenu's id here while it is open, which is the
       cheapest way to reach the element it belongs to. */
    const controls = event.currentTarget.getAttribute("aria-controls")
    const popup = controls ? document.getElementById(controls) : null
    event.preventDefault()
    const trail = group.trail.current
    if (!popup || !trail) return
    const rect = popup.getBoundingClientRect()
    const fromLeft = popup.dataset.side !== "left"
    const drift = trail.x - trail.px
    /* Only a pointer actually heading for the submenu gets protected. Straight
       down the list is not that, and it is most of what this menu is for: no
       corridor, so the next trigger takes over on the frame it is reached. */
    if (fromLeft ? drift <= 0 : drift >= 0) return
    group.corridor.current = {
      fromX: trail.px,
      fromY: trail.py,
      /* The submenu overlaps the parent's rim, so its near edge can already be
         behind where the pointer set off from. Pushing the apex past it keeps
         the triangle pointing the way the pointer is actually going. */
      edgeX: fromLeft ? Math.max(rect.left, trail.px + 12) : Math.min(rect.right, trail.px - 12),
      top: rect.top,
      bottom: rect.bottom,
      deadline: performance.now() + CORRIDOR_MS,
    }
  }

  return { onPointerMove, onPointerLeave }
}

/* The rows themselves don't animate. The surface is the thing that opens and
   closes; text that slides or fades on its own schedule inside it reads as the
   menu still assembling itself after it has already arrived.

   The highlight is no exception: a row lights up the instant the pointer is on
   it. A highlight that animates between rows is something you watch arrive,
   and on a menu it is always a frame behind the thing it is meant to be
   following. So `itemClass` carries no `transition-colors` — even 75ms of it
   smears the fill across the gap while the pointer runs down the list, which
   is the drag you feel rather than see. Don't put one back. */
function DropdownMenu(props: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />
}

function DropdownMenuTrigger({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
  return (
    <DropdownMenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />
  )
}

/* The open and close are CSS keyframes on the surface, run by Radix's own
   presence — nothing in React waits on them.
 *
 * That distinction is the whole feel of the thing. Driving the same fade with
 * an animation library means the menu is mounted by a state change, its exit is
 * held open by a state change, and a submenu handing over to its neighbour is
 * two components' worth of enter/exit bookkeeping settling before the pointer
 * is allowed to matter. Keyframes run on the compositor and are nobody's
 * dependency: hover lands on the frame the pointer lands, and the animation is
 * something the surface happens to be doing at the time.
 *
 * `data-[state=closed]:pointer-events-none` is the price of animating the exit
 * at all: for the ~100ms the menu spends leaving it is still a real element
 * under the cursor, and without this a click aimed at what's behind it lands on
 * a dying menu.
 *
 * It has to be spelled `data-[state=closed]`: Tailwind compiles the shorthand
 * `data-closed:` to `[data-closed]`, which Base UI sets and Radix does not — so
 * the short form is a rule that matches nothing. */
const surfaceBase =
  "menu-surface z-50 flex max-h-(--radix-dropdown-menu-content-available-height) min-w-[11rem] origin-(--radix-dropdown-menu-content-transform-origin) flex-col overflow-hidden data-[state=closed]:pointer-events-none"

const surfaceMotion = cn(
  "duration-100 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
  "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
  "data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2"
)

const surfaceClass = cn(surfaceBase, surfaceMotion)

/**
 * The rows scroll inside the surface rather than the surface scrolling itself,
 * so the edge fade can mask the list without taking the glass and its rim with
 * it. The inner wrapper is what the fade measures against — a filtered list
 * changes height without ever firing a scroll event.
 */
function MenuScroller({ children }: { children?: React.ReactNode }) {
  const { ref, style } = useScrollFade<HTMLDivElement>()
  /* Lives here rather than on the Root so it dies with the surface: a menu that
     reopens should not remember which submenu was last open. */
  const [sub, setSub] = React.useState<{ active: string | null; instant: boolean }>({ active: null, instant: false })
  const corridor = React.useRef<Corridor | null>(null)
  const trail = React.useRef<Trail | null>(null)
  const group = React.useMemo<SubGroup>(
    () => ({ active: sub.active, instant: sub.instant, open: (id, instant) => setSub({ active: id, instant }), corridor, trail }),
    [sub]
  )

  return (
    <div className="app-scroll min-h-0 flex-1 overflow-y-auto p-1" ref={ref} style={style}>
      <SubGroupContext.Provider value={group}>
        <div>{children}</div>
      </SubGroupContext.Provider>
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
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        className={cn(surfaceClass, className)}
        data-slot="dropdown-menu-content"
        side={side}
        sideOffset={sideOffset}
        {...props}
      >
        <MenuScroller>{children}</MenuScroller>
      </DropdownMenuPrimitive.Content>
    </DropdownMenuPrimitive.Portal>
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
        /* `text-ui` is 12px, which is their `text-xs` exactly; `text-ui-sm` is
           11px and was a point light. */
        "px-2 py-0.5 text-ui font-medium tracking-wide text-muted-foreground select-none",
        className
      )}
      data-slot="dropdown-menu-label"
      {...props}
    >
      {children}
    </DropdownMenuPrimitive.Label>
  )
}

/* Aside's row, tightened a notch: `min-h-7` (28px), `rounded-lg`, `px-2 py-0.5`,
   `gap-2`, 16px icons, and 50% opacity when disabled. Theirs stands 32px, which
   is right for a sidebar you read and loose for a list you scan — these menus
   are mostly models, and a shorter row puts more of them on screen at once. The one thing not taken
   from it is the type size — theirs is 14px because their whole sidebar is, and
   a menu that sets its own size a point above the app around it stops reading
   as part of it. `leading-none` is load-bearing: text-content carries a 22px
   line box that would otherwise set the height itself and undo the min-height. */
const itemClass =
  "relative flex min-h-7 cursor-default select-none items-center gap-2 rounded-[var(--radius-item)] px-2 py-0.5 text-content leading-none outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"

function DropdownMenuItem({
  className,
  variant = "default",
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & {
  variant?: "default" | "destructive"
}) {
  const hover = useMenuHover(null)

  return (
    <DropdownMenuPrimitive.Item
      onPointerLeave={composeHandler(props.onPointerLeave, hover.onPointerLeave)}
      onPointerMove={composeHandler(props.onPointerMove, hover.onPointerMove)}
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
  const hover = useMenuHover(null)

  return (
    <DropdownMenuPrimitive.Item
      onPointerLeave={composeHandler(props.onPointerLeave, hover.onPointerLeave)}
      onPointerMove={composeHandler(props.onPointerMove, hover.onPointerMove)}
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
  const id = React.useId()
  const group = React.useContext(SubGroupContext)
  /* The group owns the open state unless the call site insists on owning it. */
  const grouped = group !== null && open === undefined

  const [localOpen, setLocalOpen] = useControlledState<boolean>({
    ...(open === undefined ? {} : { value: open }),
    defaultValue: defaultOpen ?? false,
    ...(onOpenChange ? { onChange: onOpenChange } : {}),
  })

  const isOpen = grouped ? group.active === id : localOpen
  const setOpen = (next: boolean) => {
    if (grouped) group.open(next ? id : null, false)
    else setLocalOpen(next)
    if (grouped) onOpenChange?.(next)
  }

  return (
    <SubIdContext.Provider value={id}>
      <DropdownMenuPrimitive.Sub
        data-slot="dropdown-menu-sub"
        {...(grouped ? { open: isOpen } : open === undefined ? {} : { open })}
        {...(defaultOpen === undefined || grouped ? {} : { defaultOpen })}
        onOpenChange={setOpen}
        {...props}
      />
    </SubIdContext.Provider>
  )
}

function DropdownMenuSubTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubTrigger>) {
  const hover = useMenuHover(React.useContext(SubIdContext))

  return (
    <DropdownMenuPrimitive.SubTrigger
      onPointerLeave={composeHandler(props.onPointerLeave, hover.onPointerLeave)}
      onPointerMove={composeHandler(props.onPointerMove, hover.onPointerMove)}
      className={cn(itemClass, "data-[state=open]:bg-accent", className)}
      data-slot="dropdown-menu-sub-trigger"
      {...props}
    >
      {children}
      <ChevronRight className="ml-auto size-3.5 opacity-45" />
    </DropdownMenuPrimitive.SubTrigger>
  )
}

/* The submenu overlaps its parent's rim by a hair and lifts its own padding, so
   its first row lands level with the row that opened it. Two menus edge to edge
   with a gap between them read as two windows; overlapping, they read as one
   stack of sheets — which is what they are. */
function DropdownMenuSubContent({
  className,
  alignOffset = -4,
  sideOffset = -4,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubContent>) {
  /* Read from the *parent* menu's group — this component sits above the
     provider its own `MenuScroller` installs. */
  const group = React.useContext(SubGroupContext)

  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.SubContent
        alignOffset={alignOffset}
        className={cn(group?.instant ? surfaceBase : surfaceClass, className)}
        data-slot="dropdown-menu-sub-content"
        sideOffset={sideOffset}
        {...props}
      >
        <MenuScroller>{children}</MenuScroller>
      </DropdownMenuPrimitive.SubContent>
    </DropdownMenuPrimitive.Portal>
  )
}

/**
 * The keys that do the same thing as the row, parked at the right edge. Muted
 * and never bolder than the label: it is a reminder, not a second label — and
 * `ml-auto` is what puts it against the edge without every call site having to
 * add a spacer of its own.
 */
function DropdownMenuShortcut({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn("ml-auto pl-4 font-sans text-content text-muted-foreground/55", className)}
      data-slot="dropdown-menu-shortcut"
      {...props}
    />
  )
}

function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      className={cn("-mx-1 my-0.5 h-px bg-border", className)}
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
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
}
