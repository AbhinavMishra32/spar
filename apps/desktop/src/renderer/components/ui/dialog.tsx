"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "radix-ui"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"

import { useControlledState } from "@/hooks/use-controlled-state"
import { cn } from "@/lib/utils"
import { modalContentVariants, modalOverlayVariants } from "@/components/ui/overlay-motion"
import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"

/* Radix tears a closed dialog out of the tree immediately, so the scrim and the
   sheet would both vanish on the same frame. Mirroring the open state here lets
   AnimatePresence keep the portal alive for the length of the exit; the portal
   is `forceMount`ed and this state decides when it really goes. */
const DialogOpenContext = React.createContext(false)

function Dialog({
  open,
  defaultOpen,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  const [isOpen, setIsOpen] = useControlledState<boolean>({
    ...(open === undefined ? {} : { value: open }),
    defaultValue: defaultOpen ?? false,
    ...(onOpenChange ? { onChange: onOpenChange } : {}),
  })

  return (
    <DialogOpenContext.Provider value={isOpen}>
      <DialogPrimitive.Root
        data-slot="dialog"
        {...(open === undefined ? {} : { open })}
        {...(defaultOpen === undefined ? {} : { defaultOpen })}
        onOpenChange={setIsOpen}
        {...props}
      />
    </DialogOpenContext.Provider>
  )
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  children,
  ...props
}: Omit<React.ComponentProps<typeof DialogPrimitive.Portal>, "forceMount">) {
  const isOpen = React.useContext(DialogOpenContext)

  return (
    <AnimatePresence>
      {isOpen && (
        <DialogPrimitive.Portal data-slot="dialog-portal" forceMount {...props}>
          {children}
        </DialogPrimitive.Portal>
      )}
    </AnimatePresence>
  )
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: Omit<React.ComponentProps<typeof DialogPrimitive.Overlay>, "asChild" | "forceMount">) {
  const overlay = React.useMemo(() => modalOverlayVariants(), [])

  return (
    <DialogPrimitive.Overlay asChild forceMount {...props}>
      <motion.div
        animate="visible"
        className={cn(
          "fixed inset-0 isolate z-50 bg-black/10 supports-backdrop-filter:backdrop-blur-xs",
          className
        )}
        data-slot="dialog-overlay"
        exit="exit"
        initial="hidden"
        variants={overlay}
      />
    </DialogPrimitive.Overlay>
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: Omit<React.ComponentProps<typeof DialogPrimitive.Content>, "asChild" | "forceMount"> & {
  showCloseButton?: boolean
}) {
  const reduced = useReducedMotion() ?? false
  const content = React.useMemo(() => modalContentVariants(reduced), [reduced])

  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content asChild forceMount {...props}>
        {/* The centering translate lives on Tailwind's `translate` property, so
            motion's `transform` (the scale and the lift) composes with it
            instead of fighting it — don't swap these classes for a transform. */}
        <motion.div
          animate="visible"
          className={cn(
            "fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 outline-none sm:max-w-sm data-closed:pointer-events-none",
            className
          )}
          data-slot="dialog-content"
          exit="exit"
          initial="hidden"
          variants={content}
        >
          {children}
          {showCloseButton && (
            <DialogPrimitive.Close data-slot="dialog-close" asChild>
              <Button
                variant="ghost"
                className="absolute top-2 right-2"
                size="icon-sm"
              >
                <XIcon
                />
                <span className="sr-only">Close</span>
              </Button>
            </DialogPrimitive.Close>
          )}
        </motion.div>
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Close</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "font-heading text-base leading-none font-medium",
        className
      )}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
