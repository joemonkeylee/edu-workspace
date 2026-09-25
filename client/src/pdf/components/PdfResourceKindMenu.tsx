import { useCallback, useEffect, useRef, useState } from 'react';
import { FileText, ScanLine, ChevronDown, Library } from 'lucide-react';
import type { PdfResourceKind } from '../store/pdfHomeFilters';

/**
 * PDF 书库头部的一/二级菜单：
 * 一级 = PDF 书库（常驻 header），二级 = 可搜索 / 扫描件 / 全部。
 * 语义沿用图片模式的 ResourceKindMenu，但选项是 PDF 域自己的维度。
 */
interface Props {
  value: PdfResourceKind;
  onChange: (v: PdfResourceKind) => void;
  counts: { all: number; searchable: number; scan: number };
}

const OPEN_DELAY = 90;
const CLOSE_DELAY = 180;

const ITEMS: { key: PdfResourceKind; label: string; icon: typeof FileText }[] = [
  { key: 'searchable', label: '可搜索', icon: FileText },
  { key: 'scan', label: '扫描件', icon: ScanLine },
  { key: 'all', label: '全部 PDF', icon: Library },
];

export default function PdfResourceKindMenu({ value, onChange, counts }: Props) {
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

  const countOf = (k: PdfResourceKind) =>
    k === 'searchable' ? counts.searchable : k === 'scan' ? counts.scan : counts.all;

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
        title="切换 PDF 书类型"
        className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm transition ${
          open ? 'bg-sidebar-accent' : 'hover:bg-sidebar-accent'
        }`}
      >
        <span>PDF 书库</span>
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
