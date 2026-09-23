import { type MouseEvent } from 'react'
import { Check, Copy } from 'lucide-react'
import { cn } from '@/lib/utils'

interface CopyTextButtonProps {
  onClick: (e: MouseEvent<HTMLButtonElement>) => void
  title: string
  active: boolean
  label?: string
}

export default function CopyTextButton({ onClick, title, active, label }: CopyTextButtonProps) {
  return (
    <button
      type="button"
      className={cn(
        'flex h-7 min-w-7 items-center justify-center rounded-md border px-1.5 text-[10px] font-normal transition-colors',
        active
          ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
          : 'border-border bg-background text-muted-foreground hover:border-primary/60 hover:bg-primary/5 hover:text-primary',
      )}
      onClick={onClick}
      title={title}
      aria-pressed={active}
    >
      {active ? <Check size={12} /> : label || <Copy size={11} />}
    </button>
  )
}
