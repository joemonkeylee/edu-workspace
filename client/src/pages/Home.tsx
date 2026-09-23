import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useStore } from '../store/useStore';
import {
  loadKindFilters,
  saveKindFilters,
  loadResourceKind,
  saveResourceKind,
  defaultBookSort,
  defaultFavSort,
  type KindFilterState,
  type ResourceKind,
  type SortFieldDef,
  type SortFieldName,
} from '../store/homeFilters';
import { BookOpen, Settings, ChevronLeft, ChevronRight, X, Trash2, RotateCcw, RefreshCw, Search, ArrowUp, ArrowDown, Minus, GripVertical, LayoutGrid, List, Star, Check, Circle, CheckCircle2, Video, VideoOff, ListChecks, Languages } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import BookCover from '../components/BookCover';
import ResourceKindMenu from '../components/ResourceKindMenu';
import { ThemeSwitcher } from '@/components/ThemeSwitcher';
import { updateBook, deleteBook } from '../api/client';

const PAGE_SIZE = 16; // legacy default, replaced by dynamic pageSize
const STORAGE_KEY_VIEW = 'edu-home-view-mode';
const STORAGE_KEY_LIST_PS = 'edu-home-list-page-size';

/**
 * 封面容器宽高比。库里的封面是 PDF 第 1 页渲染出来的图片，97% 都是标准 A4 竖版
 * （2481×3508 ≈ 210:297）。容器按 A4 定比例、图片用 contain，封面就能整张显示；
 * 之前容器是 3:4（更宽），配合 object-cover 会把上下各裁掉约 3%，书名和页脚正好被切。
 */
const COVER_ASPECT = '210 / 297';

type ViewMode = 'preview' | 'list';

const SORT_LABELS: Record<SortFieldName, string> = {
  subject: '学科',
  grade: '学期',
  category: '分类',
  title: '关键字',
  totalPages: '页数',
  favoriteAt: '收藏时间',
};

function loadViewMode(): ViewMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_VIEW);
    if (raw === 'preview' || raw === 'list') return raw;
  } catch { /* ignore */ }
  return 'preview';
}

function loadListPageSize(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_LIST_PS);
    if (raw) return Math.max(10, Math.min(50, parseInt(raw, 10) || 20));
  } catch { /* ignore */ }
  return 20;
}
const APP_ENV = import.meta.env.VITE_APP_ENV || (import.meta.env.DEV ? 'DEV' : 'TEST');
const APP_COMMIT = import.meta.env.VITE_APP_COMMIT || '';
const APP_ENV_CLASS = APP_ENV === 'PROD'
  ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
  : APP_ENV === 'TEST'
    ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300'
    : 'bg-primary/15 text-primary dark:text-blue-300';

const SUBJECT_ORDER = ['语文', '数学', '英语', '物理', '化学', '生物', '政治', '历史', '地理', '科学', '道法'];
const GRADE_ORDER = ['七上', '七下', '八上', '八下', '九上', '九下'];

function ClearableSelect({
  value,
  onChange,
  placeholder,
  options,
  className = 'w-36',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  options: string[] | { name: string; count?: number }[];
  className?: string;
}) {
  const opts = options.map((o) =>
    typeof o === 'string' ? { name: o, count: undefined } : o
  );
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

/** Confirm modal for unsaved changes */
function SavePrompt({
  onSave,
  onDiscard,
  onCancel,
}: {
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

export default function Home() {
  const location = useLocation();
  const isBookActive = location.pathname.startsWith('/books');
  const isEnglishActive = location.pathname.startsWith('/english');
  const { books, total, subjectOptions: rawSubjectOptions, gradeOptions: rawGradeOptions, categoryOptions: rawCategoryOptions, kindCounts, fetchBooks, loading, booksPerRow, setBooksPerRow, toggleFavorite } = useStore();
  const [resourceKind, setResourceKind] = useState<ResourceKind>(loadResourceKind);
  // 三个 Tab 各有一套筛选/排序/关键字：初始值取自当前 Tab 的那一套
  const initial = useMemo(() => loadKindFilters(loadResourceKind()), []);
  // 当前这套状态归属哪个 Tab（写回 localStorage 时的 key）
  const kindRef = useRef<ResourceKind>(resourceKind);

  const [selectedSubject, setSelectedSubject] = useState(initial.subject);
  const [selectedGrade, setSelectedGrade] = useState(initial.grade);
  const [selectedCategory, setSelectedCategory] = useState(initial.category);
  const [search, setSearch] = useState(initial.search);
  // 已生效的筛选条件：下拉/输入只改「草稿」，点「搜索」或回车才同步到这里并发起请求，
  // 避免每改一次下拉或每敲一个字都打一次接口
  const [applied, setApplied] = useState({ ...initial.applied });
  const [favoritesOnly, setFavoritesOnly] = useState<boolean>(initial.favoritesOnly);
  const [pairsOnly, setPairsOnly] = useState<boolean>(initial.pairsOnly);
  // Sort: array of { field, dir } where dir is 'asc' | 'desc' | null; order = priority
  const [sortFields, setSortFields] = useState<SortFieldDef[]>(initial.sortFields);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [page, setPage] = useState(initial.page);

  // Build sort string from sortFields (only active ones, in order)
  const sortString = useMemo(() => {
    const active = sortFields.filter(s => s.dir !== null);
    if (active.length === 0) return undefined;
    return active.map(s => `${s.field}:${s.dir}`).join(',');
  }, [sortFields]);

  const toggleSortDir = (field: SortFieldName) => {
    setSortFields(prev => prev.map(s => {
      if (s.field === field) {
        // totalPages / favoriteAt 首次点击默认降序（页数多在前 / 最近收藏在前）
        if (field === 'totalPages' || field === 'favoriteAt') {
          const next = s.dir === null ? 'desc' : s.dir === 'desc' ? 'asc' : null;
          return { ...s, dir: next };
        }
        const next = s.dir === null ? 'asc' : s.dir === 'asc' ? 'desc' : null;
        return { ...s, dir: next };
      }
      return s;
    }));
  };

  const onDragStart = (idx: number) => setDragIndex(idx);
  const onDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === idx) return;
    setSortFields(prev => {
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
  const pageSize = viewMode === 'preview' ? booksPerRow * rowsPerPage : listPageSize;

  const switchViewMode = (mode: ViewMode) => {
    if (mode === viewMode) return;
    setViewMode(mode);
    try { localStorage.setItem(STORAGE_KEY_VIEW, mode); } catch { /* ignore */ }
    setPage(1);
    setPageInput('1');
  };

  const changeListPageSize = (n: number) => {
    const clamped = Math.max(10, Math.min(50, n));
    setListPageSize(clamped);
    try { localStorage.setItem(STORAGE_KEY_LIST_PS, String(clamped)); } catch { /* ignore */ }
    setPage(1);
    setPageInput('1');
  };

  // Edit mode state
  const [editMode, setEditMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [draftEdits, setDraftEdits] = useState<Map<number, { title: string; category: string; subject: string; grade: string }>>(new Map());
  const [pendingDeletes, setPendingDeletes] = useState<Set<number>>(new Set());
  const [showSavePrompt, setShowSavePrompt] = useState(false);
  const [promptAction, setPromptAction] = useState<null | 'exit' | 'filter'>(null);
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{ message: string; onConfirm: () => void } | null>(null);

  // Sort filter options from server
  const subjectOptions = useMemo(() =>
    [...rawSubjectOptions].sort((a, b) => (SUBJECT_ORDER.indexOf(a) + 1 || 999) - (SUBJECT_ORDER.indexOf(b) + 1 || 999)),
    [rawSubjectOptions]
  );
  const gradeOptions = useMemo(() =>
    [...rawGradeOptions].sort((a, b) => (GRADE_ORDER.indexOf(a) + 1 || 999) - (GRADE_ORDER.indexOf(b) + 1 || 999)),
    [rawGradeOptions]
  );
  const categoryOptions = useMemo(() => [...rawCategoryOptions].sort((a, b) => a.name.localeCompare(b.name)), [rawCategoryOptions]);

  // 草稿与已应用条件是否不一致（用来高亮「搜索」按钮，提示还有条件没生效）
  const pendingSearch = (
    search !== applied.search ||
    selectedSubject !== applied.subject ||
    selectedGrade !== applied.grade ||
    selectedCategory !== applied.category
  );

  /** 把当前草稿条件应用并查询（点「搜索」/ 回车 / 清空关键字时调用） */
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

  // 资源类型 Tab → 服务端 kind 参数：course = 视频课程、exercise = 必刷题，all 表示不过滤
  const kindParam: 'book' | 'course' | 'exercise' | undefined =
    resourceKind === 'all' ? undefined : resourceKind;

  // Server-side fetch: whenever page or applied filters change
  useEffect(() => {
    fetchBooks({
      category: applied.category || undefined,
      grade: applied.grade || undefined,
      subject: applied.subject || undefined,
      search: applied.search || undefined,
      sort: sortString,
      page,
      pageSize: pageSize,
      favoritesOnly,
      hasPairs: pairsOnly,
      kind: kindParam,
    });
  }, [page, applied, sortString, pageSize, favoritesOnly, pairsOnly, resourceKind]);

  // 把当前这套状态持续写回「当前 Tab」的槽位（切 Tab 时由 applyKindState 换槽）
  useEffect(() => {
    saveKindFilters(kindRef.current, {
      subject: selectedSubject,
      grade: selectedGrade,
      category: selectedCategory,
      search,
      applied,
      sortFields,
      favoritesOnly,
      pairsOnly,
      page,
    });
  }, [selectedSubject, selectedGrade, selectedCategory, search, applied, sortFields, favoritesOnly, pairsOnly, page]);

  useEffect(() => {
    saveResourceKind(resourceKind);
  }, [resourceKind]);

  const hasUnsavedChanges = draftEdits.size > 0 || pendingDeletes.size > 0;

  // 条件变化时回到第 1 页；但「切换 Tab 换槽」和「首次挂载」不算条件变化，
  // 否则会覆盖掉该 Tab 记忆的页码。
  // 这里比较「上一次的值」而不是用一个"已挂载"开关：StrictMode 下 effect 会双跑，
  // 开关式的守卫会在第二次跑时误判成"条件变了"。
  const restoringKindRef = useRef(false);
  const prevFiltersRef = useRef({ applied, sortString, pageSize, favoritesOnly });
  useEffect(() => {
    const prev = prevFiltersRef.current;
    const changed =
      prev.applied !== applied ||
      prev.sortString !== sortString ||
      prev.pageSize !== pageSize ||
      prev.favoritesOnly !== favoritesOnly;
    prevFiltersRef.current = { applied, sortString, pageSize, favoritesOnly };
    if (!changed) return;
    if (restoringKindRef.current) return;
    setPage(1);
    setPageInput('1');
  }, [applied, sortString, pageSize, favoritesOnly]);

  // 换槽标记只对紧随其后的那次判定有效（本次渲染结束后即清掉）
  useEffect(() => {
    restoringKindRef.current = false;
  });

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedBooks = books; // server already paginates

  const goPage = (p: number) => {
    const np = Math.max(1, Math.min(totalPages, p));
    setPage(np);
    setPageInput(String(np));
  };

  // ---- Edit mode helpers ----
  const updateDraft = (id: number, field: 'title' | 'category' | 'subject' | 'grade', value: string) => {
    setDraftEdits((prev) => {
      const book = books.find((b) => b.id === id);
      const base = prev.get(id) || {
        title: book?.title || '',
        category: book?.category || '',
        subject: book?.subject || '',
        grade: book?.grade || '',
      };
      const next = { ...base, [field]: value };
      // Remove draft if it matches original
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
    const book = books.find((b) => b.id === id);
    const draft = draftEdits.get(id);
    return {
      title: draft?.title ?? book?.title ?? '',
      category: draft?.category ?? book?.category ?? '',
      subject: draft?.subject ?? book?.subject ?? '',
      grade: draft?.grade ?? book?.grade ?? '',
    };
  };

  const toggleDelete = (id: number) => {
    // If already marked for deletion, unmark immediately (no confirm needed)
    if (pendingDeletes.has(id)) {
      setPendingDeletes((prev) => {
        const n = new Set(prev);
        n.delete(id);
        return n;
      });
      return;
    }
    const book = books.find((b) => b.id === id);
    setDeleteConfirm({
      message: `确定删除《${book?.title || '这本书'}》吗？`,
      onConfirm: () => {
        setPendingDeletes((prev) => {
          const n = new Set(prev);
          n.add(id);
          return n;
        });
        setDeleteConfirm(null);
      },
    });
  };

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const selectAll = () => setSelectedIds(new Set(books.map((b) => b.id)));
  const deselectAll = () => setSelectedIds(new Set());
  const invertSelection = () => {
    setSelectedIds((prev) => {
      const all = new Set(books.map((b) => b.id));
      for (const id of prev) all.delete(id);
      return all;
    });
  };

  // Delete selected (marks for pending delete) — with confirmation
  const deleteSelected = () => {
    if (selectedIds.size === 0) return;
    setDeleteConfirm({
      message: `确定删除选中的 ${selectedIds.size} 本书吗？`,
      onConfirm: () => {
        setPendingDeletes((prev) => {
          const n = new Set(prev);
          selectedIds.forEach((id) => n.add(id));
          return n;
        });
        setDeleteConfirm(null);
      },
    });
  };

  // ---- Save / discard ----
  const saveAll = async () => {
    setSaving(true);
    try {
      // Apply deletes
      for (const id of pendingDeletes) {
        try { await deleteBook(id); } catch { /* ignore per-book failures */ }
      }
      // Apply updates
      for (const [id, draft] of draftEdits) {
        const book = books.find((b) => b.id === id);
        if (!book) continue;
        const changed: any = {};
        if (draft.title !== book.title) changed.title = draft.title;
        if (draft.category !== book.category) changed.category = draft.category;
        if (draft.subject !== book.subject) changed.subject = draft.subject;
        if (draft.grade !== book.grade) changed.grade = draft.grade;
        if (Object.keys(changed).length > 0) {
          try { await updateBook(id, changed); } catch { /* ignore */ }
        }
      }
    } finally {
      setSaving(false);
      setDraftEdits(new Map());
      setPendingDeletes(new Set());
      setSelectedIds(new Set());
      await fetchBooks({
        category: applied.category || undefined,
        grade: applied.grade || undefined,
        subject: applied.subject || undefined,
        search: applied.search || undefined,
        sort: sortString,
        page: safePage,
        pageSize: pageSize,
        favoritesOnly,
      });
    }
  };

  const discardAll = () => {
    setDraftEdits(new Map());
    setPendingDeletes(new Set());
    setSelectedIds(new Set());
  };

  // ---- Enter / exit edit mode ----
  const requestExitEdit = () => {
    if (hasUnsavedChanges) {
      setPromptAction('exit');
      setShowSavePrompt(true);
    } else {
      setEditMode(false);
      discardAll();
    }
  };

  const handlePromptSave = async () => {
    setShowSavePrompt(false);
    await saveAll();
    if (promptAction === 'exit') setEditMode(false);
    setPromptAction(null);
  };

  const handlePromptDiscard = () => {
    setShowSavePrompt(false);
    discardAll();
    if (promptAction === 'exit') setEditMode(false);
    setPromptAction(null);
  };

  // ---- Filter change guard ----
  const handleFilterChange = (setter: (v: string) => void) => (v: string) => {
    if (editMode && hasUnsavedChanges) {
      setPromptAction('filter');
      setShowSavePrompt(true);
      // Store the pending filter action
      (window as any).__pendingFilter = { setter, value: v };
    } else {
      setter(v);
    }
  };

  const applyPendingFilter = () => {
    const pending = (window as any).__pendingFilter;
    if (pending) {
      pending.setter(pending.value);
      delete (window as any).__pendingFilter;
    }
  };

  // Override filter setters with guard
  const safeSetSubject = handleFilterChange(setSelectedSubject);
  const safeSetGrade = handleFilterChange(setSelectedGrade);
  const safeSetCategory = handleFilterChange(setSelectedCategory);

  /** 把某个 Tab 记忆的那套筛选/排序/关键字载入当前界面 */
  const applyKindState = (state: KindFilterState) => {
    restoringKindRef.current = true;
    setSelectedSubject(state.subject);
    setSelectedGrade(state.grade);
    setSelectedCategory(state.category);
    setSearch(state.search);
    setApplied({ ...state.applied });
    setSortFields(state.sortFields.length > 0 ? state.sortFields : defaultBookSort());
    setFavoritesOnly(state.favoritesOnly);
    setPairsOnly(state.pairsOnly);
    setPage(state.page);
    setPageInput(String(state.page));
  };

  // 切换资源类型同样要过未保存编辑守卫（泛型版在 .tsx 里会被当成 JSX，单独写一份）
  const safeSetResourceKind = (v: ResourceKind) => {
    if (v === resourceKind) return;
    const switchTo = () => {
      // 先把当前这套存回它所属的 Tab（写 effect 也会做，这里显式一次确保切走前已落盘）
      saveKindFilters(kindRef.current, {
        subject: selectedSubject,
        grade: selectedGrade,
        category: selectedCategory,
        search,
        applied,
        sortFields,
        favoritesOnly,
        pairsOnly,
        page,
      });
      kindRef.current = v;
      setResourceKind(v);
      applyKindState(loadKindFilters(v));
    };
    if (editMode && hasUnsavedChanges) {
      setPromptAction('filter');
      setShowSavePrompt(true);
      (window as any).__pendingFilter = { setter: switchTo, value: undefined };
    } else {
      switchTo();
    }
  };

  const hasActiveFilters = !!(applied.search || applied.subject || applied.grade || applied.category || favoritesOnly || pairsOnly);

  const resetFilters = () => {
    const reset = () => {
      setSelectedSubject('');
      setSelectedGrade('');
      setSelectedCategory('');
      setSearch('');
      setApplied({ subject: '', grade: '', category: '', search: '' });
      handleFavoritesOnlyChange(false);
      handlePairsOnlyChange(false);
    };
    if (editMode && hasUnsavedChanges) {
      setPromptAction('filter');
      setShowSavePrompt(true);
      (window as any).__pendingFilter = { setter: reset, value: undefined };
    } else {
      reset();
    }
  };

  const refreshBooks = () => {
    fetchBooks({
      category: applied.category || undefined,
      grade: applied.grade || undefined,
      subject: applied.subject || undefined,
      search: applied.search || undefined,
      sort: sortString,
      page: safePage,
      pageSize: pageSize,
      favoritesOnly,
      hasPairs: pairsOnly,
      kind: kindParam,
    });
  };

  const handleFavoritesOnlyChange = (v: boolean) => {
    setFavoritesOnly(v);
    // 进入收藏视图默认按「添加收藏时间」倒序；退出时恢复普通默认排序
    setSortFields(v ? defaultFavSort() : defaultBookSort());
  };
  const handlePairsOnlyChange = (v: boolean) => {
    setPairsOnly(v);
  };

  const handleToggleFavorite = async (bookId: number) => {
    try {
      await toggleFavorite(bookId);
    } catch (e: any) {
      toast.error(e?.message || '收藏操作失败');
    }
  };

  const handlePromptSaveFilter = async () => {
    await handlePromptSave();
    applyPendingFilter();
  };

  const handlePromptDiscardFilter = () => {
    handlePromptDiscard();
    applyPendingFilter();
  };

  // 关键字搜索框：固定放在筛选区前部（不随「只看收藏」改变位置，保持位置记忆一致）
  // 输入时不自动查询，回车或点旁边的「搜索」才生效
  const keywordSearchEl = (
    <div className="relative w-36">
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

  // 「搜索」按钮：下拉与关键字只改草稿，点这里（或回车）才真正查询；有条件未生效时高亮
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

  return (
    <div className="h-full flex flex-col bg-surface">
      <header className="bg-sidebar text-sidebar-foreground px-6 py-4 flex items-center justify-between flex-shrink-0 h-14">
        <div className="flex items-center gap-3">
          <BookOpen size={22} />
          <h1 className="text-lg font-bold">edu-workspace</h1>
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide ${APP_ENV_CLASS}`}>
            {APP_ENV}
          </span>
          {APP_ENV === 'TEST' && APP_COMMIT && (
            <span className="font-mono text-[10px] text-muted-foreground" title={`构建版本 ${APP_COMMIT}`}>
              {APP_COMMIT}
            </span>
          )}
          <span className="mx-1 h-5 w-px bg-sidebar-border" />
          <ResourceKindMenu value={resourceKind} onChange={safeSetResourceKind} counts={kindCounts} />
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <Link to="/books" className={cn('flex items-center gap-1.5 h-9 px-3 rounded-lg transition text-sm',
              isBookActive ? 'bg-primary text-primary-foreground' : 'bg-transparent text-muted-foreground hover:text-foreground hover:bg-muted')}>
              <BookOpen size={16} />
              <span className="hidden sm:inline">Book</span>
            </Link>
            <Link to="/english" className={cn('flex items-center gap-1.5 h-9 px-3 rounded-lg transition text-sm',
              isEnglishActive ? 'bg-primary text-primary-foreground' : 'bg-transparent text-muted-foreground hover:text-foreground hover:bg-muted')}>
              <Languages size={16} />
              <span className="hidden sm:inline">English</span>
            </Link>
          </div>
          <ThemeSwitcher />
          <Link to="/admin" target="_blank" rel="noopener noreferrer" title="后台管理" className="flex items-center justify-center bg-primary opacity-90 hover:opacity-100 h-9 w-9 rounded-lg transition">
            <Settings size={18} />
          </Link>
        </div>
      </header>

      <main className={`flex-1 px-6 pt-4 pb-3 ${total === 0 && !loading ? 'overflow-hidden' : 'overflow-auto'}`}>
        {/* Row 1: filters + sort + edit toggle */}
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          {/* <span className="text-xs text-muted-foreground mr-1">筛选</span> */}
          <ClearableSelect value={selectedSubject} onChange={safeSetSubject} placeholder="全部学科" options={subjectOptions} className="w-18" />
          <ClearableSelect value={selectedGrade} onChange={safeSetGrade} placeholder="全部学期" options={gradeOptions} className="w-18" />
          <ClearableSelect value={selectedCategory} onChange={safeSetCategory} placeholder="全部分类" options={categoryOptions} />
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
            onClick={() => {
              const next = !favoritesOnly;
              if (editMode && hasUnsavedChanges) {
                setPromptAction('filter');
                setShowSavePrompt(true);
                (window as any).__pendingFilter = { setter: handleFavoritesOnlyChange, value: next };
              } else {
                handleFavoritesOnlyChange(next);
              }
            }}
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
            onClick={() => {
              const next = !pairsOnly;
              if (editMode && hasUnsavedChanges) {
                setPromptAction('filter');
                setShowSavePrompt(true);
                (window as any).__pendingFilter = { setter: handlePairsOnlyChange, value: next };
              } else {
                handlePairsOnlyChange(next);
              }
            }}
            className={`flex items-center gap-1 rounded-lg border px-2 py-1.5 text-xs transition ${
              pairsOnly
                ? 'border-sky-400 bg-sky-50 text-sky-600 hover:bg-sky-100 dark:border-sky-400/50 dark:bg-sky-500/15 dark:text-sky-300 dark:hover:bg-sky-500/25'
                : 'border-border bg-card text-muted-foreground hover:border-sky-400 hover:text-sky-500'
            }`}
            title="只看有答案"
          >
            <Check size={13} className={pairsOnly ? 'text-sky-500' : ''} />
            <span>只看有答案</span>
          </button>
          <div className="flex-1" />

          {/* Sort controls (draggable, 3-state toggle) */}
          {/* <span className="text-xs text-muted-foreground mr-0.5">排序</span> */}
          {sortFields.map((s, idx) => {
            if (s.field === 'subject' || s.field === 'grade' || s.field === 'category') return null;
            const hasSort = s.dir !== null;
            const activeSorts = sortFields.filter(sf => sf.dir !== null);
            const order = hasSort ? activeSorts.findIndex(sf => sf.field === s.field) + 1 : 0;
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
                <span className={hasSort ? 'font-medium' : '' + ' pointer-events-none'}>{SORT_LABELS[s.field]}</span>
                <span className="ml-0.5 flex h-5 w-5 items-center justify-center pointer-events-none">
                  {s.dir === null ? (
                    <Minus size={12} />
                  ) : s.dir === 'asc' ? (
                    <ArrowUp size={12} />
                  ) : (
                    <ArrowDown size={12} />
                  )}
                </span>
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
                        {editMode && <td className="px-2 py-2"></td>}
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
            {resourceKind === 'course' ? (
              <Video size={48} className="mb-4" />
            ) : resourceKind === 'exercise' ? (
              <ListChecks size={48} className="mb-4" />
            ) : (
              <BookOpen size={48} className="mb-4" />
            )}
            <p className="mb-2">{resourceKind === 'course' ? '暂无视频课程' : resourceKind === 'exercise' ? '暂无必刷题' : '暂无书籍'}</p>
            <Link to="/admin" className="text-primary hover:underline">
              {resourceKind === 'course'
                ? '前往后台扫描并勾选「解析并关联 MP4」'
                : resourceKind === 'exercise'
                  ? '前往后台扫描必刷题 PDF（导入时选资源类型「必刷题」）'
                  : '前往后台导入 PDF'}
            </Link>
          </div>
        ) : viewMode === 'preview' ? (
          <div className="flex flex-wrap gap-3">
            {pagedBooks.map((book) => {
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
                  {/* Checkbox (edit mode) */}
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
                  {/* Delete toggle (edit mode) */}
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

                  {/* Favorite toggle (non-edit mode) */}
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
                    onClick={() => { if (editMode) toggleSelect(book.id); else window.open(`/book/${book.id}`, '_blank'); }}
                  >
                    {/* 封面：contain 保证整张可见；悬停用亮度反馈代替原来的放大（放大会把边缘再裁掉一点） */}
                    <BookCover book={book} fit="contain" className={`w-full h-full ${editMode ? '' : 'transition group-hover:brightness-[1.04]'}`} />
                    {/* 左上角角标：答案 + 讲解视频 */}
                    <div className="absolute top-0 left-0 z-10 flex flex-col items-start">
                      {book.pairSummary?.role === 'textbook' && book.pairSummary.partnerCount > 0 && (
                        <div className="relative flex items-center gap-0.5 bg-sky-500 text-white px-1.5 py-0.5 text-[10px] font-medium shadow-sm">
                          <span>✓</span>
                          <span>答案</span>
                          <span className="ml-0.5">{book.pairSummary.partnerCount}</span>
                          <div className="absolute top-0 right-[-6px] h-0 w-0 border-t-[10px] border-t-sky-500 border-r-[6px] border-r-transparent border-b-0" />
                        </div>
                      )}
                      {(book.videoCount || 0) > 0 ? (
                        <div
                          className="relative mt-0.5 flex items-center gap-0.5 bg-teal-600 text-white px-1.5 py-0.5 text-[10px] font-medium shadow-sm"
                          title={`${book.videoCount} 个讲解视频`}
                        >
                          <Video size={9} />
                          <span>讲解</span>
                          <span className="ml-0.5">{book.videoCount}</span>
                          <div className="absolute top-0 right-[-6px] h-0 w-0 border-t-[10px] border-t-teal-600 border-r-[6px] border-r-transparent border-b-0" />
                        </div>
                      ) : (
                        // 课程资源但没匹配到视频 —— 留在课程页，同时让「没讲解」一眼可见
                        book.kind === 'course' && (
                          <div
                            className="relative mt-0.5 flex items-center gap-0.5 bg-slate-600/90 text-white px-1.5 py-0.5 text-[10px] font-medium shadow-sm"
                            title="课程讲义，暂无配套讲解视频"
                          >
                            <VideoOff size={9} />
                            <span>无讲解</span>
                            <div className="absolute top-0 right-[-6px] h-0 w-0 border-t-[10px] border-t-gray-500/90 border-r-[6px] border-r-transparent border-b-0" />
                          </div>
                        )
                      )}
                    </div>
                    {/* 封面底部细进度条 */}
                    {book.videoProgress && book.videoProgress.total > 0 && (
                      <div className="absolute inset-x-0 bottom-0 z-20 h-[3px] bg-card/20">
                        <div
                          className="h-full bg-emerald-500 transition-all"
                          style={{ width: `${book.videoProgress.percent}%` }}
                        />
                      </div>
                    )}
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
                                <option key={c.name} value={c.name} className="text-foreground">{c.name}</option>
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
                        {book.videoProgress && book.videoProgress.total > 0 ? (
                          <span
                            className={`flex items-center gap-1 rounded px-1 py-0.5 text-[9px] font-medium text-white ${
                              book.videoProgress.done > 0 ? 'bg-emerald-500/90' : 'bg-slate-600/90'
                            }`}
                            title={`已完成 ${book.videoProgress.done}/${book.videoProgress.total} 讲 · 完成度 ${book.videoProgress.percent}%`}
                          >
                            {book.videoProgress.done > 0 ? <Check size={9} strokeWidth={3} /> : <Circle size={8} />}
                            已完成 {book.videoProgress.done}/{book.videoProgress.total}
                          </span>
                        ) : (
                          <span />
                        )}
                        <span className="whitespace-nowrap text-[10px] text-white/80">{book.totalPages} 页</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            {/* Placeholder cards to fill remaining grid slots */}
            {Array.from({ length: Math.max(0, pageSize - pagedBooks.length) }).map((_, i) => (
              <div key={`ph-${i}`} className="rounded-lg border-2 border-dashed border-border bg-muted/50 flex items-center justify-center" style={{ width: `calc((100% - ${(booksPerRow - 1) * 12}px) / ${booksPerRow})`, aspectRatio: COVER_ASPECT }}>
                <BookOpen size={24} className="text-muted-foreground/40" />
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
                {pagedBooks.map((book) => {
                  const draft = getDraft(book.id);
                  const isDeleted = pendingDeletes.has(book.id);
                  const isSelected = selectedIds.has(book.id);
                  return (
                    <tr
                      key={book.id}
                      className={`border-t border-border transition hover:bg-muted ${
                        isDeleted ? 'opacity-40' : ''
                      } ${isSelected ? 'bg-primary/10' : ''}`}
                      onClick={() => { if (editMode) toggleSelect(book.id); else window.open(`/book/${book.id}`, '_blank'); }}
                      style={{ cursor: editMode ? 'pointer' : 'pointer' }}
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
                          <BookCover book={book} fit="contain" className="h-full w-full" />
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
                            {book.pairSummary?.role === 'textbook' && book.pairSummary.partnerCount > 0 && (
                              <span
                                className="flex-shrink-0 rounded bg-sky-500 text-white px-1.5 py-0.5 text-[10px] font-medium"
                                title={`已绑定 ${book.pairSummary.partnerCount} 本答案`}
                              >
                                ✓ 答案 {book.pairSummary.partnerCount}
                              </span>
                            )}
                            {(book.videoCount || 0) > 0 ? (
                              <span
                                className="flex-shrink-0 flex items-center gap-0.5 rounded bg-teal-600 text-white px-1.5 py-0.5 text-[10px] font-medium"
                                title={`${book.videoCount} 个讲解视频`}
                              >
                                <Video size={9} />
                                讲解 {book.videoCount}
                              </span>
                            ) : (
                              book.kind === 'course' && (
                                <span
                                  className="flex-shrink-0 flex items-center gap-0.5 rounded bg-slate-600/90 text-white px-1.5 py-0.5 text-[10px] font-medium"
                                  title="课程讲义，暂无配套讲解视频"
                                >
                                  <VideoOff size={9} />
                                  无讲解
                                </span>
                              )
                            )}
                            {book.videoProgress && book.videoProgress.total > 0 && (
                              <span
                                className="flex-shrink-0 flex items-center gap-0.5 rounded bg-emerald-600 text-white px-1.5 py-0.5 text-[10px] font-medium"
                                title={`已完成 ${book.videoProgress.done}/${book.videoProgress.total} 讲 · 完成度 ${book.videoProgress.percent}%`}
                              >
                                <CheckCircle2 size={9} />
                                已完成 {book.videoProgress.done}/{book.videoProgress.total}
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
                            {subjectOptions.map((s) => (
                              <option key={s} value={s}>{s}</option>
                            ))}
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
                            {gradeOptions.map((g) => (
                              <option key={g} value={g}>{g}</option>
                            ))}
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
                            {categoryOptions.map((c) => (
                              <option key={c.name} value={c.name}>{c.name}</option>
                            ))}
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
                {/* Placeholder rows to fill remaining table height */}
                {Array.from({ length: Math.max(0, listPageSize - pagedBooks.length) }).map((_, i) => (
                  <tr key={`ph-${i}`} className="border-t border-dashed border-border bg-muted/30" style={{ height: '56px' }}>
                    <td colSpan={editMode ? 8 : 6} className="text-center text-xs text-muted-foreground">— 空位 —</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pager (below the list): select actions on left, pager on right */}
        {total > 0 && (
          <div className="mt-2 flex items-center gap-3">
            {/* Col 1: page size config + view toggle (left) */}
            <div className="flex items-center justify-start gap-1.5 w-1/3">
              {/* View toggle */}
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
                    onChange={(e) => setBooksPerRow(parseInt(e.target.value, 10))}
                    className="rounded-md border border-border bg-card px-1.5 py-1 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    title="每行显示几本书"
                  >
                    {Array.from({ length: 8 }, (_, i) => i + 3).map(n => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                  <label className="text-xs text-muted-foreground">行数</label>
                  <select
                    value={rowsPerPage}
                    onChange={(e) => setRowsPerPage(parseInt(e.target.value, 10))}
                    className="rounded-md border border-border bg-card px-1.5 py-1 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    title="每页显示几行"
                  >
                    {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
                      <option key={n} value={n}>{n}</option>
                    ))}
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
                    {[10, 15, 20, 30, 50].map(n => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </>
              )}
              <span className="text-xs text-muted-foreground">({pageSize}本/页)</span>
            </div>
            {/* Col 2: pager (center) */}
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
              {/* <span className="text-xs text-muted-foreground">共计 {total} 本</span> */}
            </div>
            {/* Col 3: edit toggle + edit actions (right) */}
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

      {/* Save prompt modal */}
      {showSavePrompt && (
        <SavePrompt
          onSave={promptAction === 'filter' ? handlePromptSaveFilter : handlePromptSave}
          onDiscard={promptAction === 'filter' ? handlePromptDiscardFilter : handlePromptDiscard}
          onCancel={() => { setShowSavePrompt(false); setPromptAction(null); delete (window as any).__pendingFilter; }}
        />
      )}

      {/* Saving overlay */}
      {saving && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/55">
          <div className="rounded-lg bg-card px-6 py-4 text-sm text-foreground shadow-xl">保存中...</div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 dark:bg-black/60">
          <div className="relative w-80 rounded-xl bg-card p-6 shadow-xl">
            <button
              onClick={() => setDeleteConfirm(null)}
              className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-muted-foreground"
              title="取消"
            >
              <X size={16} />
            </button>
            <h3 className="text-base font-semibold text-foreground">确认删除</h3>
            <p className="mt-2 text-sm text-muted-foreground">{deleteConfirm.message}</p>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={deleteConfirm.onConfirm} className="rounded-lg bg-red-500 px-3 py-1.5 text-sm text-white hover:bg-red-600">删除</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
