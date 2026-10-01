import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  listTeachingMaterials,
  teachingMaterialFacets,
  type TeachingMaterial,
  type TeachingMaterialFacets,
  type TeachingMaterialQuery,
} from '../../../pdf/api/pdfClient';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Search, RotateCcw, ExternalLink, ChevronLeft, ChevronRight, RefreshCw,
  ArrowUp, ArrowDown, Database,
} from 'lucide-react';

/**
 * 教辅资料（teaching_materials）管理端展示页。
 *
 * 数据来源是外部资料盘教辅清单，字段含义：
 *   名称 / 科目（多值，用「、」连接）/ 地区·版本 / 难度 / 热度 / 来源 / 网盘链接
 *
 * 筛选设计贴合这份数据的实际分布：
 *   · 科目用 LIKE 匹配，才能命中「英语、物理」这类组合值；
 *   · 地区、来源、难度、热度都是低基数枚举，用下拉即可；
 *   · 难度 / 热度是 1~10 的数值，用条形可视化，比纯数字更好比较。
 */

const EMPTY_FILTERS = {
  q: '',
  subject: '',
  region: '',
  source: '',
  difficulty: '',
  popularity: '',
  hasUrl: '',
};

type FilterState = typeof EMPTY_FILTERS;

/** 可排序列（key 必须与后端 SORTABLE 白名单一致） */
const COLUMNS: { key: string; label: string; sortable: boolean; className?: string }[] = [
  { key: 'name', label: '名称', sortable: true, className: 'min-w-[260px]' },
  { key: 'subject', label: '科目', sortable: true },
  { key: 'region', label: '地区 / 版本', sortable: true },
  { key: 'difficulty', label: '难度', sortable: true },
  { key: 'popularity', label: '热度', sortable: true },
  { key: 'source', label: '来源', sortable: true },
  { key: '__url__', label: '链接', sortable: false },
  { key: 'created_at', label: '入库时间', sortable: true },
];

function fmtDate(v: string | null): string {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 1~10 分值：数字 + 条形 */
function ScoreCell({ value }: { value: number | null }) {
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground">—</span>;
  }
  const pct = Math.max(0, Math.min(100, (value / 10) * 100));
  return (
    <div className="flex items-center gap-2" title={`${value} / 10`}>
      <span className="w-5 text-right tabular-nums text-foreground/80">{value}</span>
      <span className="h-1.5 w-14 overflow-hidden rounded bg-muted">
        <span className="block h-full rounded bg-primary/70" style={{ width: `${pct}%` }} />
      </span>
    </div>
  );
}

export default function PdfMaterialsTable() {
  const [facets, setFacets] = useState<TeachingMaterialFacets | null>(null);
  const [rows, setRows] = useState<TeachingMaterial[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [qInput, setQInput] = useState(''); // 输入用，防抖后写回 filters.q
  const [sortKey, setSortKey] = useState('id');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [refreshTick, setRefreshTick] = useState(0);

  const debounceRef = useRef<number | null>(null);

  // 加载筛选项（全表统计，只取一次；刷新时也重取）
  useEffect(() => {
    teachingMaterialFacets()
      .then(setFacets)
      .catch((e) => {
        console.error(e);
        toast.error('筛选项加载失败');
      });
  }, [refreshTick]);

  // 搜索框防抖 → 写回 filters，并回到第一页
  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      setFilters((f) => (f.q === qInput ? f : { ...f, q: qInput }));
      setPage(1);
    }, 300);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [qInput]);

  // 拉取列表
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const query: TeachingMaterialQuery = {
      q: filters.q || undefined,
      subject: filters.subject || undefined,
      region: filters.region || undefined,
      source: filters.source || undefined,
      difficulty: filters.difficulty ? Number(filters.difficulty) : '',
      popularity: filters.popularity ? Number(filters.popularity) : '',
      hasUrl: (filters.hasUrl || '') as TeachingMaterialQuery['hasUrl'],
      sort: sortKey,
      order: sortOrder,
      page,
      pageSize,
    };
    listTeachingMaterials(query)
      .then((res) => {
        if (cancelled) return;
        setRows(res.rows || []);
        setTotal(res.total || 0);
        setError('');
      })
      .catch((e) => {
        if (cancelled) return;
        console.error(e);
        setRows([]);
        setTotal(0);
        setError('教辅资料加载失败，请确认服务已启动');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filters, sortKey, sortOrder, page, pageSize, refreshTick]);

  const patch = useCallback((k: keyof FilterState, v: string) => {
    setFilters((f) => ({ ...f, [k]: v }));
    setPage(1);
  }, []);

  const reset = useCallback(() => {
    setFilters(EMPTY_FILTERS);
    setQInput('');
    setSortKey('id');
    setSortOrder('desc');
    setPage(1);
  }, []);

  const toggleSort = useCallback((key: string) => {
    setSortKey((k) => {
      if (k === key) {
        setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
        return k;
      }
      setSortOrder('desc');
      return key;
    });
    setPage(1);
  }, []);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [total, pageSize]);
  const activeFilterCount = useMemo(
    () => Object.entries(filters).filter(([, v]) => v !== '').length,
    [filters]
  );

  return (
    <div className="space-y-4">
      {/* 标题栏 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Database size={18} className="text-muted-foreground" />
            教辅资料
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            共 {facets?.total ?? '—'} 条（外部资料盘教辅清单，只读展示）
            {activeFilterCount > 0 && ` · 当前筛选命中 ${total} 条`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setRefreshTick((t) => t + 1)}>
            <RefreshCw size={14} className="mr-1" />
            刷新
          </Button>
          <Button variant="outline" size="sm" onClick={reset} disabled={activeFilterCount === 0}>
            <RotateCcw size={14} className="mr-1" />
            重置
          </Button>
        </div>
      </div>

      {/* 筛选栏 */}
      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-muted/20 p-3">
        <div className="min-w-[200px] flex-1">
          <label className="mb-1 block text-xs text-muted-foreground">名称搜索</label>
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
              placeholder="如：数学、暑假预习、人教版"
              className="pl-8"
            />
          </div>
        </div>

        <div className="w-[130px]">
          <label className="mb-1 block text-xs text-muted-foreground">科目</label>
          <Select value={filters.subject} onValueChange={(v) => patch('subject', v === '__all__' ? '' : v)}>
            <SelectTrigger><SelectValue placeholder="全部" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">全部</SelectItem>
              {(facets?.subjects || []).map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.value}（{s.count}）
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="w-[160px]">
          <label className="mb-1 block text-xs text-muted-foreground">地区 / 版本</label>
          <Select value={filters.region} onValueChange={(v) => patch('region', v === '__all__' ? '' : v)}>
            <SelectTrigger><SelectValue placeholder="全部" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">全部</SelectItem>
              {(facets?.regions || []).map((r) => (
                <SelectItem key={r.value || '__empty__'} value={r.value || '__empty__'}>
                  {r.value || '（空）'}（{r.count}）
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="w-[200px]">
          <label className="mb-1 block text-xs text-muted-foreground">来源</label>
          <Select value={filters.source} onValueChange={(v) => patch('source', v === '__all__' ? '' : v)}>
            <SelectTrigger><SelectValue placeholder="全部" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">全部</SelectItem>
              {(facets?.sources || []).map((s) => (
                <SelectItem key={s.value || '__empty__'} value={s.value || '__empty__'}>
                  <span className="block max-w-[280px] truncate">{s.value || '（空）'}（{s.count}）</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="w-[110px]">
          <label className="mb-1 block text-xs text-muted-foreground">难度</label>
          <Select value={filters.difficulty} onValueChange={(v) => patch('difficulty', v === '__all__' ? '' : v)}>
            <SelectTrigger><SelectValue placeholder="全部" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">全部</SelectItem>
              {(facets?.difficulties || []).map((d) => (
                <SelectItem key={d.value} value={String(d.value)}>
                  {d.value}（{d.count}）
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="w-[110px]">
          <label className="mb-1 block text-xs text-muted-foreground">热度</label>
          <Select value={filters.popularity} onValueChange={(v) => patch('popularity', v === '__all__' ? '' : v)}>
            <SelectTrigger><SelectValue placeholder="全部" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">全部</SelectItem>
              {(facets?.popularities || []).map((p) => (
                <SelectItem key={p.value} value={String(p.value)}>
                  {p.value}（{p.count}）
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="w-[110px]">
          <label className="mb-1 block text-xs text-muted-foreground">网盘链接</label>
          <Select value={filters.hasUrl} onValueChange={(v) => patch('hasUrl', v === '__all__' ? '' : v)}>
            <SelectTrigger><SelectValue placeholder="不限" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">不限</SelectItem>
              <SelectItem value="1">有链接</SelectItem>
              <SelectItem value="0">无链接</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* 表格 */}
      <div className="overflow-hidden rounded-lg border">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-foreground/70">
              <tr>
                {COLUMNS.map((c, i) => (
                  <th
                    key={`${c.key}-${i}`}
                    className={`whitespace-nowrap px-4 py-3 text-left font-medium ${c.className || ''} ${
                      c.sortable ? 'cursor-pointer select-none hover:text-foreground' : ''
                    }`}
                    onClick={() => c.sortable && toggleSort(c.key)}
                  >
                    <span className="inline-flex items-center gap-1">
                      {c.label}
                      {c.sortable && sortKey === c.key && (
                        sortOrder === 'asc'
                          ? <ArrowUp size={12} className="text-primary" />
                          : <ArrowDown size={12} className="text-primary" />
                      )}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={COLUMNS.length} className="px-4 py-10 text-center text-muted-foreground">
                    加载中…
                  </td>
                </tr>
              )}
              {!loading && error && (
                <tr>
                  <td colSpan={COLUMNS.length} className="px-4 py-10 text-center text-destructive">
                    {error}
                  </td>
                </tr>
              )}
              {!loading && !error && rows.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length} className="px-4 py-10 text-center text-muted-foreground">
                    没有符合条件的教辅资料
                  </td>
                </tr>
              )}
              {!loading && !error && rows.map((r) => (
                <tr key={r.id} className="border-t hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <span className="line-clamp-2 font-medium" title={r.name}>{r.name}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">#{r.id}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="flex flex-wrap gap-1">
                      {r.subject
                        ? r.subject.split('、').map((s) => (
                            <Badge key={s} variant="secondary" className="whitespace-nowrap">{s}</Badge>
                          ))
                        : <span className="text-muted-foreground">—</span>}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-foreground/80">
                    {r.region || <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-4 py-3"><ScoreCell value={r.difficulty} /></td>
                  <td className="px-4 py-3"><ScoreCell value={r.popularity} /></td>
                  <td className="px-4 py-3">
                    <span className="block max-w-[220px] truncate text-xs text-muted-foreground" title={r.source}>
                      {r.source || '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {r.url ? (
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-primary hover:underline"
                        title={r.url}
                      >
                        <ExternalLink size={13} />
                        打开
                      </a>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                    {fmtDate(r.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 分页 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>每页</span>
          <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setPage(1); }}>
            <SelectTrigger className="h-8 w-[70px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="20">20</SelectItem>
              <SelectItem value="50">50</SelectItem>
              <SelectItem value="100">100</SelectItem>
            </SelectContent>
          </Select>
          <span>条 · 共 {total} 条</span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || loading}
          >
            <ChevronLeft size={14} className="mr-1" />
            上一页
          </Button>
          <span className="text-xs text-muted-foreground">
            第 {page} / {totalPages} 页
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages || loading}
          >
            下一页
            <ChevronRight size={14} className="ml-1" />
          </Button>
        </div>
      </div>
    </div>
  );
}
