import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils'

const badgeVariants = cva('inline-flex w-fit items-center gap-1.5 rounded-[8px] border px-2.5 py-1 text-xs font-bold', {
  variants: {
    variant: {
      default: 'border-[var(--border)] bg-[var(--badge-bg)] text-[var(--muted)]',
      success: 'border-[var(--badge-success-border)] bg-[var(--badge-success-bg)] text-[var(--badge-success-text)]',
      warning: 'border-[var(--badge-warning-border)] bg-[var(--badge-warning-bg)] text-[var(--badge-warning-text)]',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
})

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant, className }))} {...props} />
}
