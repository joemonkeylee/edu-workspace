import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  listBooks, getFacets, updateBook, deleteBook, toggleFavorite,
  type PdfBookSummary,
} from '../api/pdfClient';
import {
  defaultBookSort, defaultFavSort, loadKindFilters, saveKindFilters,
  loadResourceKind, saveResourceKind, loadViewMode, saveViewMode,
  loadListPageSize, saveListPageSize,
  type KindFilterState, type PdfResourceKind, type SortFieldDef, type SortFieldName, type ViewMode,
} from '../store/pdfHomeFilters';
import PdfBookCover from '../components/PdfBookCover';
import PdfResourceKindMenu from '../components/PdfResourceKindMenu';
import AppHeaderRight from '@/components/AppHeaderRight';
import {
  GraduationCap, ChevronLeft, ChevronRight, X, Trash2, RotateCcw, RefreshCw,
  Search, ArrowUp, ArrowDown, Minus, GripVertical, LayoutGrid, List, Star,
  FileText, ScanLine, AlertTriangle, FileWarning,
} from 'lucide-react';
import { toast } from 'sonner';
import { useConfirm } from '@/components/ConfirmDialog';

/**
 * PDF 书库列表页。
 *
 * 交互与图片模式的 Home 完全对齐：三下拉 + 关键字 + 显式「搜索」按钮、
 * 多字段可拖拽排序、预览/列表双视图、行列可调的分页、编辑模式批量改删 + 未保存守卫、
 * 收藏与筛选记忆。差异只在语义：
 *   - 「只看有答案」→「只看文件缺失」（PDF 域没有答案配对，换盘后找回缺失文件才是真实诉求）
 *   - 封面角标用「可搜索性 / 文件缺失」替代「讲解视频」
 * 封面容器仍按 A4 比例（210:297），配合 contain 保证整张可见 —— 与 books 页一致。
 */
const COVER_ASPECT = '210 / 297';
const STORAGE_KEY_PER_ROW = 'edu-pdf-home-per-row';

const SORT_LABELS: Record<SortFieldName, string> = {
  subject: '学科',
  grade: '学期',
  category: '分类',
  title: '关键字',
  totalPages: '页数',
  favoriteAt: '收藏时间',
};

const SUBJECT_ORDER = ['语文', '数学', '英语', '物理', '化学', '生物', '政治', '历史', '地理', '科学', '道法'];
const GRADE_ORDER = ['七上', '七下', '八上', '八下', '九上', '九下'];

const SEARCHABLE_LABEL: Record<string, string> = {
  ok: '可搜索',
  no_text: '扫描件·不可搜',
  garbled: '编码损坏',
  watermark_only: '仅水印',
};

function loadBooksPerRow(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PER_ROW);
    if (raw) return Math.max(3, Math.min(10, parseInt(raw, 10) || 8));
  } catch { /* ignore */ }
  return 8;
}

function ClearableSelect({
  value, onChange, placeholder, options, className = 'w-36',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  options: string[] | { name: string; count?: number }[];
  className?: string;
}) {
  const opts = options.map((o) => (typeof o === 'string' ? { name: o, count: undefined } : o));
  const totalCount = opts.reduce((sum, o) => sum + (o.count || 0), 0);
  return (
    <div className={`relative ${className}`}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full appearance-none rounded-lg border border-border bg-card py-1.5 pl-2.5 pr-8 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
      >
        <option value="">{totalCount > 0 ? `${placeholder} (${totalCount})` : placeholder}</option>
        {opts.map((opt) => (
          <option key={opt.name} value={opt.name}>
            {opt.count !== undefined ? `${opt.name} (${opt.count})` : opt.name}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">▾</span>
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="absolute right-6 top-1/2 -translate-y-1/2 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-muted-foreground/30 text-white hover:bg-muted-foreground/50"
          title="清除"
        >
          <X size={10} strokeWidth={3} />
        </button>
      )}
    </div>
  );
}

function SavePrompt({ onSave, onDiscard, onCancel }: {
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 dark:bg-black/60">
      <div className="relative w-80 rounded-xl bg-card p-6 shadow-xl">
        <button
          onClick={onCancel}
          className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-muted-foreground"
          title="取消"
        >
          <X size={16} />
        </button>
        <h3 className="text-base font-semibold text-foreground">有未保存的修改</h3>
        <p className="mt-2 text-sm text-muted-foreground">是否保存当前编辑？</p>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onDiscard} className="rounded-lg px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted">不保存</button>
          <button onClick={onSave} className="rounded-lg bg-primary px-3 py-1.5 text-sm text-white opacity-90 hover:opacity-100">保存</button>
        </div>
      </div>
    </div>
  );
}

export default function PdfHome() {
  const confirm = useConfirm();
  const [resourceKind, setResourceKind] = useState<PdfResourceKind>(loadResourceKind);
  // 每个 Tab 各一套筛选/排序/关键字，初始值取自当前 Tab
  const initial = useMemo(() => loadKindFilters(loadResourceKind()), []);
  const kindRef = useRef<PdfResourceKind>(resourceKind);

  const [selectedSubject, setSelectedSubject] = useState(initial.subject);
  const [selectedGrade, setSelectedGrade] = useState(initial.grade);
  const [selectedCategory, setSelectedCategory] = useState(initial.category);
  const [search, setSearch] = useState(initial.search);
  const [applied, setApplied] = useState({ ...initial.applied });
  const [favoritesOnly, setFavoritesOnly] = useState<boolean>(initial.favoritesOnly);
  const [missingOnly, setMissingOnly] = useState<boolean>(initial.missingOnly);
  const [sortFields, setSortFields] = useState<SortFieldDef[]>(initial.sortFields);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [page, setPage] = useState(initial.page);

  const [items, setItems] = useState<PdfBookSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const [facets, setFacets] = useState<{
    grades: { value: string; count: number }[];
    subjects: { value: string; count: number }[];
    categories: { value: string; count: number }[];
    searchable: { value: string; count: number }[];
    kinds: Record<string, number>;
    missing: number;
  }>({ grades: [], subjects: [], categories: [], searchable: [], kinds: {}, missing: 0 });

  const sortString = useMemo(() => {
    const active = sortFields.filter((s) => s.dir !== null);
    if (active.length === 0) return undefined;
    return active.map((s) => `${s.field}:${s.dir}`).join(',');
  }, [sortFields]);

  const toggleSortDir = (field: SortFieldName) => {
    setSortFields((prev) => prev.map((s) => {
      if (s.field !== field) return s;
      // 页数 / 收藏时间首次点击默认降序（多的在前 / 最近收藏在前）
      if (field === 'totalPages' || field === 'favoriteAt') {
        const next = s.dir === null ? 'desc' : s.dir === 'desc' ? 'asc' : null;
        return { ...s, dir: next };
      }
      const next = s.dir === null ? 'asc' : s.dir === 'asc' ? 'desc' : null;
      return { ...s, dir: next };
    }));
  };

  const onDragStart = (idx: number) => setDragIndex(idx);
  const onDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === idx) return;
    setSortFields((prev) => {
      const next = [...prev];
      const [moved] = next.splice(dragIndex, 1);
      next.splice(idx, 0, moved);
      return next;
    });
    setDragIndex(idx);
  };
  const onDragEnd = () => setDragIndex(null);

  const resetSort = () => setSortFields(favoritesOnly ? defaultFavSort() : defaultBookSort());
  const [pageInput, setPageInput] = useState(String(initial.page));
  const [rowsPerPage, setRowsPerPage] = useState(2);
  const [viewMode, setViewMode] = useState<ViewMode>(loadViewMode);
  const [listPageSize, setListPageSize] = useState(loadListPageSize);
  const [booksPerRow, setBooksPerRow] = useState(loadBooksPerRow);
  const pageSize = viewMode === 'preview' ? booksPerRow * rowsPerPage : listPageSize;

  const switchViewMode = (mode: ViewMode) => {
    if (mode === viewMode) return;
    setViewMode(mode);
    saveViewMode(mode);
    setPage(1);
    setPageInput('1');
  };

  const changeBooksPerRow = (n: number) => {
    setBooksPerRow(n);
    try { localStorage.setItem(STORAGE_KEY_PER_ROW, String(n)); } catch { /* ignore */ }
    setPage(1);
    setPageInput('1');
  };

  const changeListPageSize = (n: number) => {
    const clamped = Math.max(10, Math.min(50, n));
    setListPageSize(clamped);
    saveListPageSize(clamped);
    setPage(1);
    setPageInput('1');
  };

  // Edit mode state
  const [editMode, setEditMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [draftEdits, setDraftEdits] = useState<Map<number, { title: string; category: string; subject: string; grade: string }>>(new Map());
  const [pendingDeletes, setPendingDeletes] = useState<Set<number>>(new Set());
  const [showSavePrompt, setShowSavePrompt] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  // 未保存守卫下的「延后执行」动作，替代旧实现里挂在 window 上的临时变量
  const pendingActionRef = useRef<(() => void) | null>(null);
  // 守卫来源：'exit' 表示点的是「退出编辑」，其余只是改筛选/切 Tab，保存后要留在编辑模式
  const promptActionRef = useRef<'exit' | 'action'>('exit');

  const kindParam = resourceKind === 'all' ? undefined : resourceKind;

  // Server-side fetch
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listBooks({
      category: applied.category || undefined,
      grade: applied.grade || undefined,
      subject: applied.subject || undefined,
      q: applied.search || undefined,
      sort: sortString,
      page,
      pageSize,
      favoritesOnly,
      kind: kindParam,
      missing: missingOnly ? '1' : undefined,
    })
      .then((res) => {
        if (cancelled) return;
        setItems(res.data);
        setTotal(res.total);
      })
      .catch((e: any) => {
        if (!cancelled) toast.error('加载失败: ' + (e?.message || ''));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [page, applied, sortString, pageSize, favoritesOnly, missingOnly, resourceKind, reloadTick]);

  useEffect(() => {
    getFacets().then(setFacets).catch(() => { /* 筛选器失败不阻塞列表 */ });
  }, [reloadTick]);

  // 把当前这套状态持续写回「当前 Tab」的槽位
  useEffect(() => {
    saveKindFilters(kindRef.current, {
      subject: selectedSubject,
      grade: selectedGrade,
      category: selectedCategory,
      search,
      applied,
      sortFields,
      favoritesOnly,
      missingOnly,
      page,
    });
  }, [selectedSubject, selectedGrade, selectedCategory, search, applied, sortFields, favoritesOnly, missingOnly, page]);

  useEffect(() => {
    saveResourceKind(resourceKind);
  }, [resourceKind]);

  const subjectOptions = useMemo(() =>
    [...facets.subjects.map((s) => s.value)].filter(Boolean)
      .sort((a, b) => (SUBJECT_ORDER.indexOf(a) + 1 || 999) - (SUBJECT_ORDER.indexOf(b) + 1 || 999)),
    [facets.subjects]
  );
  const gradeOptions = useMemo(() =>
    [...facets.grades.map((g) => g.value)].filter(Boolean)
      .sort((a, b) => (GRADE_ORDER.indexOf(a) + 1 || 999) - (GRADE_ORDER.indexOf(b) + 1 || 999)),
    [facets.grades]
  );
  const categoryOptions = useMemo(() =>
    [...facets.categories.map((c) => c.value)].filter(Boolean).sort((a, b) => a.localeCompare(b)),
    [facets.categories]
  );

  const kindCounts = useMemo(() => {
    const all = Object.values(facets.kinds).reduce((s, n) => s + n, 0);
    return { all, searchable: facets.kinds.pdf ?? 0, scan: facets.kinds.scan ?? 0 };
  }, [facets.kinds]);

  const pendingSearch = (
    search !== applied.search ||
    selectedSubject !== applied.subject ||
    selectedGrade !== applied.grade ||
    selectedCategory !== applied.category
  );

  const applySearch = (overrides?: Partial<typeof applied>) => {
    setApplied({
      subject: selectedSubject,
      grade: selectedGrade,
      category: selectedCategory,
      search,
      ...overrides,
    });
    setPage(1);
    setPageInput('1');
  };

  const hasUnsavedChanges = draftEdits.size > 0 || pendingDeletes.size > 0;

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);

  const goPage = (p: number) => {
    const np = Math.max(1, Math.min(totalPages, p));
    setPage(np);
    setPageInput(String(np));
  };

  // 筛选 / 排序 / 每页条数变化后一律回到第 1 页，避免停在不存在的页码上。
  // 切 Tab 时页码由该 Tab 自己的记忆恢复，因此用 restoringKindRef 豁免一次。
  const prevFiltersRef = useRef('');
  const restoringKindRef = useRef(false);
  useEffect(() => {
    const sig = JSON.stringify([applied, sortString, pageSize, favoritesOnly, missingOnly, resourceKind]);
    if (prevFiltersRef.current && prevFiltersRef.current !== sig && !restoringKindRef.current) {
      goPage(1);
    }
    restoringKindRef.current = false;
    prevFiltersRef.current = sig;
  }, [applied, sortString, pageSize, favoritesOnly, missingOnly, resourceKind]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Edit mode helpers ----
  const updateDraft = (id: number, field: 'title' | 'category' | 'subject' | 'grade', value: string) => {
    setDraftEdits((prev) => {
      const book = items.find((b) => b.id === id);
      const base = prev.get(id) || {
        title: book?.title || '',
        category: book?.category || '',
        subject: book?.subject || '',
        grade: book?.grade || '',
      };
      const next = { ...base, [field]: value };
      if (
        next.title === (book?.title || '') &&
        next.category === (book?.category || '') &&
        next.subject === (book?.subject || '') &&
        next.grade === (book?.grade || '')
      ) {
        const n = new Map(prev);
        n.delete(id);
        return n;
      }
      return new Map(prev).set(id, next);
    });
  };

  const getDraft = (id: number) => {
    const book = items.find((b) => b.id === id);
    const draft = draftEdits.get(id);
    return {
      title: draft?.title ?? book?.title ?? '',
      category: draft?.category ?? book?.category ?? '',
      subject: draft?.subject ?? book?.subject ?? '',
      grade: draft?.grade ?? book?.grade ?? '',
    };
  };

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const selectAll = () => setSelectedIds(new Set(items.map((b) => b.id)));
  const deselectAll = () => setSelectedIds(new Set());
  const invertSelection = () => {
    setSelectedIds((prev) => {
      const all = new Set(items.map((b) => b.id));
      for (const id of prev) all.delete(id);
      return all;
    });
  };

  const toggleDelete = async (id: number) => {
    // 已标记删除的直接取消标记，不需要确认；新标记要二次确认（与 books 页一致）
    if (pendingDeletes.has(id)) {
      setPendingDeletes((prev) => {
        const n = new Set(prev);
        n.delete(id);
        return n;
      });
      return;
    }
    const book = items.find((b) => b.id === id);
    const ok = await confirm({
      title: '确认删除',
      message: `确定删除《${book?.title || '这本书'}》吗？`,
      confirmText: '删除',
      confirmClass: 'bg-red-500 hover:bg-red-600',
    });
    if (!ok) return;
    setPendingDeletes((prev) => {
      const n = new Set(prev);
      n.add(id);
      return n;
    });
  };

  const deleteSelected = async () => {
    if (selectedIds.size === 0) return;
    const ok = await confirm({
      title: '确认删除',
      message: `确定删除选中的 ${selectedIds.size} 本书吗？`,
      confirmText: '删除',
      confirmClass: 'bg-red-500 hover:bg-red-600',
    });
    if (!ok) return;
    setPendingDeletes((prev) => {
      const n = new Set(prev);
      selectedIds.forEach((id) => n.add(id));
      return n;
    });
  };

  const saveAll = async () => {
    setSaving(true);
    try {
      for (const id of pendingDeletes) {
        try { await deleteBook(id); } catch { /* 单本失败不影响其余 */ }
      }
      for (const [id, draft] of draftEdits) {
        const book = items.find((b) => b.id === id);
        if (!book) continue;
        const changed: Record<string, string> = {};
        if (draft.title !== book.title) changed.title = draft.title;
        if (draft.category !== book.category) changed.category = draft.category;
        if (draft.subject !== book.subject) changed.subject = draft.subject;
        if (draft.grade !== book.grade) changed.grade = draft.grade;
        if (Object.keys(changed).length > 0) {
          try { await updateBook(id, changed); } catch { /* ignore */ }
        }
      }
      toast.success('已保存');
    } catch (e: any) {
      toast.error('保存失败: ' + (e?.message || ''));
    } finally {
      setSaving(false);
      setDraftEdits(new Map());
      setPendingDeletes(new Set());
      setSelectedIds(new Set());
      setReloadTick((v) => v + 1);
    }
  };

  const discardAll = () => {
    setDraftEdits(new Map());
    setPendingDeletes(new Set());
    setSelectedIds(new Set());
  };

  const requestExitEdit = () => {
    if (hasUnsavedChanges) {
      promptActionRef.current = 'exit';
      setShowSavePrompt(true);
    } else {
      setEditMode(false);
      discardAll();
    }
  };

  const handlePromptSave = async () => {
    setShowSavePrompt(false);
    await saveAll();
    // 只有「退出编辑」才收起编辑态；切 Tab / 改筛选等动作执行完仍留在编辑模式
    if (promptActionRef.current === 'exit') setEditMode(false);
    const fn = pendingActionRef.current;
    pendingActionRef.current = null;
    fn?.();
  };

  const handlePromptDiscard = () => {
    setShowSavePrompt(false);
    discardAll();
    if (promptActionRef.current === 'exit') setEditMode(false);
    const fn = pendingActionRef.current;
    pendingActionRef.current = null;
    fn?.();
  };

  /**
   * 编辑模式下有未保存改动时拦截动作，用 ref 暂存，保存/放弃后再执行。
   * 两个变体：guardAction 给无参回调（按钮），guardValue 给带值回调（下拉）。
   * 旧实现把这个 pending 动作挂在 window 上，这里改用 ref，避免全局污染。
   */
  const guardAction = (fn: () => void): (() => void) => () => {
    if (editMode && hasUnsavedChanges) {
      pendingActionRef.current = fn;
      promptActionRef.current = 'action';
      setShowSavePrompt(true);
    } else {
      fn();
    }
  };

  const guardValue = <T,>(fn: (v: T) => void): ((v: T) => void) => (v: T) => {
    if (editMode && hasUnsavedChanges) {
      pendingActionRef.current = () => fn(v);
      promptActionRef.current = 'action';
      setShowSavePrompt(true);
    } else {
      fn(v);
    }
  };

  const safeSetSubject = guardValue<string>(setSelectedSubject);
  const safeSetGrade = guardValue<string>(setSelectedGrade);
  const safeSetCategory = guardValue<string>(setSelectedCategory);

  const applyKindState = (state: KindFilterState) => {
    setSelectedSubject(state.subject);
    setSelectedGrade(state.grade);
    setSelectedCategory(state.category);
    setSearch(state.search);
    setApplied({ ...state.applied });
    setSortFields(state.sortFields.length > 0 ? state.sortFields : defaultBookSort());
    setFavoritesOnly(state.favoritesOnly);
    setMissingOnly(state.missingOnly);
    setPage(state.page);
    setPageInput(String(state.page));
  };

  const safeSetResourceKind = (v: PdfResourceKind) => {
    if (v === resourceKind) return;
    const switchTo = () => {
      saveKindFilters(kindRef.current, {
        subject: selectedSubject,
        grade: selectedGrade,
        category: selectedCategory,
        search,
        applied,
        sortFields,
        favoritesOnly,
        missingOnly,
        page,
      });
      kindRef.current = v;
      restoringKindRef.current = true;
      setResourceKind(v);
      applyKindState(loadKindFilters(v));
    };
    guardAction(switchTo)();
  };

  const hasActiveFilters = !!(applied.search || applied.subject || applied.grade || applied.category || favoritesOnly || missingOnly);

  const resetFilters = guardAction(() => {
    setSelectedSubject('');
    setSelectedGrade('');
    setSelectedCategory('');
    setSearch('');
    setApplied({ subject: '', grade: '', category: '', search: '' });
    handleFavoritesOnlyChange(false);
    handleMissingOnlyChange(false);
  });

  const refreshBooks = () => setReloadTick((v) => v + 1);

  const handleFavoritesOnlyChange = (v: boolean) => {
    setFavoritesOnly(v);
    // 进入收藏视图默认按「添加收藏时间」倒序
    setSortFields(v ? defaultFavSort() : defaultBookSort());
  };

  const handleMissingOnlyChange = (v: boolean) => {
    setMissingOnly(v);
  };

  const handleToggleFavorite = async (bookId: number) => {
    // 乐观更新：先翻本地状态，失败再回滚
    setItems((prev) => prev.map((b) => (b.id === bookId ? { ...b, isFavorite: !b.isFavorite } : b)));
    try {
      const res = await toggleFavorite(bookId);
      setItems((prev) => prev.map((b) => (b.id === bookId ? { ...b, isFavorite: res.favorited, favoriteAt: res.favoriteAt ?? null } : b)));
      // 只看收藏视图下取消收藏的书要从列表里消失
      if (favoritesOnly && !res.favorited) {
        setItems((prev) => prev.filter((b) => b.id !== bookId));
      }
    } catch (e: any) {
      setItems((prev) => prev.map((b) => (b.id === bookId ? { ...b, isFavorite: !b.isFavorite } : b)));
      toast.error(e?.message || '收藏操作失败');
    }
  };

  const keywordSearchEl = (
    <div className="relative flex-1 min-w-[110px] max-w-[320px]">
      <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" size={13} />
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applySearch(); } }}
        placeholder="请输入关键字..."
        className="w-full rounded-lg border border-border bg-card py-1.5 pl-7 pr-3 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
      />
      {search && (
        <button
          type="button"
          onClick={() => { setSearch(''); applySearch({ search: '' }); }}
          className="absolute right-2 top-1/2 -translate-y-1/2 flex h-4 w-4 items-center justify-center rounded-full bg-muted-foreground/30 text-white hover:bg-muted-foreground/50"
          title="清除"
        >
          <X size={10} strokeWidth={3} />
        </button>
      )}
    </div>
  );

  const searchButtonEl = (
    <button
      type="button"
      onClick={() => applySearch()}
      className={`flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs transition ${
        pendingSearch
          ? 'border-primary bg-primary/5 text-primary font-medium hover:bg-primary/10'
          : 'border-border bg-card text-muted-foreground hover:border-primary hover:text-primary'
      }`}
      title={pendingSearch ? '有筛选条件未生效，点击查询' : '按当前条件查询'}
    >
      <Search size={13} />
      搜索
      {pendingSearch && <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-primary" />}
    </button>
  );

  const emptyHint = resourceKind === 'scan'
    ? '暂无扫描件'
    : resourceKind === 'searchable'
      ? '暂无可搜索的 PDF'
      : '暂无 PDF 书籍';

  return (
    <div className="h-full flex flex-col bg-surface">
      <header className="flex h-14 flex-shrink-0 items-center justify-between bg-sidebar px-6 text-sidebar-foreground">
        <div className="flex items-center gap-3">
          <Link to="/" className="flex items-center gap-2">
            <GraduationCap size={22} />
            <span className="text-lg font-normal">edu-workspace</span>
          </Link>
          <span className="mx-1 h-5 w-px bg-sidebar-border" />
          <PdfResourceKindMenu value={resourceKind} onChange={safeSetResourceKind} counts={kindCounts} />
        </div>
        <AppHeaderRight />
      </header>

      <main className={`flex-1 px-6 pt-4 pb-3 ${total === 0 && !loading ? 'overflow-hidden' : 'overflow-auto'}`}>
        {/* Row 1: filters + sort */}
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <ClearableSelect value={selectedSubject} onChange={safeSetSubject} placeholder="全部学科" options={subjectOptions} className="w-16 sm:w-20" />
          <ClearableSelect value={selectedGrade} onChange={safeSetGrade} placeholder="全部学期" options={gradeOptions} className="w-16 sm:w-20" />
          <ClearableSelect value={selectedCategory} onChange={safeSetCategory} placeholder="全部分类" options={categoryOptions} className="w-24 sm:w-36" />
          {keywordSearchEl}
          {searchButtonEl}
          <button
            type="button"
            onClick={hasActiveFilters ? resetFilters : refreshBooks}
            className={`flex items-center rounded-lg border px-2 py-1.5 text-xs transition ${
              hasActiveFilters
                ? 'border-primary bg-primary/5 text-primary hover:bg-primary/10'
                : 'border-border bg-card text-muted-foreground hover:border-primary hover:text-primary'
            }`}
            title={hasActiveFilters ? '重置所有筛选条件' : '刷新列表'}
          >
            {hasActiveFilters ? <RotateCcw size={13} /> : <RefreshCw size={13} />}
          </button>
          <button
            type="button"
            onClick={guardAction(() => handleFavoritesOnlyChange(!favoritesOnly))}
            className={`flex items-center gap-1 rounded-lg border px-2 py-1.5 text-xs transition ${
              favoritesOnly
                ? 'border-amber-400 bg-amber-50 text-amber-600 hover:bg-amber-100 dark:border-amber-400/50 dark:bg-amber-500/15 dark:text-amber-300 dark:hover:bg-amber-500/25'
                : 'border-border bg-card text-muted-foreground hover:border-amber-400 hover:text-amber-500'
            }`}
            title="只看收藏"
          >
            <Star size={13} className={favoritesOnly ? 'fill-amber-400 text-amber-400' : ''} />
            <span>只看收藏</span>
          </button>
          <button
            type="button"
            onClick={guardAction(() => handleMissingOnlyChange(!missingOnly))}
            className={`flex items-center gap-1 rounded-lg border px-2 py-1.5 text-xs transition ${
              missingOnly
                ? 'border-red-400 bg-red-50 text-red-600 hover:bg-red-100 dark:border-red-400/50 dark:bg-red-500/15 dark:text-red-300 dark:hover:bg-red-500/25'
                : 'border-border bg-card text-muted-foreground hover:border-red-400 hover:text-red-500'
            }`}
            title="只看文件缺失的书（换盘 / 硬盘未挂载时会缺）"
          >
            <FileWarning size={13} className={missingOnly ? 'text-red-500' : ''} />
            <span>只看缺失</span>
          </button>
          <div className="flex-1" />

          {/* Sort controls (draggable, 3-state toggle) */}
          {sortFields.map((s, idx) => {
            if (s.field === 'subject' || s.field === 'grade' || s.field === 'category') return null;
            const hasSort = s.dir !== null;
            const activeSorts = sortFields.filter((sf) => sf.dir !== null);
            const order = hasSort ? activeSorts.findIndex((sf) => sf.field === s.field) + 1 : 0;
            return (
              <div
                key={s.field}
                draggable
                onDragStart={() => onDragStart(idx)}
                onDragOver={(e) => onDragOver(e, idx)}
                onDragEnd={onDragEnd}
                onClick={() => toggleSortDir(s.field)}
                className={`flex items-center gap-1 rounded-lg border px-2 py-1.5 text-xs cursor-grab transition ${
                  hasSort
                    ? 'border-primary/40 bg-primary/5 text-primary'
                    : 'border-border bg-muted text-muted-foreground hover:border-border'
                } ${dragIndex === idx ? 'opacity-50' : ''}`}
                title={hasSort ? `当前：${s.dir === 'asc' ? '升序' : '降序'}，点击切换` : '点击启用排序'}
              >
                <GripVertical size={12} className="text-muted-foreground pointer-events-none" />
                <span className={`pointer-events-none ${hasSort ? 'font-medium' : ''}`}>{SORT_LABELS[s.field]}</span>
                <span className="ml-0.5 flex h-5 w-5 items-center justify-center pointer-events-none">
                  {s.dir === null ? <Minus size={12} /> : s.dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
                </span>
                {order > 1 && <span className="pointer-events-none text-[9px] opacity-60">{order}</span>}
              </div>
            );
          })}
          <button
            type="button"
            onClick={resetSort}
            className={`flex items-center rounded-lg border px-2 py-1.5 text-xs transition ${
              sortString
                ? 'border-primary bg-primary/5 text-primary hover:bg-primary/10'
                : 'border-border bg-card text-muted-foreground hover:border-primary hover:text-primary'
            }`}
            title="重置排序"
          >
            <RotateCcw size={13} />
          </button>
        </div>

        {loading ? (
          viewMode === 'preview' ? (
            <div className="relative flex flex-wrap gap-3">
              {Array.from({ length: pageSize }).map((_, i) => (
                <div key={i} className="bg-muted rounded-lg animate-pulse" style={{ aspectRatio: COVER_ASPECT, width: `calc((100% - ${(booksPerRow - 1) * 12}px) / ${booksPerRow})` }} />
              ))}
              <div className="absolute inset-0 flex items-center justify-center bg-card/50">
                <div className="h-8 w-8 rounded-full border-4 border-border border-t-primary animate-spin" />
              </div>
            </div>
          ) : (
            <div className="relative">
              <div className="overflow-hidden rounded-lg border border-border">
                <table className="w-full table-fixed text-sm">
                  <colgroup>
                    {editMode && <col style={{ width: '3%' }} />}
                    <col style={{ width: '5%' }} />
                    <col style={{ width: '42%' }} />
                    <col style={{ width: '12%' }} />
                    <col style={{ width: '12%' }} />
                    <col style={{ width: '15%' }} />
                    <col style={{ width: '8%' }} />
                    {editMode && <col style={{ width: '3%' }} />}
                  </colgroup>
                  <thead className="bg-muted text-xs text-muted-foreground">
                    <tr>
                      {editMode && <th className="px-2 py-2 text-left font-medium"></th>}
                      <th className="px-2 py-2 text-left font-medium">封面</th>
                      <th className="px-2 py-2 text-left font-medium">书名</th>
                      <th className="px-2 py-2 text-left font-medium">学科</th>
                      <th className="px-2 py-2 text-left font-medium">学期</th>
                      <th className="px-2 py-2 text-left font-medium">分类</th>
                      <th className="px-2 py-2 text-right font-medium">页数</th>
                      {editMode && <th className="px-2 py-2"></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: Math.min(pageSize, 12) }).map((_, i) => (
                      <tr key={i} className="border-t border-border">
                        {editMode && <td className="px-2 py-2"><div className="h-4 w-4 rounded bg-muted animate-pulse" /></td>}
                        <td className="px-2 py-2"><div className="h-10 rounded bg-muted animate-pulse" style={{ aspectRatio: COVER_ASPECT }} /></td>
                        <td className="px-2 py-2"><div className="h-4 w-40 rounded bg-muted animate-pulse" /></td>
                        <td className="px-2 py-2"><div className="h-4 w-12 rounded bg-muted animate-pulse" /></td>
                        <td className="px-2 py-2"><div className="h-4 w-12 rounded bg-muted animate-pulse" /></td>
                        <td className="px-2 py-2"><div className="h-4 w-16 rounded bg-muted animate-pulse" /></td>
                        <td className="px-2 py-2"><div className="ml-auto h-4 w-8 rounded bg-muted animate-pulse" /></td>
                        {editMode && <td className="px-2 py-2"><div className="ml-auto h-4 w-4 rounded bg-muted animate-pulse" /></td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="absolute inset-0 flex items-center justify-center bg-card/50">
                <div className="h-8 w-8 rounded-full border-4 border-border border-t-primary animate-spin" />
              </div>
            </div>
          )
        ) : total === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            {resourceKind === 'scan' ? <ScanLine size={48} className="mb-4" /> : <FileText size={48} className="mb-4" />}
            <p className="mb-2">{emptyHint}</p>
            <Link to="/admin" className="text-primary hover:underline">前往后台导入 PDF</Link>
          </div>
        ) : viewMode === 'preview' ? (
          <div className="flex flex-wrap gap-3">
            {items.map((book) => {
              const draft = getDraft(book.id);
              const isDeleted = pendingDeletes.has(book.id);
              const isSelected = selectedIds.has(book.id);
              return (
                <div
                  key={book.id}
                  className={`relative group bg-card rounded-lg shadow overflow-hidden transition ${
                    isDeleted ? 'opacity-40 ring-2 ring-red-400' : ''
                  } ${isSelected ? 'ring-2 ring-blue-500' : ''}`}
                  style={{ width: `calc((100% - ${(booksPerRow - 1) * 12}px) / ${booksPerRow})` }}
                >
                  {editMode && (
                    <label className="absolute left-1.5 top-1.5 z-20 flex h-5 w-5 items-center justify-center rounded bg-card/90 shadow">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(book.id)}
                        className="h-3.5 w-3.5 cursor-pointer accent-blue-600"
                      />
                    </label>
                  )}
                  {editMode && (
                    <button
                      onClick={() => toggleDelete(book.id)}
                      className={`absolute right-1.5 top-1.5 z-20 flex h-6 w-6 items-center justify-center rounded-full shadow transition ${
                        isDeleted ? 'bg-destructive text-destructive-foreground' : 'bg-card/90 text-muted-foreground hover:bg-red-500/10 hover:text-red-500'
                      }`}
                      title={isDeleted ? '取消删除' : '标记删除'}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}

                  {!editMode && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); handleToggleFavorite(book.id); }}
                      className={`absolute right-1.5 top-1.5 z-20 flex h-7 w-7 items-center justify-center rounded-full shadow-md transition ${
                        book.isFavorite
                          ? 'bg-amber-500 text-white opacity-100'
                          : 'bg-card/80 text-muted-foreground hover:bg-amber-50 hover:text-amber-500 dark:hover:bg-amber-500/15'
                      }`}
                      title={book.isFavorite ? '取消收藏' : '收藏'}
                    >
                      <Star size={14} className={book.isFavorite ? 'fill-white' : ''} />
                    </button>
                  )}

                  <div
                    className={`relative overflow-hidden cursor-pointer ${editMode ? '' : 'hover:shadow-md group'}`}
                    style={{ aspectRatio: COVER_ASPECT }}
                    onClick={() => { if (editMode) toggleSelect(book.id); else window.open(`/pdf/book/${book.id}`, '_blank'); }}
                  >
                    <PdfBookCover book={book} fit="contain" width={220} className={`w-full h-full ${editMode ? '' : 'transition group-hover:brightness-[1.04]'}`} />
                    {/* 左上角角标：可搜索性 + 文件缺失 */}
                    <div className="absolute top-0 left-0 z-10 flex flex-col items-start">
                      {book.missing && (
                        <div className="relative flex items-center gap-0.5 bg-red-600 text-white px-1.5 py-0.5 text-[10px] font-medium shadow-sm" title="PDF 原件缺失">
                          <FileWarning size={9} />
                          <span>缺文件</span>
                          <div className="absolute top-0 right-[-6px] h-0 w-0 border-t-[10px] border-t-red-600 border-r-[6px] border-r-transparent border-b-0" />
                        </div>
                      )}
                      {book.searchable !== 'ok' && (
                        <div
                          className="relative mt-0.5 flex items-center gap-0.5 bg-slate-600/90 text-white px-1.5 py-0.5 text-[10px] font-medium shadow-sm"
                          title={SEARCHABLE_LABEL[book.searchable] || book.searchable}
                        >
                          <AlertTriangle size={9} />
                          <span>不可搜</span>
                          <div className="absolute top-0 right-[-6px] h-0 w-0 border-t-[10px] border-t-gray-500/90 border-r-[6px] border-r-transparent border-b-0" />
                        </div>
                      )}
                    </div>
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/50 to-transparent pt-8 pb-2 px-2">
                      {editMode ? (
                        <>
                          <input
                            value={draft.title}
                            onChange={(e) => updateDraft(book.id, 'title', e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            className="w-full rounded bg-black/40 dark:bg-black/55 px-1 py-0.5 text-xs font-medium text-white placeholder-white/50 focus:outline-none focus:ring-1 focus:ring-white/60"
                            placeholder="标题"
                          />
                          <div className="mt-1 flex gap-1">
                            <select
                              value={draft.subject}
                              onChange={(e) => updateDraft(book.id, 'subject', e.target.value)}
                              onClick={(e) => e.stopPropagation()}
                              className="flex-1 min-w-0 rounded bg-black/50 dark:bg-black/60 px-1 py-0.5 text-[10px] text-white focus:outline-none focus:ring-1 focus:ring-white/60"
                            >
                              <option value="" className="text-foreground">&nbsp;</option>
                              {subjectOptions.map((s) => (
                                <option key={s} value={s} className="text-foreground">{s}</option>
                              ))}
                            </select>
                            <select
                              value={draft.grade}
                              onChange={(e) => updateDraft(book.id, 'grade', e.target.value)}
                              onClick={(e) => e.stopPropagation()}
                              className="flex-1 min-w-0 rounded bg-black/50 dark:bg-black/60 px-1 py-0.5 text-[10px] text-white focus:outline-none focus:ring-1 focus:ring-white/60"
                            >
                              <option value="" className="text-foreground">&nbsp;</option>
                              {gradeOptions.map((g) => (
                                <option key={g} value={g} className="text-foreground">{g}</option>
                              ))}
                            </select>
                            <select
                              value={draft.category}
                              onChange={(e) => updateDraft(book.id, 'category', e.target.value)}
                              onClick={(e) => e.stopPropagation()}
                              className="flex-1 min-w-0 rounded bg-black/50 dark:bg-black/60 px-1 py-0.5 text-[10px] text-white focus:outline-none focus:ring-1 focus:ring-white/60"
                            >
                              <option value="" className="text-foreground">&nbsp;</option>
                              {categoryOptions.map((c) => (
                                <option key={c} value={c} className="text-foreground">{c}</option>
                              ))}
                            </select>
                          </div>
                        </>
                      ) : (
                        <>
                          <h3 className="font-medium text-xs text-white line-clamp-2 leading-tight" title={book.title}>{book.title}</h3>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {book.subject && <span className="bg-emerald-500/90 text-white rounded px-1 py-0.5 text-[9px]">{book.subject}</span>}
                            {book.grade && <span className="bg-primary/80 text-white rounded px-1 py-0.5 text-[9px]">{book.grade}</span>}
                            {book.category && <span className="bg-violet-500/80 text-white rounded px-1 py-0.5 text-[9px]">{book.category}</span>}
                          </div>
                        </>
                      )}
                      <div className="mt-1 flex items-center justify-between gap-2">
                        <span />
                        <span className="whitespace-nowrap text-[10px] text-white/80">{book.totalPages} 页</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            {/* Placeholder cards to fill remaining grid slots */}
            {Array.from({ length: Math.max(0, pageSize - items.length) }).map((_, i) => (
              <div key={`ph-${i}`} className="rounded-lg border-2 border-dashed border-border bg-muted/50 flex items-center justify-center" style={{ width: `calc((100% - ${(booksPerRow - 1) * 12}px) / ${booksPerRow})`, aspectRatio: COVER_ASPECT }}>
                <FileText size={24} className="text-muted-foreground/40" />
              </div>
            ))}
          </div>
        ) : (
          /* List view */
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full table-fixed text-sm">
              <colgroup>
                {editMode && <col style={{ width: '3%' }} />}
                <col style={{ width: '5%' }} />
                <col style={{ width: '42%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '15%' }} />
                <col style={{ width: '8%' }} />
                {editMode && <col style={{ width: '3%' }} />}
              </colgroup>
              <thead className="bg-muted text-xs text-muted-foreground">
                <tr>
                  {editMode && <th className="px-2 py-2 text-left font-medium"></th>}
                  <th className="px-2 py-2 text-left font-medium">封面</th>
                  <th className="px-2 py-2 text-left font-medium">书名</th>
                  <th className="px-2 py-2 text-left font-medium">学科</th>
                  <th className="px-2 py-2 text-left font-medium">学期</th>
                  <th className="px-2 py-2 text-left font-medium">分类</th>
                  <th className="px-2 py-2 text-right font-medium">页数</th>
                  {editMode && <th className="px-2 py-2"></th>}
                </tr>
              </thead>
              <tbody>
                {items.map((book) => {
                  const draft = getDraft(book.id);
                  const isDeleted = pendingDeletes.has(book.id);
                  const isSelected = selectedIds.has(book.id);
                  return (
                    <tr
                      key={book.id}
                      className={`border-t border-border transition hover:bg-muted ${
                        isDeleted ? 'opacity-40' : ''
                      } ${isSelected ? 'bg-primary/10' : ''}`}
                      onClick={() => { if (editMode) toggleSelect(book.id); else window.open(`/pdf/book/${book.id}`, '_blank'); }}
                      style={{ cursor: 'pointer' }}
                    >
                      {editMode && (
                        <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelect(book.id)}
                            className="h-3.5 w-3.5 cursor-pointer accent-blue-600"
                          />
                        </td>
                      )}
                      <td className="px-2 py-2">
                        <div className="h-10 overflow-hidden rounded" style={{ aspectRatio: COVER_ASPECT }}>
                          <PdfBookCover book={book} fit="contain" width={120} className="h-full w-full" />
                        </div>
                      </td>
                      <td className="px-2 py-2 truncate">
                        {editMode ? (
                          <input
                            value={draft.title}
                            onChange={(e) => updateDraft(book.id, 'title', e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            className="w-full rounded border border-border px-1.5 py-0.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                            placeholder="书名"
                          />
                        ) : (
                          <div className="flex items-center gap-1.5 min-w-0">
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); handleToggleFavorite(book.id); }}
                              className={`flex-shrink-0 transition ${book.isFavorite ? 'text-amber-400' : 'text-muted-foreground hover:text-amber-400'}`}
                              title={book.isFavorite ? '取消收藏' : '收藏'}
                            >
                              <Star size={13} className={book.isFavorite ? 'fill-amber-400' : ''} />
                            </button>
                            <span className="block text-xs text-foreground truncate" title={book.title}>{book.title}</span>
                            {book.missing && (
                              <span className="flex-shrink-0 flex items-center gap-0.5 rounded bg-red-600 text-white px-1.5 py-0.5 text-[10px] font-medium" title="PDF 原件缺失">
                                <FileWarning size={9} /> 缺文件
                              </span>
                            )}
                            {book.searchable !== 'ok' && (
                              <span
                                className="flex-shrink-0 flex items-center gap-0.5 rounded bg-slate-600/90 text-white px-1.5 py-0.5 text-[10px] font-medium"
                                title={SEARCHABLE_LABEL[book.searchable] || book.searchable}
                              >
                                <AlertTriangle size={9} /> 不可搜
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-2">
                        {editMode ? (
                          <select
                            value={draft.subject}
                            onChange={(e) => updateDraft(book.id, 'subject', e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            className="w-full rounded border border-border px-1 py-0.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                          >
                            <option value="">&nbsp;</option>
                            {subjectOptions.map((s) => (<option key={s} value={s}>{s}</option>))}
                          </select>
                        ) : (
                          book.subject && <span className="rounded bg-emerald-100 px-1 py-0.5 text-[10px] text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">{book.subject}</span>
                        )}
                      </td>
                      <td className="px-2 py-2">
                        {editMode ? (
                          <select
                            value={draft.grade}
                            onChange={(e) => updateDraft(book.id, 'grade', e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            className="w-full rounded border border-border px-1 py-0.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                          >
                            <option value="">&nbsp;</option>
                            {gradeOptions.map((g) => (<option key={g} value={g}>{g}</option>))}
                          </select>
                        ) : (
                          book.grade && <span className="rounded bg-primary/10 px-1 py-0.5 text-[10px] text-primary">{book.grade}</span>
                        )}
                      </td>
                      <td className="px-2 py-2">
                        {editMode ? (
                          <select
                            value={draft.category}
                            onChange={(e) => updateDraft(book.id, 'category', e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            className="w-full rounded border border-border px-1 py-0.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                          >
                            <option value="">&nbsp;</option>
                            {categoryOptions.map((c) => (<option key={c} value={c}>{c}</option>))}
                          </select>
                        ) : (
                          book.category && <span className="rounded bg-violet-100 px-1 py-0.5 text-[10px] text-violet-700 dark:bg-violet-500/15 dark:text-violet-300">{book.category}</span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right text-xs text-muted-foreground">{book.totalPages}</td>
                      {editMode && (
                        <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => toggleDelete(book.id)}
                            className={`flex h-6 w-6 items-center justify-center rounded-full transition ${
                              isDeleted ? 'bg-destructive text-destructive-foreground' : 'text-muted-foreground hover:bg-red-500/10 hover:text-red-500'
                            }`}
                            title={isDeleted ? '取消删除' : '标记删除'}
                          >
                            <Trash2 size={13} />
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
                {Array.from({ length: Math.max(0, listPageSize - items.length) }).map((_, i) => (
                  <tr key={`ph-${i}`} className="border-t border-dashed border-border bg-muted/30" style={{ height: '56px' }}>
                    <td colSpan={editMode ? 8 : 6} className="text-center text-xs text-muted-foreground">— 空位 —</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pager */}
        {total > 0 && (
          <div className="mt-2 flex items-center gap-3">
            <div className="flex items-center justify-start gap-1.5 w-1/3">
              <div className="flex items-center rounded-md border border-border bg-card overflow-hidden">
                <button
                  onClick={() => switchViewMode('preview')}
                  className={`flex items-center px-1.5 py-1 text-xs transition ${
                    viewMode === 'preview' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
                  }`}
                  title="预览视图"
                >
                  <LayoutGrid size={13} />
                </button>
                <button
                  onClick={() => switchViewMode('list')}
                  className={`flex items-center px-1.5 py-1 text-xs transition ${
                    viewMode === 'list' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
                  }`}
                  title="列表视图"
                >
                  <List size={13} />
                </button>
              </div>
              {viewMode === 'preview' ? (
                <>
                  <label className="text-xs text-muted-foreground">每行</label>
                  <select
                    value={booksPerRow}
                    onChange={(e) => changeBooksPerRow(parseInt(e.target.value, 10))}
                    className="rounded-md border border-border bg-card px-1.5 py-1 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    title="每行显示几本书"
                  >
                    {Array.from({ length: 8 }, (_, i) => i + 3).map((n) => (<option key={n} value={n}>{n}</option>))}
                  </select>
                  <label className="text-xs text-muted-foreground">行数</label>
                  <select
                    value={rowsPerPage}
                    onChange={(e) => setRowsPerPage(parseInt(e.target.value, 10))}
                    className="rounded-md border border-border bg-card px-1.5 py-1 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    title="每页显示几行"
                  >
                    {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (<option key={n} value={n}>{n}</option>))}
                  </select>
                </>
              ) : (
                <>
                  <label className="text-xs text-muted-foreground">每页</label>
                  <select
                    value={listPageSize}
                    onChange={(e) => changeListPageSize(parseInt(e.target.value, 10))}
                    className="rounded-md border border-border bg-card px-1.5 py-1 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    title="每页显示几本"
                  >
                    {[10, 15, 20, 30, 50].map((n) => (<option key={n} value={n}>{n}</option>))}
                  </select>
                </>
              )}
              <span className="text-xs text-muted-foreground">({pageSize}本/页)</span>
            </div>
            <div className="flex items-center justify-center gap-1.5 w-1/3">
              <button onClick={() => goPage(1)} disabled={safePage <= 1} className="rounded-md border border-border bg-card px-2 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-40">第一页</button>
              <button onClick={() => goPage(safePage - 1)} disabled={safePage <= 1} className="rounded-md border border-border bg-card px-2 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-40"><ChevronLeft size={14} /></button>
              <input
                type="number"
                min={1}
                max={totalPages}
                value={pageInput}
                onChange={(e) => setPageInput(e.target.value)}
                onBlur={() => goPage(parseInt(pageInput, 10) || 1)}
                onKeyDown={(e) => { if (e.key === 'Enter') goPage(parseInt(pageInput, 10) || 1); }}
                className="w-14 rounded-md border border-border bg-card px-2 py-1 text-center text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <span className="text-xs text-muted-foreground">/ {totalPages}</span>
              <button onClick={() => goPage(safePage + 1)} disabled={safePage >= totalPages} className="rounded-md border border-border bg-card px-2 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-40"><ChevronRight size={14} /></button>
              <button onClick={() => goPage(totalPages)} disabled={safePage >= totalPages} className="rounded-md border border-border bg-card px-2 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-40">最后一页</button>
            </div>
            <div className="flex items-center justify-end gap-2 w-1/3">
              {editMode && (
                <>
                  <button onClick={selectAll} className="rounded-md border border-border bg-card px-2 py-1 text-xs text-muted-foreground hover:bg-muted">全选</button>
                  <button onClick={deselectAll} className="rounded-md border border-border bg-card px-2 py-1 text-xs text-muted-foreground hover:bg-muted">全不选</button>
                  <button onClick={invertSelection} className="rounded-md border border-border bg-card px-2 py-1 text-xs text-muted-foreground hover:bg-muted">反选</button>
                  <span className="text-xs text-muted-foreground">已选 {selectedIds.size}</span>
                  <button
                    onClick={deleteSelected}
                    disabled={selectedIds.size === 0}
                    className="rounded-md border border-red-300 bg-red-50 px-2 py-1 text-xs text-red-600 hover:bg-red-500/10 dark:border-red-500/40 dark:bg-red-500/15 dark:text-red-300 dark:hover:bg-red-500/25 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    删除选中
                  </button>
                </>
              )}
              <button
                onClick={editMode ? requestExitEdit : () => setEditMode(true)}
                className={`rounded-md border px-2 py-1 text-xs ${
                  editMode
                    ? 'border-green-300 bg-green-50 text-green-600 hover:bg-green-100 dark:border-green-500/40 dark:bg-green-500/15 dark:text-green-300 dark:hover:bg-green-500/25'
                    : 'border-border bg-card text-muted-foreground hover:bg-muted'
                }`}
              >
                {editMode ? '完成' : '编辑'}
              </button>
            </div>
          </div>
        )}
      </main>

      {showSavePrompt && (
        <SavePrompt onSave={handlePromptSave} onDiscard={handlePromptDiscard} onCancel={() => { setShowSavePrompt(false); pendingActionRef.current = null; }} />
      )}

      {saving && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/55">
          <div className="rounded-lg bg-card px-6 py-4 text-sm text-foreground shadow-xl">保存中...</div>
        </div>
      )}
    </div>
  );
}
