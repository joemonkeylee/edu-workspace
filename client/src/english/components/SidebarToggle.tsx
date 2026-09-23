import { ChevronLeft, ChevronRight, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SidebarToggleProps {
  sidebarVisible: boolean
  toggleSidebar: () => void
}

export default function SidebarToggle({ sidebarVisible, toggleSidebar }: SidebarToggleProps) {
  return (
    <button
      className={cn(
        'absolute left-0 top-3 z-[1100] flex h-8 w-8 -translate-x-1/2 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm transition-all hover:bg-muted hover:text-foreground',
        !sidebarVisible && 'translate-x-0 left-2',
      )}
      onClick={toggleSidebar}
      aria-label={sidebarVisible ? '收起课程列表' : '展开课程列表'}
      title={sidebarVisible ? '收起课程列表' : '展开课程列表'}
    >
      {sidebarVisible ? <PanelLeftClose size={14} /> : <PanelLeftOpen size={14} />}
    </button>
  )
}
