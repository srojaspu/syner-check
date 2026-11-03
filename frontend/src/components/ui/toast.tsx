"use client"

import { Toast as ToastPrimitive } from "@base-ui/react/toast"
import { cn } from "cn"
import { HugeiconsIcon } from "@hugeicons/react"
import { Cancel01Icon } from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"

const ToastProvider = ToastPrimitive.Provider

function ToastViewport({
  className,
  ...props
}: ToastPrimitive.Viewport.Props) {
  return (
    <ToastPrimitive.Portal>
      <ToastPrimitive.Viewport
        data-slot="toast-viewport"
        className={cn(
          "fixed right-4 bottom-4 z-[60] flex max-h-[85vh] w-[calc(100vw-2rem)] max-w-md flex-col gap-2.5 overflow-y-auto outline-hidden print:hidden",
          className,
        )}
        {...props}
      />
    </ToastPrimitive.Portal>
  )
}

function ToastRoot({ className, ...props }: ToastPrimitive.Root.Props) {
  return (
    <ToastPrimitive.Root
      data-slot="toast"
      className={cn(
        "group/toast relative flex w-full flex-col gap-1.5 rounded-2xl border bg-popover/95 p-4 text-sm text-popover-foreground shadow-2xl ring-1 ring-foreground/5 backdrop-blur-md transition-all duration-200 ease-out motion-reduce:transition-none data-ending-style:translate-y-2 data-ending-style:opacity-0 data-starting-style:translate-y-2 data-starting-style:opacity-0",
        className,
      )}
      {...props}
    />
  )
}

function ToastTitle({ className, ...props }: ToastPrimitive.Title.Props) {
  return (
    <ToastPrimitive.Title
      data-slot="toast-title"
      className={cn("font-medium leading-snug", className)}
      {...props}
    />
  )
}

function ToastDescription({
  className,
  ...props
}: ToastPrimitive.Description.Props) {
  return (
    <ToastPrimitive.Description
      data-slot="toast-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

function ToastAction({ className, ...props }: ToastPrimitive.Action.Props) {
  return (
    <ToastPrimitive.Action
      data-slot="toast-action"
      className={cn("inline-flex shrink-0 items-center", className)}
      {...props}
    />
  )
}

function ToastClose({
  className,
  ...props
}: ToastPrimitive.Close.Props) {
  return (
    <ToastPrimitive.Close
      data-slot="toast-close"
      render={
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={cn("absolute top-2.5 right-2.5", className)}
        />
      }
      aria-label="Cerrar notificación"
      {...props}
    >
      <HugeiconsIcon icon={Cancel01Icon} size={15} strokeWidth={2} />
    </ToastPrimitive.Close>
  )
}

export {
  ToastProvider,
  ToastViewport,
  ToastRoot,
  ToastTitle,
  ToastDescription,
  ToastAction,
  ToastClose,
}
