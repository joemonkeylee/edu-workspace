import { useState, Fragment } from 'react'
import { BarChart, ChevronDown, ChevronRight, ExternalLink } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import type { VitalInfo, Metric } from '../metrics'

interface WebVitalsInfoPanelProps {
  vitals: (VitalInfo & { rawMetric: Metric })[]
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
          className="flex h-8 w-8 items-center justify-center rounded-md text-foreground/80 hover:bg-accent hover:text-foreground transition"
          aria-label="打开 Web Vitals"
          title="Web Vitals"
        >
          <BarChart size={16} />
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Web Vitals 性能指标</DialogTitle>
        </DialogHeader>
        {vitals.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            暂无性能数据，请稍后再试
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-2 py-2 text-left font-semibold text-foreground">指标</th>
                  <th className="px-2 py-2 text-left font-semibold text-foreground">含义</th>
                  <th className="px-2 py-2 text-left font-semibold text-foreground">理想值</th>
                  <th className="px-2 py-2 text-left font-semibold text-foreground">体验影响</th>
                  <th className="px-2 py-2 text-left font-semibold text-foreground">改进</th>
                  <th className="px-2 py-2 text-left font-semibold text-foreground">参考</th>
                  <th className="px-2 py-2 text-left font-semibold text-foreground">详情</th>
                </tr>
              </thead>
              <tbody>
                {vitals.map(
                  ({
                    name,
                    meaning,
                    idealRange,
                    userImpact,
                    improvementNeeded,
                    referenceLink,
                    rawMetric,
                  }) => (
                    <Fragment key={name}>
                      <tr className="border-b border-border/50 hover:bg-muted/50">
                        <td className="px-2 py-2 font-bold text-foreground">{name}</td>
                        <td className="px-2 py-2 text-muted-foreground">{meaning}</td>
                        <td className="px-2 py-2 text-muted-foreground">{idealRange}</td>
                        <td className="px-2 py-2 text-muted-foreground">{userImpact}</td>
                        <td className="px-2 py-2 text-muted-foreground">{improvementNeeded}</td>
                        <td className="px-2 py-2">
                          <a
                            href={referenceLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-primary hover:underline"
                          >
                            查看 <ExternalLink size={12} />
                          </a>
                        </td>
                        <td className="px-2 py-2">
                          <button
                            type="button"
                            onClick={() => toggleExpand(name)}
                            className="inline-flex items-center text-primary hover:underline"
                          >
                            {expandedName === name ? (
                              <ChevronDown size={14} />
                            ) : (
                              <ChevronRight size={14} />
                            )}
                            {expandedName === name ? '收起' : '展开'}
                          </button>
                        </td>
                      </tr>
                      {expandedName === name && rawMetric && (
                        <tr>
                          <td colSpan={7} className="bg-muted/50 px-2 py-2">
                            <pre className="max-h-60 overflow-auto rounded bg-muted p-3 text-xs text-foreground">
                              {JSON.stringify(rawMetric, null, 2)}
                            </pre>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ),
                )}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
