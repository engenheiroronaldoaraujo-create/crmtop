import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80",
        outline: "text-foreground",
        success:
          "border-transparent bg-green-100 text-green-800 hover:bg-green-200 dark:border-green-500/25 dark:bg-green-500/15 dark:text-green-400 dark:hover:bg-green-500/25",
        warning:
          "border-transparent bg-amber-100 text-amber-800 hover:bg-amber-200 dark:border-amber-500/25 dark:bg-amber-500/15 dark:text-amber-400 dark:hover:bg-amber-500/25",
        info:
          "border-transparent bg-sky-100 text-sky-800 hover:bg-sky-200 dark:border-sky-500/25 dark:bg-sky-500/15 dark:text-sky-400 dark:hover:bg-sky-500/25",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
