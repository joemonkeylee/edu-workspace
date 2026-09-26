import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpDown, Clock, Library, Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { DICT_CATEGORIES, DICT_GROUPS, DICT_MAP, DICTIONARIES, searchDicts } from '../dictionaries';
import { ALL_DICT_TAB, useTypingSettings } from '../settingsStore';

type SortMode = 'name-asc' | 'name-desc' | 'length-asc' | 'length-desc';

type Props = {
  value: string;
  onChange: (id: string) => void;
};

/**
 * 常驻式词库面板：横向分类 Tabs + 扁平词库列表 + 排序 + 最近看过。
 *
 * dictTab / dictKeyword / dictPanelOpen / recentDictIds 全部进 settingsStore 持久化，
 * 关掉浏览器再回来还停留在同一个分类、同一个搜索位置。
 */
export default function DictPanel({ value, onChange }: Props) {
  const {
    dictTab,
    dictKeyword,
    setDictTab,
    setDictKeyword,
    setDictPanelOpen,
    recentDictIds,
    recordRecentDict,
  } = useTypingSettings();
  const listRef = useRef<HTMLDivElement>(null);
  const [sortMode, setSortMode] = useState<SortMode>('name-asc');

  const isSearching = dictKeyword.trim().length > 0;

  // 搜索时强制切回「全部」，跨分类搜索
  useEffect(() => {
    if (isSearching && dictTab !== ALL_DICT_TAB) setDictTab(ALL_DICT_TAB);
  }, [isSearching, dictTab, setDictTab]);

  // 选中的词库记进「最近看过」
  useEffect(() => {
    if (value && DICT_MAP[value]) recordRecentDict(value);
  }, [value, recordRecentDict]);

  // 按当前 tab 取扁平列表 + 排序
  const visibleItems = useMemo(() => {
    let raw;
    if (isSearching) {
      raw = searchDicts(dictKeyword).flatMap((g) => g.items);
    } else if (dictTab === ALL_DICT_TAB) {
      raw = DICT_GROUPS.flatMap((g) => g.items);
    } else {
      raw = DICT_GROUPS.find((x) => x.category === dictTab)?.items ?? [];
    }
    const sorted = raw.slice();
    switch (sortMode) {
      case 'name-asc':
        sorted.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
        break;
      case 'name-desc':
        sorted.sort((a, b) => b.name.localeCompare(a.name, 'zh-CN'));
        break;
      case 'length-asc':
        sorted.sort((a, b) => a.length - b.length);
        break;
      case 'length-desc':
        sorted.sort((a, b) => b.length - a.length);
        break;
    }
    return sorted;
  }, [dictTab, isSearching, dictKeyword, sortMode]);

  // 最近看过的元数据（过滤掉已经不存在的 id）
  const recentItems = useMemo(
    () => recentDictIds.map((id) => DICT_MAP[id]).filter(Boolean),
    [recentDictIds],
  );

  // 当前选中词库滚进视野（面板打开时）
  useEffect(() => {
    const parent = listRef.current;
    if (!parent) return;
    const el = parent.querySelector<HTMLElement>('[data-selected="true"]');
    if (!el) return;
    const p = parent.getBoundingClientRect();
    const e = el.getBoundingClientRect();
    parent.scrollTop += e.top - p.top - (p.height / 2 - e.height / 2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePick = (id: string) => {
    onChange(id);
    const d = DICT_MAP[id];
    if (d && d.category !== dictTab && dictTab !== ALL_DICT_TAB) {
      // 如果当前在某个分类 Tab，切跨分类词库时切到「全部」Tab 让用户能看到它
      setDictTab(ALL_DICT_TAB);
    }
  };

  return (
    <aside
      data-typing-panel
      className="flex max-h-[60vh] w-full shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-card lg:max-h-none lg:w-72"
    >
      <header className="flex items-center gap-1 border-b border-border px-3 py-2">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <Library size={15} className="text-muted-foreground" />
          词库列表
        </span>
        <div className="ml-auto flex items-center gap-1">
          <label className="flex items-center gap-1">
            <ArrowUpDown size={11} className="text-muted-foreground" />
            <select
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as SortMode)}
              className="h-6 rounded-md border border-input bg-background px-1.5 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="name-asc">名称 A→Z</option>
              <option value="name-desc">名称 Z→A</option>
              <option value="length-desc">词数 多→少</option>
              <option value="length-asc">词数 少→多</option>
            </select>
          </label>
          <button
            type="button"
            onClick={() => setDictPanelOpen(false)}
            title="收起词库列表"
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <X size={15} />
          </button>
        </div>
      </header>

      <div className="border-b border-border px-3 py-2">
        <div className="relative">
          <Search
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={dictKeyword}
            onChange={(e) => setDictKeyword(e.target.value)}
            placeholder="搜索词库…"
            className="h-8 pl-8 text-sm"
          />
        </div>
      </div>

      <Tabs value={dictTab} onValueChange={setDictTab} className="flex min-h-0 flex-1 flex-col">
        <div className="border-b border-border px-2 pt-2">
          <TabsList className="h-auto w-full flex-wrap justify-start gap-1 bg-transparent p-0">
            <TabsTrigger
              value={ALL_DICT_TAB}
              className="h-7 rounded-md bg-transparent px-2.5 text-xs data-[state=active]:bg-accent data-[state=active]:text-accent-foreground data-[state=active]:shadow-none"
            >
              全部
            </TabsTrigger>
            {DICT_CATEGORIES.map((c) => (
              <TabsTrigger
                key={c}
                value={c}
                disabled={isSearching}
                className="h-7 rounded-md bg-transparent px-2.5 text-xs data-[state=active]:bg-accent data-[state=active]:text-accent-foreground data-[state=active]:shadow-none disabled:opacity-40"
              >
                {c}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value={dictTab} className="m-0 flex min-h-0 flex-1 flex-col">
          <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-2 py-1">
            {visibleItems.length === 0 ? (
              <p className="px-2 py-8 text-center text-sm text-muted-foreground">
                没有匹配「{dictKeyword}」的词库
              </p>
            ) : (
              <ul className="space-y-0.5">
                {visibleItems.map((d) => {
                  const selected = d.id === value;
                  return (
                    <li key={d.id}>
                      <button
                        type="button"
                        data-selected={selected}
                        aria-current={selected}
                        onClick={() => handlePick(d.id)}
                        title={d.description || d.name}
                        className={cn(
                          'flex w-full items-start justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors',
                          selected
                            ? 'bg-primary/10 text-primary hover:bg-primary/15'
                            : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                        )}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate leading-tight">
                            {d.name}
                          </span>
                          {d.description && (
                            <span
                              className={cn(
                                'mt-0.5 block truncate text-xs leading-relaxed',
                                selected ? 'text-primary/70' : 'text-muted-foreground/80',
                              )}
                            >
                              {d.description}
                            </span>
                          )}
                        </span>
                        <span
                          className={cn(
                            'shrink-0 text-xs tabular-nums',
                            selected ? 'text-primary/80' : 'text-muted-foreground',
                          )}
                        >
                          {d.length.toLocaleString()}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </TabsContent>
      </Tabs>

      <footer className="flex items-center justify-between gap-2 border-t border-border px-3 py-2 text-xs text-muted-foreground">
        <span className="truncate">
          {isSearching ? (
            <>共 {DICTIONARIES.length} 个 · 匹配 {visibleItems.length}</>
          ) : dictTab === ALL_DICT_TAB ? (
            <>共 {DICTIONARIES.length} 个词库</>
          ) : (
            <>{dictTab} · {visibleItems.length} 个</>
          )}
        </span>

        {recentItems.length > 0 ? (
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] transition hover:bg-muted hover:text-foreground"
              >
                <Clock size={11} />
                最近 {recentItems.length}
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 p-2">
              <p className="mb-1 px-2 text-[11px] text-muted-foreground">最近看过</p>
              <ul className="space-y-0.5">
                {recentItems.map((d) => {
                  const selected = d.id === value;
                  return (
                    <li key={d.id}>
                      <button
                        type="button"
                        onClick={() => handlePick(d.id)}
                        className={cn(
                          'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-xs transition-colors',
                          selected
                            ? 'bg-primary/10 text-primary'
                            : 'text-foreground hover:bg-muted',
                        )}
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {d.name}
                          <span className="ml-1 text-[10px] text-muted-foreground">
                            · {d.category}
                          </span>
                        </span>
                        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                          {d.length.toLocaleString()}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </PopoverContent>
          </Popover>
        ) : null}
      </footer>
    </aside>
  );
}
