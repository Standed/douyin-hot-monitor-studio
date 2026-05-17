import * as React from 'react'
import { cn } from '../../lib/utils'

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>

export function Input({ className, ...props }: InputProps) {
  return (
    <input
      className={cn(
        'h-11 w-full rounded-[8px] border border-[var(--border)] bg-[rgba(2,8,23,0.34)] px-3 text-sm text-[var(--foreground)] outline-none transition placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--ring)]',
        className,
      )}
      {...props}
    />
  )
}
