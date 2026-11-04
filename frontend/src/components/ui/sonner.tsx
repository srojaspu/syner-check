import type * as React from "react"
import { Toaster as Sonner, toast, type ToasterProps } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import { CheckmarkCircle02Icon, InformationCircleIcon, Alert02Icon, MultiplicationSignCircleIcon, Loading03Icon } from "@hugeicons/core-free-icons"
import { useOptionalTheme } from "@/theme/ThemeContext"

const Toaster = ({ ...props }: ToasterProps) => {
  const themeContext = useOptionalTheme()
  const theme = props.theme ?? themeContext?.resolved ?? "light"

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      customAriaLabel="Bandeja de notificaciones"
      position="bottom-right"
      className="toaster group print:hidden"
      icons={{
        success: (
          <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={2} className="size-4" />
        ),
        info: (
          <HugeiconsIcon icon={InformationCircleIcon} strokeWidth={2} className="size-4" />
        ),
        warning: (
          <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} className="size-4" />
        ),
        error: (
          <HugeiconsIcon icon={MultiplicationSignCircleIcon} strokeWidth={2} className="size-4" />
        ),
        loading: (
          <HugeiconsIcon icon={Loading03Icon} strokeWidth={2} className="size-4 animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
          "--width": "min(28rem, calc(100vw - 2rem))",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast w-full pointer-events-auto",
        },
      }}
      {...props}
    />
  )
}

export { Toaster, toast }
