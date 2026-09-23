import { Link, useLocation } from 'react-router-dom'
import AppHeaderRight from '@/components/AppHeaderRight'
import { GraduationCap } from 'lucide-react'

export default function LandingLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation()

  const isLearningPath = /^\/english\/\d+\/\d+/.test(location.pathname)

  if (isLearningPath) {
    return (
      <div className="relative h-full overflow-hidden bg-background">
        {children}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex h-14 flex-shrink-0 items-center justify-between bg-sidebar px-6 text-sidebar-foreground">
        <div className="flex items-center gap-3">
          <Link to="/" className="flex items-center gap-2">
            <GraduationCap size={22} />
            <span className="text-lg font-normal">edu-workspace</span>
          </Link>
        </div>
        <AppHeaderRight />
      </header>
      <main className="flex-1 overflow-auto px-6 py-4">{children}</main>
    </div>
  )
}
