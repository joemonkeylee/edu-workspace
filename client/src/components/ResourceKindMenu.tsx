import { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, ChevronDown, ListChecks, Video } from 'lucide-react';
import type { ResourceKind } from '../store/homeFilters';

/**
 * Header 里的「教辅」一/二级菜单：
 * 一级 = 教辅（常驻 header），二级 = 视频课程 / 必刷题 / 全部书籍（悬浮或点击展开）。
 * 把原来的 Tab 行收进这里，可以让书架多出一行的垂直空间。
 */
interface Props {
  value: ResourceKind;
  onChange: (v: ResourceKind) => void;
  counts: { book: number; course: number; exercise: number };
}

const OPEN_DELAY = 90;   // 悬浮多久展开，避免鼠标划过时闪动
const CLOSE_DELAY = 180; // 移出后多久收起，允许指针斜着移到菜单项

const ITEMS: { key: ResourceKind; label: string; icon: typeof Video }[] = [
  { key: 'course', label: '视频课程', icon: Video },
  { key: 'exercise', label: '必刷题', icon: ListChecks },
  { key: 'all', label: '全部书籍', icon: BookOpen },
];

export default function ResourceKindMenu({ value, onChange, counts }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = useCallback(() => {
    if (openTimer.current) { clearTimeout(openTimer.current); openTimer.current = null; }
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  const scheduleOpen = () => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
    if (openTimer.current || open) return;
    openTimer.current = setTimeout(() => { openTimer.current = null; setOpen(true); }, OPEN_DELAY);
  };

  const scheduleClose = () => {
    if (openTimer.current) { clearTimeout(openTimer.current); openTimer.current = null; }
    if (closeTimer.current) return;
    closeTimer.current = setTimeout(() => { closeTimer.current = null; setOpen(false); }, CLOSE_DELAY);
  };

  // 点击外部 / Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const countOf = (k: ResourceKind) =>
    k === 'course' ? counts.course : k === 'exercise' ? counts.exercise : counts.book + counts.course + counts.exercise;

  const current = ITEMS.find((i) => i.key === value) ?? ITEMS[2];

  return (
    <div
      ref={rootRef}
      className="relative"
      onMouseEnter={scheduleOpen}
      onMouseLeave={scheduleClose}
    >
      <button
        type="button"
        onClick={() => { clearTimers(); setOpen((v) => !v); }}
        aria-haspopup="menu"
        aria-expanded={open}
        title="切换教辅类型"
        className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm transition ${
          open ? 'bg-sidebar-accent' : 'hover:bg-sidebar-accent'
        }`}
      >
        <span>教辅</span>
        <span className="opacity-50">/</span>
        <span className="font-semibold">{current.label}</span>
        <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-50 mt-1 w-52 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg"
        >
          {ITEMS.map((item) => {
            const Icon = item.icon;
            const active = item.key === value;
            return (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                onClick={() => { clearTimers(); setOpen(false); onChange(item.key); }}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition hover:bg-muted ${
                  active ? 'text-primary' : ''
                }`}
              >
                <Icon size={14} className={`flex-shrink-0 ${active ? 'text-primary' : 'text-muted-foreground'}`} />
                <span className={`flex-1 ${active ? 'font-semibold' : ''}`}>{item.label}</span>
                {/* 固定宽度右对齐 + tabular-nums；颜色跟随选中态，不用徽标背景、不加对勾 */}
                <span className={`w-10 flex-shrink-0 text-right text-[10px] tabular-nums ${
                  active ? 'font-medium text-primary' : 'text-muted-foreground'
                }`}>
                  {countOf(item.key)}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
