import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { getDict, searchDicts } from '../dictionaries';
import type { DictMeta } from '../types';

type Props = {
  value: string;
  onChange: (id: string) => void;
  className?: string;
};

/**
 * 词库选择器：300+ 个词库按分类分组展示，支持关键字搜索与键盘导航。
 *
 * 浮层带 `data-typing-panel`，复用 TypingHome 里「面板内按键不参与打字」的
 * 约定 —— 否则搜索时敲的字母会同时被当成打字输入。
 */
export default function DictPicker({ value, onChange, className }: Props) {
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const current: DictMeta = getDict(value);
  const groups = useMemo(() => searchDicts(keyword), [keyword]);
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  // 过滤条件变化后重置高亮，避免停在已不存在的项上
  useEffect(() => {
    setActiveIndex(0);
  }, [keyword]);

  // 打开时聚焦搜索框并选中已输入内容
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => inputRef.current?.select(), 0);
    return () => window.clearTimeout(id);
  }, [open]);

  // 关闭时清空搜索，下次打开是完整的分组列表
  useEffect(() => {
    if (open) return;
    setKeyword('');
  }, [open]);

  // 点击浮层外关闭
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  // 键盘移动时把高亮项滚进视野
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  const commit = (dict: DictMeta) => {
    onChange(dict.id);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, flat.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const hit = flat[activeIndex];
      if (hit) commit(hit);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  };

  let cursor = -1;

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <Button
        type="button"
        variant="outline"
        className="h-9 w-[15rem] justify-between px-3 font-normal"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate">{current.name}</span>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {current.length.toLocaleString()} 词
          </span>
        </span>
        <ChevronDown size={15} className="shrink-0 opacity-60" />
      </Button>

      {open && (
        <div
          data-typing-panel
          className="absolute left-0 top-full z-50 mt-1 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-lg"
        >
          <div className="relative border-b border-border">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={inputRef}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="搜索词库名称或简介…"
              className="h-9 border-0 pl-8 shadow-none focus-visible:ring-0"
              autoFocus
            />
          </div>

          <div ref={listRef} className="max-h-72 overflow-y-auto py-1" role="listbox">
            {flat.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                没有匹配「{keyword}」的词库
              </p>
            ) : (
              groups.map((g) => (
                <div key={g.category}>
                  <div className="sticky top-0 z-10 flex items-center justify-between bg-popover px-3 py-1.5 text-xs font-medium text-muted-foreground">
                    <span>{g.category}</span>
                    <span className="tabular-nums">{g.items.length}</span>
                  </div>
                  {g.items.map((d) => {
                    cursor += 1;
                    const index = cursor;
                    const selected = d.id === value;
                    return (
                      <button
                        key={d.id}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        data-index={index}
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => commit(d)}
                        className={cn(
                          'flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm transition-colors',
                          index === activeIndex && 'bg-accent text-accent-foreground',
                        )}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{d.name}</span>
                          {d.description && (
                            <span className="block truncate text-xs text-muted-foreground">
                              {d.description}
                            </span>
                          )}
                        </span>
                        <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
                          {d.length.toLocaleString()}
                          {selected && <Check size={13} className="text-primary" />}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
