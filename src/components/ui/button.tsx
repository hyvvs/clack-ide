import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-[var(--clack-radius-button)] border border-transparent bg-clip-padding text-sm font-semibold whitespace-nowrap transition-all outline-none select-none focus-visible:border-[color:var(--clack-focus)] focus-visible:ring-2 focus-visible:ring-[color:var(--clack-focus)] active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-45 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "border-[color:var(--clack-border-accent)] bg-[var(--clack-accent)] text-[var(--clack-text-inverse)] shadow-[inset_0_1px_0_rgba(255,255,255,0.30),0_10px_24px_rgba(0,0,0,0.18)] hover:bg-[var(--clack-accent-strong)]",
        outline:
          "border-[color:var(--clack-border-strong)] bg-[var(--clack-surface-1)] text-[var(--clack-text-2)] hover:border-[color:var(--clack-border-accent)] hover:bg-[var(--clack-surface-2)] hover:text-[var(--clack-text-1)] aria-expanded:border-[color:var(--clack-border-accent)] aria-expanded:bg-[var(--clack-surface-2)] aria-expanded:text-[var(--clack-text-1)]",
        secondary:
          "border-[color:var(--clack-border-subtle)] bg-[var(--clack-surface-2)] text-[var(--clack-text-1)] hover:bg-[var(--clack-surface-3)] aria-expanded:bg-[var(--clack-surface-3)] aria-expanded:text-[var(--clack-text-1)]",
        ghost:
          "text-[var(--clack-text-3)] hover:bg-[rgba(159,177,210,0.09)] hover:text-[var(--clack-text-1)] aria-expanded:bg-[rgba(159,177,210,0.11)] aria-expanded:text-[var(--clack-text-1)]",
        destructive:
          "border-destructive/40 bg-destructive/15 text-destructive hover:bg-destructive/25 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40",
        toolbar:
          "clack-toolbar-button border-transparent bg-transparent text-[var(--clack-text-3)] hover:bg-[rgba(159,177,210,0.09)] hover:text-[var(--clack-text-1)]",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-9 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
        xs: "h-6 gap-1 px-2.5 text-xs has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1 px-3 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        lg: "h-10 gap-1.5 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        icon: "size-9",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
