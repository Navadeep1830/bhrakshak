import * as React from "react"

import { cn } from "@/lib/utils"

/** Material Design 3 outlined text field. */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "placeholder:text-on-surface-variant/70 selection:bg-primary selection:text-on-primary",
        "border outline-none flex h-10 w-full min-w-0 rounded-xs border-outline bg-transparent px-4 py-1 text-body-md transition-[border-color,box-shadow] duration-150",
        "focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/30",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium",
        className
      )}
      {...props}
    />
  )
}

export { Input }
