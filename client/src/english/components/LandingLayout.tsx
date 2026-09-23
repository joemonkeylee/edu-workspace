import { Link, useLocation } from 'react-router-dom'
import AppHeaderRight from '@/components/AppHeaderRight'
import { BookOpen, ArrowLeft } from 'lucide-react'

const APP_ENV = import.meta.env.VITE_APP_ENV || (import.meta.env.DEV ? 'DEV' : 'TEST')
const APP_COMMIT = import.meta.env.VITE_APP_COMMIT || ''
const APP_ENV_CLASS = APP_ENV === 'PROD'
  ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
  : APP_ENV === 'TEST'
  ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300'
  : 'bg-primary/15 text-primary dark:text-blue-300'

export default function LandingLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation()

  // 具体学习页：直接渲染 children（已有自己的 header）
  const isLearningPath = /^\/english\/\d+\/\d+/.test(location.pathname)

  if (isLearningPath) {
    return (
      <div className="relative h-full overflow-hidden bg-background">
        {children}
      </div>
    )
  }

  // /english 卡片网格页：统一 header
  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex h-14 flex-shrink-0 items-center justify-between bg-sidebar px-6 text-sidebar-foreground">
        <div className="flex items-center gap-3">
          <Link to="/" className="flex items-center gap-2">
            <BookOpen size={22} />
            <span className="text-lg font-normal">English</span>
          </Link>
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-normal tracking-wide ${APP_ENV_CLASS}`}>
            {APP_ENV}
          </span>
          {APP_ENV === 'TEST' && APP_COMMIT && (
            <span className="font-mono text-[10px] text-muted-foreground" title={`构建版本 ${APP_COMMIT}`}>
              {APP_COMMIT}
            </span>
          )}
          <span className="mx-1 h-5 w-px bg-sidebar-border" />
          <Link
            to="/books"
            className="flex items-center gap-1 text-sm text-sidebar-foreground/80 hover:text-sidebar-foreground transition"
          >
            <ArrowLeft size={14} />
            Book
          </Link>
        </div>
        <AppHeaderRight />
      </header>
      <main className="flex-1 overflow-auto px-6 py-4">{children}</main>
    </div>
  )
}
