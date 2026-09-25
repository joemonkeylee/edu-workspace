import { useEffect, useState } from 'react'
import { getDashboard, getBookStats, getWrongSentences, loadStudyRecord, type Dashboard } from '../../english/studyRecord'
import { BOOKS } from '../../english/constants'

// 教材 id → 名称（含 series）
const BOOK_NAME_MAP = new Map(BOOKS.map(b => [b.id, b.name]))
const BOOK_SERIES_MAP = new Map(BOOKS.map(b => [b.id, b.series ?? b.name]))

function fmtRatio(r: number): string {
  if (!Number.isFinite(r) || r <= 0) return '—'
  return `${Math.round(r * 100)}%`
}

function fmtNum(n: number): string {
  return n.toLocaleString()
}

interface StatCardProps {
  label: string
  value: string | number
  hint?: string
  accent?: 'default' | 'green' | 'amber' | 'sky'
}

function StatCard({ label, value, hint, accent = 'default' }: StatCardProps) {
  type Accent = NonNullable<StatCardProps['accent']>
  const colorMap: Record<Accent, string> = {
    default: 'border-border',
    green: 'border-emerald-300 dark:border-emerald-800',
    amber: 'border-amber-300 dark:border-amber-800',
    sky: 'border-sky-300 dark:border-sky-800',
  }
  return (
    <div className={`rounded-lg border bg-card p-3 ${colorMap[accent]}`}>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1.5 text-2xl font-semibold tabular-nums text-foreground">{value}</div>
      {hint && <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  )
}

/** English 模块学习统计 —— 展示在 admin 概览页 */
export default function EnglishStudyPanel() {
  const [dash, setDash] = useState<Dashboard | null>(null)
  const [bookStats, setBookStats] = useState<Record<string, Dashboard>>({})
  const [wrongCount, setWrongCount] = useState(0)
  const [totalLessons, setTotalLessons] = useState(0)

  // localStorage 变化（比如开着两个 tab）时自动刷新
  useEffect(() => {
    const refresh = () => {
      setDash(getDashboard())
      setBookStats(getBookStats())
      setWrongCount(getWrongSentences().length)
      setTotalLessons(Object.keys(loadStudyRecord()).length)
    }
    refresh()
    const handler = () => refresh()
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
  }, [])

  if (!dash) return null

  const practiced = dash.practicedSentences
  const passRate = practiced > 0 ? dash.passedSentences / practiced : 0

  return (
    <section className="rounded-lg border border-border bg-card shadow-sm">
      <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div>
          <h2 className="text-sm font-semibold text-foreground">英语打字学习</h2>
          <p className="text-xs text-muted-foreground">
            数据保存在浏览器本地（localStorage），换设备不会同步。共 {totalLessons} 课有记录。
          </p>
        </div>
        <button
          type="button"
          onClick={() => window.location.href = '/english'}
          className="rounded-md border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-accent"
        >
          进入学习 →
        </button>
      </header>

      {/* 顶部 4 个指标 */}
      <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-4">
        <StatCard
          label="已完成课程"
          value={`${dash.completedLessons} / ${dash.startedLessons}`}
          hint="完成 = 所有句子都通过过一次"
          accent={dash.completedLessons > 0 ? 'green' : 'default'}
        />
        <StatCard
          label="练习句数"
          value={`${fmtNum(dash.practicedSentences)}`}
          hint={`通过 ${fmtNum(dash.passedSentences)} · 正确率 ${fmtRatio(passRate)}`}
        />
        <StatCard
          label="首次通过率"
          value={fmtRatio(dash.firstPassRate)}
          hint={`${dash.firstPassSentences} / ${practiced} 句第一次就对`}
          accent={dash.firstPassRate >= 0.7 ? 'green' : dash.firstPassRate >= 0.4 ? 'amber' : 'sky'}
        />
        <StatCard
          label="累计判卷"
          value={fmtNum(dash.totalAttempts)}
          hint={`判错 ${fmtNum(dash.totalErrors)} 次 · 错句 ${wrongCount} 句`}
          accent={wrongCount > 0 ? 'amber' : 'green'}
        />
      </div>

      {/* 按教材聚合 */}
      {Object.keys(bookStats).length > 0 && (
        <div className="border-t border-border">
          <div className="px-4 py-2 text-xs font-medium text-muted-foreground">按教材</div>
          <div className="max-h-64 overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-card">
                <tr className="text-muted-foreground">
                  <th className="px-4 py-1.5 text-left font-medium">教材</th>
                  <th className="px-2 py-1.5 text-right font-medium">已完成</th>
                  <th className="px-2 py-1.5 text-right font-medium">练习句</th>
                  <th className="px-2 py-1.5 text-right font-medium">首次通过</th>
                  <th className="px-2 py-1.5 text-right font-medium">最佳均正确率</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {Object.entries(bookStats)
                  .sort((a, b) => b[1].startedLessons - a[1].startedLessons)
                  .map(([bookId, s]) => {
                    const name = BOOK_NAME_MAP.get(bookId) ?? bookId.slice(0, 8)
                    const series = BOOK_SERIES_MAP.get(bookId)
                    const firstPct = s.practicedSentences > 0 ? Math.round((s.firstPassSentences / s.practicedSentences) * 100) : 0
                    const ratioPct = Math.round(s.avgBestRatio * 100)
                    return (
                      <tr key={bookId} className="text-foreground">
                        <td className="px-4 py-1.5">
                          <div className="font-medium">{name}</div>
                          {series && series !== name && (
                            <div className="text-[10px] text-muted-foreground">{series}</div>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {s.completedLessons}
                          <span className="text-muted-foreground">/{s.startedLessons}</span>
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{s.practicedSentences}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{firstPct}%</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{ratioPct}%</td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {Object.keys(bookStats).length === 0 && (
        <div className="border-t border-border px-4 py-6 text-center text-xs text-muted-foreground">
          还没有学习记录。打开 <a className="text-primary hover:underline" href="/english">/english</a> 开始打字练习吧。
        </div>
      )}
    </section>
  )
}
