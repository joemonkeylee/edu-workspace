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

const MEANINGS: Record<string, string> = {
  FCP: '从导航开始到页面首次渲染出任何文本、图像或非空白元素的时间',
  LCP: '从导航开始到页面最大内容元素(图片/文本块)完成渲染的时间',
  INP: '页面生命周期内最长的一次用户交互(点击/按键)响应时间',
  CLS: '页面加载后所有布局偏移的累积分数,值越小越稳定',
  TTFB: '从发起请求到收到服务器首个字节响应的时间(含 DNS/TCP/TLS)',
  TTI: '从导航开始到页面完全可交互(主线程持续 5s 空闲)的时间',
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
            暂无性能数据,请稍后再试
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
                  <th className="px-3 py-2 text-left font-normal text-muted-foreground">体验影响</th>
                  <th className="px-3 py-2 text-left font-normal text-muted-foreground">改进</th>
                  <th className="w-10 px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {vitals.map(
                  ({
                    name,
                    idealRange,
                    userImpact,
                    improvementNeeded,
                    referenceLink,
                    rawMetric,
                  }) => {
                    const expanded = expandedName === name
                    const tooltip = MEANINGS[name] ?? '未知指标'
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
                              <span className="group relative inline-flex cursor-help">
                                <HelpCircle size={13} className="text-muted-foreground" />
                                <span className="pointer-events-none absolute left-1/2 top-full z-50 mt-1 -translate-x-1/2 whitespace-nowrap rounded-md bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md ring-1 ring-border opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                                  {tooltip}
                                </span>
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-2 font-mono text-xs text-foreground">
                            {rawMetric.value.toFixed(rawMetric.value < 1000 ? 1 : 0)}
                            <span className="ml-0.5 text-muted-foreground">ms</span>
                          </td>
                          <td className="px-3 py-2">{ratingBadge(rawMetric.rating)}</td>
                          <td className="px-3 py-2 text-muted-foreground">{idealRange}</td>
                          <td className="px-3 py-2 text-muted-foreground">{userImpact}</td>
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
                            <td colSpan={6} className="px-3 py-2">
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
