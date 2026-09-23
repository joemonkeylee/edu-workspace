import { useState, Fragment } from 'react'
import { BarChart, ChevronDown, ChevronRight, HelpCircle } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { VitalInfo, Metric } from '../metrics'

interface WebVitalsInfoPanelProps {
  vitals: (VitalInfo & { rawMetric: Metric })[]
}

function ratingBadge(rating?: string) {
  if (!rating) return null
  const map: Record<string, { variant: 'default' | 'secondary' | 'destructive'; label: string; cls?: string }> = {
    good: { variant: 'secondary', label: '良好', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/25' },
    'needs-improvement': { variant: 'default', label: '需改进', cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/25' },
    poor: { variant: 'destructive', label: '较差' },
  }
  const cfg = map[rating]
  if (!cfg) return null
  return (
    <Badge variant={cfg.variant} className={cn('font-normal', cfg.cls)}>
      {cfg.label}
    </Badge>
  )
}

export default function WebVitalsInfoPanel({ vitals }: WebVitalsInfoPanelProps) {
  const [expandedName, setExpandedName] = useState<string | null>(null)

  const toggleExpand = (name: string) => {
    setExpandedName((prev) => (prev === name ? null : name))
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className="flex h-8 w-8 items-center justify-center rounded-md text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground transition"
          aria-label="打开 Web Vitals"
          title="Web Vitals"
        >
          <BarChart size={16} />
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-normal">Web Vitals</DialogTitle>
        </DialogHeader>
        {vitals.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            暂无性能数据，请稍后再试
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr className="border-b border-border">
                  <th className="px-3 py-2 text-left font-normal text-muted-foreground">指标</th>
                  <th className="px-3 py-2 text-left font-normal text-muted-foreground">值</th>
                  <th className="px-3 py-2 text-left font-normal text-muted-foreground">状态</th>
                  <th className="px-3 py-2 text-left font-normal text-muted-foreground">理想范围</th>
                  <th className="px-3 py-2 text-left font-normal text-muted-foreground">改进</th>
                  <th className="w-10 px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {vitals.map(
                  ({
                    name,
                    meaning,
                    idealRange,
                    improvementNeeded,
                    referenceLink,
                    rawMetric,
                  }) => {
                    const expanded = expandedName === name
                    return (
                      <Fragment key={name}>
                        <tr className="border-b border-border/50 last:border-b-0 hover:bg-muted/30 transition-colors">
                          <td className="px-3 py-2 font-medium">
                            <div className="flex items-center gap-1">
                              {referenceLink ? (
                                <a href={referenceLink} target="_blank" rel="noopener noreferrer"
                                  className="text-primary hover:underline">
                                  {name}
                                </a>
                              ) : (
                                <span className="text-foreground">{name}</span>
                              )}
                              <span title={meaning} className="inline-flex cursor-help">
                                <HelpCircle size={13} className="text-muted-foreground" />
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-2 font-mono text-xs text-foreground">
                            {rawMetric.value.toFixed(rawMetric.value < 1000 ? 1 : 0)}
                            <span className="ml-0.5 text-muted-foreground">ms</span>
                          </td>
                          <td className="px-3 py-2">{ratingBadge(rawMetric.rating)}</td>
                          <td className="px-3 py-2 text-muted-foreground">{idealRange}</td>
                          <td className="px-3 py-2 text-muted-foreground">{improvementNeeded}</td>
                          <td className="px-3 py-2">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={() => toggleExpand(name)}
                              title={expanded ? '收起' : '展开'}
                            >
                              {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            </Button>
                          </td>
                        </tr>
                        {expanded && (
                          <tr className="bg-muted/40">
                            <td colSpan={5} className="px-3 py-2">
                              <pre className="max-h-60 overflow-auto rounded-md border border-border bg-background p-3 text-xs leading-relaxed text-foreground">
                                {JSON.stringify(rawMetric, null, 2)}
                              </pre>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  },
                )}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
