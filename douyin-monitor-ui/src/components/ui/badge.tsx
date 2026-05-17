import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils'

const badgeVariants = cva('inline-flex w-fit items-center gap-1.5 rounded-[8px] border px-2.5 py-1 text-xs font-bold', {
  variants: {
    variant: {
      default: 'border-[var(--border)] bg-white/5 text-[var(--muted)]',
      success: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300',
      warning: 'border-amber-400/25 bg-amber-400/10 text-amber-300',
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
