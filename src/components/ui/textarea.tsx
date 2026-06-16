import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full resize-none rounded-[var(--clack-radius-panel)] border border-[color:var(--clack-border-subtle)] bg-[var(--clack-surface-2)] px-3 py-3 text-base text-[var(--clack-text-1)] transition-[color,box-shadow,background-color] outline-none placeholder:text-[var(--clack-text-3)] focus-visible:border-[color:var(--clack-border-accent)] focus-visible:ring-2 focus-visible:ring-[var(--clack-focus)] disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 md:text-sm dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
