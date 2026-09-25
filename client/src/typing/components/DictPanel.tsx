import { useEffect, useMemo, useRef, useState } from 'react';
import { Library, Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { DICTIONARIES, searchDicts } from '../dictionaries';
import { useTypingSettings } from '../settingsStore';

type Props = {
  value: string;
  onChange: (id: string) => void;
};

/**
 * 常驻式词库列表。
 *
 * 与练习设置面板同一套形态：不是弹窗也不是下拉，直接摆在界面左侧，
 * 可以边练边换词库、边搜边看分组。300+ 个词库靠下拉浮层找太费劲，
 * 常驻面板配搜索框才好用。
 *
 * 面板整体带 `data-typing-panel`，TypingHome 的全局键盘监听会跳过其中的按键，
 * 否则在搜索框里敲字会同时被当成打字输入。
 */
export default function DictPanel({ value, onChange }: Props) {
  const [keyword, setKeyword] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const setDictPanelOpen = useTypingSettings((s) => s.setDictPanelOpen);

  const groups = useMemo(() => searchDicts(keyword), [keyword]);
  const matched = useMemo(
    () => (keyword.trim() ? groups.reduce((n, g) => n + g.items.length, 0) : DICTIONARIES.length),
    [groups, keyword],
  );

  // 打开时把当前词库滚进视野：300 多项里手动找很费劲
  useEffect(() => {
    const parent = listRef.current;
    if (!parent) return;
    const el = parent.querySelector<HTMLElement>('[data-selected="true"]');
    if (!el) return;
    // 用 rect 计算而非 scrollIntoView，避免连带滚动整个页面
    const p = parent.getBoundingClientRect();
    const e = el.getBoundingClientRect();
    parent.scrollTop += e.top - p.top - (p.height / 2 - e.height / 2);
  }, []);

  return (
    <aside
      data-typing-panel
      className="flex max-h-[60vh] w-full shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-card lg:max-h-none lg:w-72"
    >
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <Library size={15} className="text-muted-foreground" />
          词库列表
        </span>
        <button
          type="button"
          onClick={() => setDictPanelOpen(false)}
          title="收起词库列表"
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
          <X size={15} />
        </button>
      </header>

      <div className="border-b border-border px-3 py-2">
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索词库…"
            className="h-8 pl-8 text-sm"
          />
        </div>
      </div>

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-1">
        {matched === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            没有匹配「{keyword}」的词库
          </p>
        ) : (
          groups.map((g) => (
            <section key={g.category} className="px-2 py-1 first:pt-2">
              <h3 className="sticky top-0 z-10 flex items-center justify-between bg-card px-2 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                <span>{g.category}</span>
                <span className="tabular-nums">{g.items.length}</span>
              </h3>
              <ul className="space-y-0.5">
                {g.items.map((d) => {
                  const selected = d.id === value;
                  return (
                    <li key={d.id}>
                      <button
                        type="button"
                        data-selected={selected}
                        aria-current={selected}
                        onClick={() => onChange(d.id)}
                        title={d.description || d.name}
                        className={cn(
                          'flex w-full items-start justify-between gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors',
                          selected
                            ? 'bg-accent text-accent-foreground'
                            : 'text-foreground hover:bg-accent/40',
                        )}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium leading-tight">
                            {d.name}
                          </span>
                          {d.description && (
                            <span
                              className={cn(
                                'mt-0.5 block truncate text-xs leading-relaxed',
                                selected
                                  ? 'text-accent-foreground/70'
                                  : 'text-muted-foreground',
                              )}
                            >
                              {d.description}
                            </span>
                          )}
                        </span>
                        <span
                          className={cn(
                            'shrink-0 text-xs tabular-nums',
                            selected
                              ? 'text-accent-foreground/80'
                              : 'text-muted-foreground',
                          )}
                        >
                          {d.length.toLocaleString()}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </div>

      <footer className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
        共 {DICTIONARIES.length} 个词库
        {keyword.trim() && ` · 匹配 ${matched} 个`}
      </footer>
    </aside>
  );
}
