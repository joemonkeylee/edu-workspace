import { Link, useLocation } from 'react-router-dom'
import AppHeaderRight from '@/components/AppHeaderRight'
import { BookOpen, ArrowLeft } from 'lucide-react'

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
          <span className="mx-1 h-5 w-px bg-sidebar-border" />
          <Link to="/" title="返回首页" className="flex items-center justify-center h-8 w-8 rounded-md text-sidebar-foreground/80 hover:text-sidebar-foreground hover:bg-sidebar-accent transition">
            <ArrowLeft size={16} />
          </Link>
        </div>
        <AppHeaderRight />
      </header>
      <main className="flex-1 overflow-auto px-6 py-4">{children}</main>
    </div>
  )
}
