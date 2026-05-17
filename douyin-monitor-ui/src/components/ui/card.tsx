import * as React from 'react'
import { cn } from '../../lib/utils'

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-[8px] border border-[var(--border)] bg-[var(--card)] shadow-sm backdrop-blur-xl', className)} {...props} />
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('card-header flex items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-4', className)} {...props} />
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn('flex items-center gap-2 text-base font-extrabold tracking-normal', className)} {...props} />
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('card-content p-5', className)} {...props} />
}
