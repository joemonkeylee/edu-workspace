import { useState, useEffect, useCallback } from 'react';
import {
  bookPairsScan,
  bookPairsList,
  bookPairsOrphans,
  bookPairsOrphansExport,
  bookPairsBind,
  bookPairsUnbind,
  bookPairsBindBatch,
  bookPairsExport,
  bookPairsRules,
  type BookPairCandidate,
  type PairStats,
  type PairRules,
} from '../../api/client';
import { toast } from 'sonner';
import { useConfirm } from '../ConfirmDialog';
import { Loader2 } from 'lucide-react';

type Tab = 'scan' | 'bound' | 'orphans';
type OrphanRole = 'textbook' | 'answer' | 'none' | 'all';

export default function BookPairs() {
  const [tab, setTab] = useState<Tab>('scan');
  const [orphanRole, setOrphanRole] = useState<OrphanRole>('all');

  const handleScanFilter = (key: 'unbound' | 'duplicates' | 'bound' | 'orphanTextbook' | 'orphanAnswer' | 'noVersion' | null) => {
    if (key === 'bound') {
      setTab('bound');
    } else if (key === 'orphanTextbook') {
      setOrphanRole('textbook');
      setTab('orphans');
    } else if (key === 'orphanAnswer') {
      setOrphanRole('answer');
      setTab('orphans');
    } else if (key === 'noVersion') {
      setOrphanRole('none');
      setTab('orphans');
    } else {
      setTab('scan');
    }
  };

  return (
    <div className="p-6 flex flex-col h-full">
      <div className="flex items-center gap-2 mb-4">
        <TabButton active={tab === 'scan'} onClick={() => setTab('scan')}>配对扫描</TabButton>
        <TabButton active={tab === 'bound'} onClick={() => setTab('bound')}>已配对列表</TabButton>
        <TabButton active={tab === 'orphans'} onClick={() => setTab('orphans')}>孤儿 (未配对)</TabButton>
      </div>
      <div className="flex-1 overflow-auto">
        {tab === 'scan' && <ScanTab onFilter={handleScanFilter} />}
        {tab === 'bound' && <BoundTab />}
        {tab === 'orphans' && <OrphansTab role={orphanRole} onRoleChange={setOrphanRole} />}
      </div>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 rounded-t-lg text-sm font-medium border-b-2 ${
        active ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-gray-700'
      }`}
    >
      {children}
    </button>
  );
}

// ── Highlight palette (淡色循环，用于基础标题文字背景) ──────────────
// 4 个淡色循环，只给"基础标题"文字本身加底色，让同组文字一眼能对应
const HIGHLIGHT_COLORS = [
  'bg-sky-100/70',
  'bg-emerald-100/70',
  'bg-amber-100/70',
  'bg-violet-100/70',
];
function highlightColor(idx: number) {
  return HIGHLIGHT_COLORS[idx % HIGHLIGHT_COLORS.length];
}

// ── Pagination (固定在底部，含每页大小选择) ──────────────────────────

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];

function Pagination({
  total,
  page,
  pageSize,
  totalPages,
  onPageChange,
  onPageSizeChange,
  unit = '条',
}: {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  onPageChange: (p: number) => void;
  onPageSizeChange: (s: number) => void;
  unit?: string;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-t bg-white shrink-0">
      <span className="text-sm text-gray-500">共 {total} {unit}</span>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-1 text-sm text-gray-600">
          每页
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className="px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary bg-white"
          >
            {PAGE_SIZE_OPTIONS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          条
        </label>
        <div className="flex gap-1 items-center">
          <button disabled={page <= 1} onClick={() => onPageChange(page - 1)} className="px-3 py-1 border rounded text-sm disabled:opacity-50 hover:bg-gray-50">上一页</button>
          <span className="px-3 py-1 text-sm">{page} / {totalPages || 1}</span>
          <button disabled={page >= totalPages} onClick={() => onPageChange(page + 1)} className="px-3 py-1 border rounded text-sm disabled:opacity-50 hover:bg-gray-50">下一页</button>
        </div>
      </div>
    </div>
  );
}

// ── Statistics Card ────────────────────────────────────────────────

interface StatBoxConfig {
  label: string;
  value: number;
  color: string;
  desc: string;        // tooltip 说明
  filterKey?: 'unbound' | 'duplicates' | 'bound' | 'orphanTextbook' | 'orphanAnswer' | 'noVersion';  // 可筛选/跳转的卡片
}

function StatsCard({
  stats,
  onFilter,
  activeFilter,
}: {
  stats: PairStats | null;
  onFilter?: (key: 'unbound' | 'duplicates' | 'bound' | 'orphanTextbook' | 'orphanAnswer' | 'noVersion' | null) => void;
  activeFilter?: 'unbound' | 'duplicates' | 'bound' | 'orphanTextbook' | 'orphanAnswer' | 'noVersion' | null;
}) {
  if (!stats) return null;
  const boxes: StatBoxConfig[] = [
    { label: '总书数', value: stats.totalBooks, color: 'text-gray-700', desc: '数据库中所有书籍的总数量（含已配对/未配对/无版本关键词）' },
    { label: '候选配对', value: stats.candidatePairs, color: 'text-blue-600', desc: '按基础标题相等匹配到的教材+答案组合数（含已绑定和待绑定）' },
    { label: '已绑定', value: stats.boundPairs, color: 'text-green-600', desc: '已确认配对并写入 attributes.pair 的组数（点击查看已配对列表）', filterKey: 'bound' },
    { label: '待绑定', value: stats.unboundPairs, color: 'text-orange-600', desc: '候选配对中尚未确认绑定的组数（点击切换"仅未绑定"筛选）', filterKey: 'unbound' },
    { label: '多选项组', value: stats.duplicateGroups, color: 'text-red-600', desc: '同组有多个教材或多个答案，存在多种配对可能（点击筛选）', filterKey: 'duplicates' },
    { label: '孤儿教材', value: stats.orphanTextbooks, color: 'text-amber-600', desc: '有教材关键词但没有匹配到答案的书（点击查看）', filterKey: 'orphanTextbook' },
    { label: '孤儿答案', value: stats.orphanAnswers, color: 'text-amber-600', desc: '有答案关键词但没有匹配到教材的书（点击查看）', filterKey: 'orphanAnswer' },
    { label: '无版本关键词', value: stats.noVersionKeyword, color: 'text-gray-400', desc: '标题不含"原卷版/解析版/答案"等关键词，不参与自动配对（点击查看）', filterKey: 'noVersion' },
  ];
  return (
    <div className="flex flex-wrap gap-2 mb-4">
      {boxes.map((b) => (
        <StatBox
          key={b.label}
          {...b}
          active={activeFilter === b.filterKey}
          onFilter={onFilter && b.filterKey ? () => onFilter(activeFilter === b.filterKey ? null : b.filterKey!) : undefined}
        />
      ))}
    </div>
  );
}

function StatBox({ label, value, color, desc, filterKey, onFilter, active }: StatBoxConfig & { onFilter?: () => void; active?: boolean }) {
  const clickable = !!onFilter;
  return (
    <div
      className={`bg-white rounded-lg shadow-sm px-3 py-2 flex-1 min-w-[120px] relative group ${clickable ? 'cursor-pointer hover:shadow-md transition' : ''} ${active ? 'border-2 border-primary -m-px' : 'border'}`}
      onClick={onFilter}
      title={desc}
    >
      <div className="flex items-center gap-1">
        <p className="text-xs text-gray-500 truncate flex-1">{label}</p>
        <span
          className="text-gray-300 hover:text-gray-500 cursor-help text-xs"
          onClick={(e) => { if (clickable) e.stopPropagation(); }}
          title={desc}
        >?</span>
      </div>
      <p className={`text-lg font-bold ${color}`}>{value}</p>
      {/* hover tooltip */}
      <div className="absolute left-0 top-full mt-1 z-20 hidden group-hover:block bg-gray-800 text-white text-xs rounded px-2 py-1 whitespace-normal w-48 shadow-lg">
        {desc}
      </div>
    </div>
  );
}

// ── Highlight base title portion within full title ─────────────────
// Full title like "鲁教版6.5 一次函数的应用（解析版）" — baseTitle is
// "鲁教版6.5 一次函数的应用", remaining part "（解析版）" is the version suffix.
// baseTitle 部分会加上淡色背景，让同组文字一眼能对应；before/after 部分保持灰色。
function HighlightedTitle({ title, baseTitle, highlightClass = '' }: { title: string; baseTitle: string; highlightClass?: string }) {
  const idx = title.indexOf(baseTitle);
  if (idx === -1 || !baseTitle) {
    return <span className="text-gray-700">{title}</span>;
  }
  const before = title.slice(0, idx);
  const after = title.slice(idx + baseTitle.length);
  return (
    <span>
      {before && <span className="text-gray-400">{before}</span>}
      <span className={`text-gray-800 font-medium px-1 rounded ${highlightClass}`}>{baseTitle}</span>
      {after && <span className="text-gray-400">{after}</span>}
    </span>
  );
}

// ── Rules Modal (展示当前匹配规则) ──────────────────────────────────

function RulesModal({ onClose }: { onClose: () => void }) {
  const [rules, setRules] = useState<PairRules | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    bookPairsRules()
      .then(setRules)
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <h3 className="font-bold text-base">教材答案配对规则</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        {loading ? (
          <div className="p-8 text-center text-gray-400">加载中...</div>
        ) : rules ? (
          <div className="px-5 py-4 space-y-4 text-sm">
            <div>
              <h4 className="font-semibold text-gray-700 mb-1">核心规则</h4>
              <p className="text-gray-600 bg-gray-50 rounded p-2">{rules.rule}</p>
            </div>
            <div>
              <h4 className="font-semibold text-gray-700 mb-1">示例</h4>
              <ul className="space-y-1">
                {rules.examples.map((ex, i) => (
                  <li key={i} className="text-gray-600 bg-gray-50 rounded p-2 font-mono text-xs">{ex}</li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="font-semibold text-gray-700 mb-1">括号匹配模式</h4>
              <ul className="space-y-1">
                {rules.bracketPatterns.map((p) => (
                  <li key={p.pattern} className="flex gap-3 items-center">
                    <code className="bg-gray-100 px-2 py-0.5 rounded text-xs">{p.pattern}</code>
                    <span className="text-gray-600 text-xs">{p.desc}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="font-semibold text-gray-700 mb-1">教材关键词（识别为"教材侧"）</h4>
              <div className="flex flex-wrap gap-1">
                {rules.textbookKeywords.map((kw) => (
                  <span key={kw} className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded text-xs">{kw}</span>
                ))}
              </div>
            </div>
            <div>
              <h4 className="font-semibold text-gray-700 mb-1">答案关键词（识别为"答案侧"）</h4>
              <div className="flex flex-wrap gap-1">
                {rules.answerKeywords.map((kw) => (
                  <span key={kw} className="bg-teal-50 text-teal-700 px-2 py-0.5 rounded text-xs">{kw}</span>
                ))}
              </div>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded p-3 text-xs text-amber-700">
              <p className="font-semibold mb-1">规则扩展提示</p>
              <p>当前规则覆盖约 95% 的"原卷版 ↔ 解析版"配对。剩余 5% 零散组合（如《详解》《全解全析》等）可在"孤儿"Tab 手动配对，或扩展 ANSWER_KEYWORDS 数组自动覆盖。</p>
            </div>
          </div>
        ) : (
          <div className="p-8 text-center text-gray-400">加载失败</div>
        )}
      </div>
    </div>
  );
}

// ── Scan Tab ───────────────────────────────────────────────────────

function ScanTab({ onFilter }: { onFilter?: (key: 'unbound' | 'duplicates' | 'bound' | 'orphanTextbook' | 'orphanAnswer' | 'noVersion' | null) => void }) {
  const confirm = useConfirm();
  const [candidates, setCandidates] = useState<BookPairCandidate[]>([]);
  const [stats, setStats] = useState<PairStats | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [scanFilter, setScanFilter] = useState<'unbound' | 'duplicates' | null>(null);
  const [filters, setFilters] = useState({ unbound: false, duplicates: false, excludeDuplicates: false, search: '' });
  const [showRules, setShowRules] = useState(false);
  const [batchBinding, setBatchBinding] = useState(false);
  const [actionKey, setActionKey] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const res = await bookPairsScan({
        page,
        pageSize,
        unbound: filters.unbound,
        duplicates: filters.duplicates,
        excludeDuplicates: filters.excludeDuplicates,
        search: filters.search,
      });
      setCandidates(res.data);
      setStats(res.stats);
      setTotal(res.total);
      setSelected(new Set());
    } catch (e: any) {
      toast.error('扫描失败: ' + (e?.message || ''));
    }
    setLoading(false);
  }, [page, pageSize, filters.unbound, filters.duplicates, filters.excludeDuplicates, filters.search]);

  useEffect(() => { fetch(); }, [fetch]);

  const totalPages = Math.ceil(total / pageSize);

  const toggleSelect = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === candidates.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(candidates.map((c) => c.key)));
    }
  };

  const handleBatchBind = async () => {
    if (selected.size === 0) { toast.warning('请先勾选要配对的书'); return; }
    const pairs: Array<{ textbookId: number; answerIds: number[] }> = [];
    let alreadyBound = 0;
    let missingSide = 0;
    for (const c of candidates) {
      if (!selected.has(c.key)) continue;
      if (c.bound) { alreadyBound++; continue; }
      if (c.textbooks.length === 0 || c.answers.length === 0) { missingSide++; continue; }
      pairs.push({ textbookId: c.textbooks[0].id, answerIds: c.answers.map((a) => a.id) });
    }
    if (pairs.length === 0) {
      toast.warning(`没有可绑定的项${alreadyBound ? `（${alreadyBound} 组已绑定被跳过）` : ''}`);
      return;
    }
    const confirmed = await confirm({
      title: '批量绑定确认',
      message: `确认绑定选中的 ${pairs.length} 组配对？${
        alreadyBound ? `已绑定 ${alreadyBound} 组将跳过。` : ''
      }此操作会写入教材与答案的配对关系到 attributes.pair。`,
      confirmText: '确认批量绑定',
      confirmClass: 'bg-blue-600 hover:bg-blue-700',
    });
    if (!confirmed) return;
    setBatchBinding(true);
    try {
      const res = await bookPairsBindBatch(pairs);
      const parts = [`已绑定 ${res.boundCount} 组配对`];
      if (alreadyBound) parts.push(`跳过已绑定 ${alreadyBound} 组`);
      if (missingSide) parts.push(`跳过缺项 ${missingSide} 组`);
      toast.success(parts.join('，'));
      fetch();
    } catch (e: any) {
      toast.error('批量绑定失败: ' + (e?.message || ''));
    } finally {
      setBatchBinding(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const blob = await bookPairsExport({
        unbound: filters.unbound || undefined,
        duplicates: filters.duplicates || undefined,
        search: filters.search || undefined,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `book-pairs-${Date.now()}.txt`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('导出成功');
    } catch (e: any) {
      toast.error('导出失败: ' + (e?.message || ''));
    } finally {
      setExporting(false);
    }
  };

  const handleSingleBind = async (c: BookPairCandidate) => {
    if (c.textbooks.length === 0 || c.answers.length === 0) {
      toast.warning('教材或答案缺失，无法配对');
      return;
    }
    setActionKey(c.key);
    try {
      await bookPairsBind(c.textbooks[0].id, c.answers.map((a) => a.id));
      toast.success(`已配对: ${c.baseTitle}`);
      await fetch();
    } catch (e: any) {
      toast.error('绑定失败: ' + (e?.message || ''));
    } finally {
      setActionKey(null);
    }
  };

  const handleSingleUnbind = async (c: BookPairCandidate) => {
    if (c.textbooks.length === 0) return;
    const confirmed = await confirm({
      title: '解绑确认',
      message: `确认解绑「${c.baseTitle}」及其全部答案？`,
      confirmText: '确认解绑',
      confirmClass: 'bg-red-600 hover:bg-red-700',
    });
    if (!confirmed) return;
    setActionKey(c.key);
    try {
      await bookPairsUnbind(c.textbooks[0].id);
      toast.success(`已解绑: ${c.baseTitle}`);
      await fetch();
    } catch (e: any) {
      toast.error('解绑失败: ' + (e?.message || ''));
    } finally {
      setActionKey(null);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <StatsCard
        stats={stats}
        activeFilter={scanFilter}
        onFilter={(key) => {
          if (key === 'unbound' || key === 'duplicates') {
            setScanFilter(key);
            setFilters({
              ...filters,
              unbound: key === 'unbound',
              duplicates: key === 'duplicates',
            });
            setPage(1);
          } else {
            // orphanTextbook / orphanAnswer / noVersion → delegate to parent to switch tab
            onFilter?.(key);
          }
        }}
      />

      <div className="flex items-center gap-3 mb-4 flex-wrap shrink-0">
        <input
          type="text"
          placeholder="搜索基础标题或分类"
          value={filters.search}
          onChange={(e) => { setFilters({ ...filters, search: e.target.value }); setPage(1); }}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm w-64 focus:outline-none focus:border-primary"
        />
        <label className="flex items-center gap-1.5 text-sm text-gray-600">
          筛选:
          <select
            value={filters.unbound ? (filters.excludeDuplicates ? 'cleanUnbound' : 'unbound') : filters.duplicates ? 'duplicates' : 'all'}
            onChange={(e) => {
              const v = e.target.value;
              if (v === 'all') setFilters({ unbound: false, duplicates: false, excludeDuplicates: false, search: filters.search });
              else if (v === 'unbound') setFilters({ unbound: true, duplicates: false, excludeDuplicates: false, search: filters.search });
              else if (v === 'cleanUnbound') setFilters({ unbound: true, duplicates: false, excludeDuplicates: true, search: filters.search });
              else if (v === 'duplicates') setFilters({ unbound: false, duplicates: true, excludeDuplicates: false, search: filters.search });
              setPage(1);
            }}
            className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-primary bg-white"
          >
            <option value="all">全部</option>
            <option value="unbound">仅未绑定</option>
            <option value="cleanUnbound">未绑定（非多选项）</option>
            <option value="duplicates">仅多选项</option>
          </select>
        </label>
        <button onClick={fetch} disabled={batchBinding} className="px-4 py-2 bg-gray-100 rounded-lg text-sm hover:bg-gray-200 disabled:opacity-50">刷新</button>
        <button onClick={handleExport} disabled={exporting || batchBinding} className="flex items-center gap-1.5 px-4 py-2 bg-gray-100 rounded-lg text-sm hover:bg-gray-200 disabled:opacity-50">
          {exporting ? <Loader2 size={14} className="animate-spin" /> : null}
          {exporting ? '导出中...' : '导出 TXT'}
        </button>
        <button onClick={handleBatchBind} disabled={selected.size === 0 || batchBinding} className="flex items-center gap-1.5 px-4 py-2 bg-primary text-white rounded-lg text-sm hover:opacity-90 disabled:opacity-50">
          {batchBinding ? <Loader2 size={15} className="animate-spin" /> : null}
          {batchBinding ? `批量绑定中... (${selected.size})` : `批量绑定 (${selected.size})`}
        </button>
        <button
          onClick={() => setShowRules(true)}
          className="ml-auto px-3 py-2 text-xs text-gray-500 border border-gray-300 rounded-lg hover:bg-gray-50"
          title="查看当前匹配规则和关键词"
        >
          ? 匹配规则说明
        </button>
      </div>

      {showRules && <RulesModal onClose={() => setShowRules(false)} />}

      <div className="relative bg-white rounded-lg shadow flex flex-col flex-1 overflow-hidden">
        {batchBinding && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/60">
            <Loader2 className="animate-spin text-primary" size={28} />
          </div>
        )}
        <div className="overflow-auto flex-1">
          <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 sticky top-0">
            <tr>
              <th className="px-3 py-2 text-left w-8">
                <input type="checkbox" checked={selected.size > 0 && selected.size === candidates.length} onChange={toggleSelectAll} />
              </th>
              <th className="px-3 py-2 text-left">基础标题</th>
              <th className="px-3 py-2 text-left">分类</th>
              <th className="px-3 py-2 text-left">教材</th>
              <th className="px-3 py-2 text-left">答案</th>
              <th className="px-3 py-2 text-left">状态</th>
              <th className="px-3 py-2 text-left">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {candidates.map((c, idx) => {
              const hc = highlightColor(idx);
              return (
              <tr key={c.key} className={`${idx % 2 === 1 ? 'bg-gray-50/40' : ''} hover:bg-gray-100`}>
                <td className="px-3 py-2">
                  <input type="checkbox" checked={selected.has(c.key)} onChange={() => toggleSelect(c.key)} />
                </td>
                <td className="px-3 py-2 font-medium">
                  <span className={`px-1 rounded ${hc}`}>{c.baseTitle}</span>
                </td>
                <td className="px-3 py-2 text-gray-500">{c.category}</td>
                <td className="px-3 py-2">
                  {c.textbooks.map((t) => (
                    <div key={t.id} className="text-xs">
                      <a href={`/book/${t.id}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">#{t.id}</a>{' '}
                      <HighlightedTitle title={t.title} baseTitle={c.baseTitle} highlightClass={hc} />{' '}
                      <span className="text-gray-400">({t.totalPages}p)</span>
                    </div>
                  ))}
                </td>
                <td className="px-3 py-2">
                  {c.answers.map((a) => (
                    <div key={a.id} className="text-xs">
                      <a href={`/book/${a.id}`} target="_blank" rel="noopener noreferrer" className="text-teal-600 hover:underline">#{a.id}</a>{' '}
                      <HighlightedTitle title={a.title} baseTitle={c.baseTitle} highlightClass={hc} />{' '}
                      <span className="text-gray-400">({a.totalPages}p)</span>
                    </div>
                  ))}
                </td>
                <td className="px-3 py-2">
                  {c.bound ? <span className="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded">已绑定</span>
                    : <span className="text-xs text-orange-600 bg-orange-50 px-2 py-0.5 rounded">待绑定</span>}
                  {c.hasDuplicate && <span className="ml-1 text-xs text-red-600 bg-red-50 px-2 py-0.5 rounded">多选项</span>}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {actionKey === c.key ? (
                    <Loader2 size={14} className="animate-spin text-gray-500" />
                  ) : c.bound ? (
                    <button onClick={() => handleSingleUnbind(c)} className="text-xs text-red-600 hover:underline">解绑</button>
                  ) : (
                    <button onClick={() => handleSingleBind(c)} className="text-xs text-blue-600 hover:underline">绑定</button>
                  )}
                </td>
              </tr>
              );
            })}
            {candidates.length === 0 && !loading && (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-400">无配对候选</td></tr>
            )}
          </tbody>
          </table>
        </div>
        <Pagination
          total={total}
          page={page}
          pageSize={pageSize}
          totalPages={totalPages}
          onPageChange={setPage}
          onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
          unit="条"
        />
      </div>
    </div>
  );
}

// ── Bound Tab ──────────────────────────────────────────────────────

function BoundTab() {
  const confirm = useConfirm();
  const [groups, setGroups] = useState<Array<{ textbook: any; answers: any[] }>>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const res = await bookPairsList({ page, pageSize, search });
      setGroups(res.data);
      setTotal(res.total);
    } catch (e: any) {
      toast.error('加载失败: ' + (e?.message || ''));
    }
    setLoading(false);
  }, [page, pageSize, search]);

  useEffect(() => { fetch(); }, [fetch]);

  const totalPages = Math.ceil(total / pageSize);

  const handleUnbind = async (textbookId: number, title: string) => {
    const confirmed = await confirm({
      title: '解绑确认',
      message: `确认解绑「${title}」及其全部答案？`,
      confirmText: '确认解绑',
      confirmClass: 'bg-red-600 hover:bg-red-700',
    });
    if (confirmed) {
      try {
        await bookPairsUnbind(textbookId);
        toast.success('已解绑');
        fetch();
      } catch (e: any) {
        toast.error('解绑失败: ' + (e?.message || ''));
      }
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 mb-4 flex-wrap shrink-0">
        <input
          type="text"
          placeholder="搜索标题或分类"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm w-64 focus:outline-none focus:border-primary"
        />
        <button onClick={fetch} className="px-4 py-2 bg-gray-100 rounded-lg text-sm hover:bg-gray-200">搜索</button>
      </div>

      <div className="bg-white rounded-lg shadow flex flex-col flex-1 overflow-hidden">
        <div className="overflow-auto flex-1">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 sticky top-0">
              <tr>
                <th className="px-3 py-2 text-left">教材</th>
                <th className="px-3 py-2 text-left">分类</th>
                <th className="px-3 py-2 text-left">答案</th>
                <th className="px-3 py-2 text-left">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {groups.map((g, idx) => (
                <tr key={g.textbook.id} className={`${idx % 2 === 1 ? 'bg-gray-50/40' : ''} hover:bg-gray-100`}>
                  <td className="px-3 py-2">
                    <div className="font-medium"><a href={`/book/${g.textbook.id}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">#{g.textbook.id}</a> {g.textbook.title}</div>
                    <div className="text-xs text-gray-400">{g.textbook.totalPages} 页</div>
                  </td>
                  <td className="px-3 py-2 text-gray-500">{g.textbook.category}</td>
                  <td className="px-3 py-2">
                    {g.answers.map((a: any) => (
                      <div key={a.id} className="text-xs">
                        <a href={`/book/${a.id}`} target="_blank" rel="noopener noreferrer" className="text-teal-600 hover:underline">#{a.id}</a> {a.title} <span className="text-gray-400">({a.totalPages}p)</span>
                      </div>
                    ))}
                    {g.answers.length === 0 && <span className="text-gray-400 text-xs">无答案</span>}
                  </td>
                  <td className="px-3 py-2">
                    <button onClick={() => handleUnbind(g.textbook.id, g.textbook.title)} className="text-xs text-red-600 hover:underline">解绑</button>
                  </td>
                </tr>
              ))}
              {groups.length === 0 && !loading && (
                <tr><td colSpan={4} className="px-3 py-8 text-center text-gray-400">暂无已配对数据</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination
          total={total}
          page={page}
          pageSize={pageSize}
          totalPages={totalPages}
          onPageChange={setPage}
          onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
          unit="组"
        />
      </div>
    </div>
  );
}

// ── Orphans Tab ────────────────────────────────────────────────────

type OrphanRow = { id: number; title: string; category: string; totalPages: number; type: string; role: string | null };

function OrphansTab({ role, onRoleChange }: { role: OrphanRole; onRoleChange: (r: OrphanRole) => void }) {
  const [orphans, setOrphans] = useState<OrphanRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [sortBy, setSortBy] = useState('id');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [exporting, setExporting] = useState(false);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const res = await bookPairsOrphans({ page, pageSize, search, role, sortBy, sortDir });
      setOrphans(res.data);
      setTotal(res.total);
      setSelected(new Set());
    } catch (e: any) {
      toast.error('加载失败: ' + (e?.message || ''));
    }
    setLoading(false);
  }, [page, pageSize, search, role, sortBy, sortDir]);

  useEffect(() => { fetch(); }, [fetch]);

  const totalPages = Math.ceil(total / pageSize);

  const toggleSort = (col: string) => {
    if (sortBy === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(col);
      setSortDir('asc');
    }
  };

  const toggleRow = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === orphans.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(orphans.map((o) => o.id)));
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const blob = await bookPairsOrphansExport({
        role,
        search: search || undefined,
        ids: selected.size > 0 ? Array.from(selected) : undefined,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `orphans-${Date.now()}.txt`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(selected.size > 0 ? `已导出 ${selected.size} 条` : '已导出全部筛选数据');
    } catch (e: any) {
      toast.error('导出失败: ' + (e?.message || ''));
    } finally {
      setExporting(false);
    }
  };

  const SortHeader = ({ label, col, w = '' }: { label: string; col: string; w?: string }) => (
    <th className={`px-3 py-2 text-left cursor-pointer select-none hover:bg-gray-100 ${w}`} onClick={() => toggleSort(col)}>
      <span className="inline-flex items-center gap-1">
        {label}
        {sortBy === col && <span className="text-primary">{sortDir === 'asc' ? '↑' : '↓'}</span>}
      </span>
    </th>
  );

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 mb-4 flex-wrap shrink-0">
        <select
          value={role}
          onChange={(e) => { onRoleChange(e.target.value as OrphanRole); setPage(1); }}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-primary bg-white"
        >
          <option value="all">全部</option>
          <option value="textbook">孤儿教材</option>
          <option value="answer">孤儿答案</option>
          <option value="none">无版本关键词</option>
        </select>
        <input
          type="text"
          placeholder="搜索标题或分类"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm w-64 focus:outline-none focus:border-primary"
        />
        <button onClick={fetch} className="px-4 py-2 bg-gray-100 rounded-lg text-sm hover:bg-gray-200">刷新</button>
        <button onClick={handleExport} disabled={exporting} className="flex items-center gap-1.5 px-4 py-2 bg-gray-100 rounded-lg text-sm hover:bg-gray-200 disabled:opacity-50">
          {exporting ? <Loader2 size={14} className="animate-spin" /> : null}
          {exporting ? '导出中...' : selected.size > 0 ? `导出选中 (${selected.size})` : '导出全部'}
        </button>
      </div>

      <div className="bg-white rounded-lg shadow flex flex-col flex-1 overflow-hidden">
        <div className="overflow-auto flex-1">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 sticky top-0">
              <tr>
                <th className="px-3 py-2 text-left w-8">
                  <input
                    type="checkbox"
                    checked={selected.size > 0 && selected.size === orphans.length}
                    onChange={toggleSelectAll}
                  />
                </th>
                <SortHeader label="ID" col="id" w="w-20" />
                <SortHeader label="标题" col="title" />
                <SortHeader label="分类" col="category" w="w-28" />
                <SortHeader label="页数" col="totalPages" w="w-16" />
                <SortHeader label="类型" col="type" w="w-28" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {orphans.map((o, idx) => {
                const checked = selected.has(o.id);
                return (
                  <tr key={o.id} className={`${checked ? 'bg-blue-50' : idx % 2 === 1 ? 'bg-gray-50/40' : ''} hover:bg-gray-100`}>
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleRow(o.id)}
                      />
                    </td>
                    <td className="px-3 py-2 text-gray-500"><a href={`/book/${o.id}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">#{o.id}</a></td>
                    <td className="px-3 py-2">{o.title}</td>
                    <td className="px-3 py-2 text-gray-500">{o.category}</td>
                    <td className="px-3 py-2 text-gray-400">{o.totalPages}</td>
                    <td className="px-3 py-2">
                      <span className={`text-xs px-2 py-0.5 rounded ${
                        o.type === '孤儿教材' ? 'bg-blue-50 text-blue-700' :
                        o.type === '孤儿答案' ? 'bg-teal-50 text-teal-700' :
                        'bg-gray-100 text-gray-600'
                      }`}>{o.type}</span>
                    </td>
                  </tr>
                );
              })}
              {orphans.length === 0 && !loading && (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-400">暂无数据</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination
          total={total}
          page={page}
          pageSize={pageSize}
          totalPages={totalPages}
          onPageChange={setPage}
          onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
          unit="条"
        />
      </div>
    </div>
  );
}
