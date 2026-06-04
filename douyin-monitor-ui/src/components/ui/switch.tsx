import { cn } from '../../lib/utils'

export function Switch({
  label,
  checked,
  onCheckedChange,
}: {
  label: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <button
      type="button"
      className={cn(
        'flex items-center justify-between gap-3 rounded-[8px] border border-[var(--border)] bg-[var(--control-bg)] p-3 text-left text-sm font-bold text-[var(--foreground)] transition hover:bg-[var(--control-hover)]',
        checked && 'border-[var(--accent)] bg-[var(--accent-soft)]',
      )}
      onClick={() => onCheckedChange(!checked)}
    >
      <span>{label}</span>
      <span className={cn('relative h-5 w-9 rounded-full bg-[var(--switch-track)] transition', checked && 'bg-[var(--accent)]')}>
        <span className={cn('absolute left-0.5 top-0.5 size-4 rounded-full bg-white shadow transition', checked && 'translate-x-4')} />
      </span>
    </button>
  )
}
