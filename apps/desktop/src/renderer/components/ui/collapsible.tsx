import { Collapsible as CollapsiblePrimitive } from "radix-ui"
import { createContext, useContext, useState } from "react"
import { motion, useReducedMotion } from "motion/react"

/** The app's disclosure curve: quick off the mark, long tail into the stop. */
const EASE = [0.32, 0.72, 0, 1] as const

const Expanded = createContext(false)

function Collapsible({
  open,
  defaultOpen = false,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.Root>) {
  const [internal, setInternal] = useState(defaultOpen)
  const expanded = open ?? internal
  return (
    <Expanded.Provider value={expanded}>
      <CollapsiblePrimitive.Root
        data-slot="collapsible"
        {...props}
        open={expanded}
        onOpenChange={(next) => { setInternal(next); onOpenChange?.(next) }}
      />
    </Expanded.Provider>
  )
}

function CollapsibleTrigger({
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleTrigger>) {
  return (
    <CollapsiblePrimitive.CollapsibleTrigger
      data-slot="collapsible-trigger"
      {...props}
    />
  )
}

function CollapsibleContent({
  children,
  className,
  expandDuration,
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleContent> & { expandDuration?: number }) {
  const expanded = useContext(Expanded)
  const reduced = useReducedMotion()
  return (
      <motion.div
        className={className}
        initial={false}
        animate={{ height: expanded ? "auto" : 0, opacity: expanded ? 1 : 0 }}
        /* One curve, both directions, and the panel is the thing that carries
           it: height leads and everything else is timed off it. Opening is a
           spring so the last few pixels decelerate instead of stopping dead —
           a tween lands flat, and against a payload that is mostly straight
           lines the flat landing is the frame you notice. Closing is a tween,
           slightly quicker, because a spring closing means a panel that is
           still settling after the thing in it has gone.

           The fade is the asymmetric half. Opening, it trails the height by a
           beat and takes most of the expansion, so the panel reads as being
           uncovered rather than as a box that appears and then grows. Closing,
           it runs ahead of the height and finishes early, so the space folds up
           empty and no text is legible while it is being squashed. */
        transition={reduced ? { duration: 0 } : {
          height: expanded
            ? { type: "spring", visualDuration: expandDuration ?? 0.52, bounce: 0.06 }
            : { type: "tween", duration: 0.34, ease: EASE },
          opacity: expanded
            ? { duration: 0.34, delay: 0.05, ease: EASE }
            : { duration: 0.15, ease: "linear" },
        }}
        style={{ overflow: "hidden" }}
        inert={!expanded}
      >
        <CollapsiblePrimitive.CollapsibleContent
          data-slot="collapsible-content"
          {...props}
          forceMount
        >
        {/* The content's own small travel, under the clip. Held to a few pixels
            and a fraction of a percent: enough that the panel's contents arrive
            with it rather than sitting still inside a box that grows around
            them, and not enough to read as a second animation. */}
        <motion.div
          initial={false}
          animate={{
            y: expanded || reduced ? 0 : -8,
            scale: expanded || reduced ? 1 : 0.985,
          }}
          style={{ transformOrigin: "top center" }}
          transition={{
            duration: reduced ? 0 : expanded ? (expandDuration ?? 0.5) : 0.26,
            ease: EASE,
          }}
        >{children}</motion.div>
        </CollapsiblePrimitive.CollapsibleContent>
      </motion.div>
  )
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent }
