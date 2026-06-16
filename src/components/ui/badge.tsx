import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-[var(--clack-radius-button)] border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-all focus-visible:border-[color:var(--clack-border-accent)] focus-visible:ring-2 focus-visible:ring-[var(--clack-focus)] has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-[var(--clack-accent)] text-[var(--clack-text-inverse)] [a]:hover:bg-[var(--clack-accent-strong)]",
        secondary:
          "border-[color:var(--clack-border-subtle)] bg-[var(--clack-surface-2)] text-[var(--clack-text-2)] [a]:hover:bg-[var(--clack-surface-3)]",
        destructive:
          "bg-destructive/10 text-destructive focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:focus-visible:ring-destructive/40 [a]:hover:bg-destructive/20",
        outline:
          "border-[color:var(--clack-border-subtle)] text-[var(--clack-text-2)] [a]:hover:bg-[var(--clack-surface-2)] [a]:hover:text-[var(--clack-text-1)]",
        ghost:
          "text-[var(--clack-text-3)] hover:bg-[var(--clack-surface-2)] hover:text-[var(--clack-text-1)]",
        link: "text-primary underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
