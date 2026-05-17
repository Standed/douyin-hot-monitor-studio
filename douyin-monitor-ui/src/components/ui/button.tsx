import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[8px] text-sm font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:pointer-events-none disabled:opacity-55',
  {
    variants: {
      variant: {
        default: 'border border-[rgba(0,213,255,0.38)] bg-[var(--accent)] text-[#02111b] shadow-sm hover:bg-[#5eeaff]',
        secondary: 'border border-[var(--border-strong)] bg-[var(--accent-soft)] text-[var(--foreground)] hover:bg-[rgba(0,213,255,0.22)]',
        ghost: 'border border-transparent text-[var(--muted)] hover:bg-white/5 hover:text-[var(--foreground)]',
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
