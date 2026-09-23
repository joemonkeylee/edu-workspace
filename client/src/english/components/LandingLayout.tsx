import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import WebVitalsInfoPanel from './WebVitalsInfoPanel'
import { ThemeSwitcher } from '@/components/ThemeSwitcher'
import {
  reportWebVitals,
  convertMetricToVitalInfo,
  type Metric,
  type VitalInfo,
} from '../metrics'
import { BookOpen, ArrowLeft, Settings } from 'lucide-react'

const APP_ENV = import.meta.env.VITE_APP_ENV || (import.meta.env.DEV ? 'DEV' : 'TEST')
const APP_COMMIT = import.meta.env.VITE_APP_COMMIT || ''
const APP_ENV_CLASS = APP_ENV === 'PROD'
  ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
  : APP_ENV === 'TEST'
  ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300'
  : 'bg-primary/15 text-primary dark:text-blue-300'

export default function LandingLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation()
  const navigate = useNavigate()
  const [vitals, setVitals] = useState<(VitalInfo & { rawMetric: Metric })[]>([])

  useEffect(() => {
    reportWebVitals((metric: Metric) => {
      setVitals((prev) => {
        const newVital = convertMetricToVitalInfo(metric)
        const filtered = prev.filter((v) => v.name !== metric.name)
        return [...filtered, newVital]
      })
    })
  }, [])

  // 具体学习页：只有返回按钮 + 右下角浮动控件
  const isLearningPath = /^\/english\/\d+\/\d+/.test(location.pathname)

  if (isLearningPath) {
    return (
      <div className="relative h-full overflow-hidden bg-background">
        {children}
      </div>
    )
  }

  // 书籍列表页 /english：用首页同款 sidebar header 风格
  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex h-14 flex-shrink-0 items-center justify-between bg-sidebar px-6 py-4 text-sidebar-foreground">
        <div className="flex items-center gap-3">
          <Link to="/" className="flex items-center gap-2">
            <BookOpen size={22} />
            <span className="text-lg font-bold">English</span>
          </Link>
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide ${APP_ENV_CLASS}`}>
            {APP_ENV}
          </span>
          {APP_ENV === 'TEST' && APP_COMMIT && (
            <span className="font-mono text-[10px] text-muted-foreground" title={`构建版本 ${APP_COMMIT}`}>
              {APP_COMMIT}
            </span>
          )}
          <span className="mx-1 h-5 w-px bg-sidebar-border" />
          <Link
            to="/"
            className="flex items-center gap-1 text-sm text-muted-foreground transition hover:text-foreground"
          >
            <ArrowLeft size={14} />
            返回首页
          </Link>
        </div>
        <div className="flex items-center gap-2">
          <ThemeSwitcher />
          <WebVitalsInfoPanel vitals={vitals} />
          <Link
            to="/admin"
            target="_blank"
            rel="noopener noreferrer"
            title="后台管理"
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary opacity-90 transition hover:opacity-100"
          >
            <Settings size={18} />
          </Link>
        </div>
      </header>
      <main className="flex-1 overflow-auto px-6 py-4">{children}</main>
    </div>
  )
}
