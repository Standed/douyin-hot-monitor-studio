import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[8px] text-sm font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:pointer-events-none disabled:opacity-55',
  {
    variants: {
      variant: {
        default: 'border border-[var(--border-strong)] bg-[var(--accent)] text-[var(--accent-contrast)] shadow-sm hover:bg-[var(--accent-hover)]',
        secondary: 'border border-[var(--border-strong)] bg-[var(--accent-soft)] text-[var(--foreground)] hover:bg-[var(--control-hover)]',
        ghost: 'border border-transparent text-[var(--muted)] hover:bg-[var(--control-hover)] hover:text-[var(--foreground)]',
      },
      size: {
        default: 'h-11 px-4',
        sm: 'h-9 px-3',
        icon: 'size-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size, className }))} {...props} />
}
