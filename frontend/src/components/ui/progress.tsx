import * as React from "react"
import { cn } from "cn"

function Progress({
  className,
  value = 0,
  ...props
}: React.ComponentProps<"div"> & { value?: number }) {
  const safe = Number.isFinite(value)
    ? Math.min(100, Math.max(0, value))
    : 0

  return (
    <div
      data-slot="progress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={safe}
      className={cn(
        "relative h-2 w-full overflow-hidden rounded-full bg-primary/15",
        className
      )}
      {...props}
    >
      <div
        data-slot="progress-indicator"
        className="h-full w-full flex-1 rounded-full bg-primary transition-[width] duration-300 ease-out"
        style={{ width: `${safe}%` }}
      />
    </div>
  )
}

export { Progress }
