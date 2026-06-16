import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-9 w-full min-w-0 rounded-[var(--clack-radius-button)] border border-[color:var(--clack-border-subtle)] bg-[var(--clack-surface-2)] px-3 py-1 text-base text-[var(--clack-text-1)] transition-[color,box-shadow,background-color] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-[var(--clack-text-1)] placeholder:text-[var(--clack-text-3)] focus-visible:border-[color:var(--clack-border-accent)] focus-visible:ring-2 focus-visible:ring-[var(--clack-focus)] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 md:text-sm dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Input }
