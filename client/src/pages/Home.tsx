import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { BookOpen, Settings, ChevronLeft, ChevronRight, X, Trash2, RotateCcw, RefreshCw, Search, ArrowUp, ArrowDown, Minus, GripVertical } from 'lucide-react';
import BookCover from '../components/BookCover';
import { updateBook, deleteBook } from '../api/client';

const PAGE_SIZE = 16; // legacy default, replaced by dynamic pageSize
const STORAGE_KEY = 'edu-home-filters';
const APP_ENV = import.meta.env.VITE_APP_ENV || (import.meta.env.DEV ? 'DEV' : 'TEST');
const APP_COMMIT = import.meta.env.VITE_APP_COMMIT || '';
const APP_ENV_CLASS = APP_ENV === 'PROD'
  ? 'bg-emerald-500/20 text-emerald-200'
  : APP_ENV === 'TEST'
    ? 'bg-amber-500/20 text-amber-200'
    : 'bg-blue-500/20 text-blue-200';

const SUBJECT_ORDER = ['语文', '数学', '英语', '物理', '化学', '生物', '政治', '历史', '地理', '科学', '道法'];
const GRADE_ORDER = ['七上', '七下', '八上', '八下', '九上', '九下'];

interface SavedFilters {
  subject: string;
  grade: string;
  category: string;
}

function loadSavedFilters(): SavedFilters {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as SavedFilters;
  } catch { /* ignore */ }
  return { subject: '', grade: '', category: '' };
}

function ClearableSelect({
  value,
  onChange,
  placeholder,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  options: string[] | { name: string; count?: number }[];
}) {
  const opts = options.map((o) =>
    typeof o === 'string' ? { name: o, count: undefined } : o
  );
  const totalCount = opts.reduce((sum, o) => sum + (o.count || 0), 0);
  return (
    <div className="relative w-36">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full appearance-none rounded-lg border border-gray-300 bg-white py-1.5 pl-2.5 pr-8 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary"
      >
        <option value="">{totalCount > 0 ? `${placeholder} (${totalCount})` : placeholder}</option>
        {opts.map((opt) => (
          <option key={opt.name} value={opt.name}>
            {opt.count !== undefined ? `${opt.name} (${opt.count})` : opt.name}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">▾</span>
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="absolute right-6 top-1/2 -translate-y-1/2 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-gray-300 text-white hover:bg-gray-400"
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="relative w-80 rounded-xl bg-white p-6 shadow-xl">
        <button
          onClick={onCancel}
          className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          title="取消"
        >
          <X size={16} />
        </button>
        <h3 className="text-base font-semibold text-gray-800">有未保存的修改</h3>
        <p className="mt-2 text-sm text-gray-500">是否保存当前编辑？</p>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onDiscard} className="rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100">不保存</button>
          <button onClick={onSave} className="rounded-lg bg-primary px-3 py-1.5 text-sm text-white hover:bg-primaryDark">保存</button>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const { books, total, subjectOptions: rawSubjectOptions, gradeOptions: rawGradeOptions, categoryOptions: rawCategoryOptions, fetchBooks, loading, booksPerRow, pageSize: storePageSize, setBooksPerRow } = useStore();

  const saved = useMemo(loadSavedFilters, []);
  const [selectedSubject, setSelectedSubject] = useState(saved.subject);
  const [selectedGrade, setSelectedGrade] = useState(saved.grade);
  const [selectedCategory, setSelectedCategory] = useState(saved.category);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  // Sort: array of { field, dir } where dir is 'asc' | 'desc' | null; order = priority
  const [sortFields, setSortFields] = useState<{ field: 'subject' | 'grade' | 'category' | 'title'; dir: 'asc' | 'desc' | null }[]>([
    { field: 'subject', dir: null },
    { field: 'grade', dir: null },
    { field: 'category', dir: null },
    { field: 'title', dir: null },
  ]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [page, setPage] = useState(1);

  // Build sort string from sortFields (only active ones, in order)
  const sortString = useMemo(() => {
    const active = sortFields.filter(s => s.dir !== null);
    if (active.length === 0) return undefined;
    return active.map(s => `${s.field}:${s.dir}`).join(',');
  }, [sortFields]);

  const toggleSortDir = (field: 'subject' | 'grade' | 'category' | 'title') => {
    setSortFields(prev => prev.map(s => {
      if (s.field === field) {
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

  const resetSort = () => setSortFields([
    { field: 'subject', dir: null },
    { field: 'grade', dir: null },
    { field: 'category', dir: null },
    { field: 'title', dir: null },
  ]);
  const [pageInput, setPageInput] = useState('1');
  const [rowsPerPage, setRowsPerPage] = useState(2);
  const pageSize = booksPerRow * rowsPerPage;

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

  // Debounce search input (only triggers if value actually changed)
  useEffect(() => {
    if (search === debouncedSearch) return;
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search, debouncedSearch]);

  // Server-side fetch: whenever page or filters change
  useEffect(() => {
    fetchBooks({
      category: selectedCategory || undefined,
      grade: selectedGrade || undefined,
      subject: selectedSubject || undefined,
      search: debouncedSearch || undefined,
      sort: sortString,
      page,
      pageSize: pageSize,
    });
  }, [page, selectedSubject, selectedGrade, selectedCategory, debouncedSearch, sortString, pageSize]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      subject: selectedSubject,
      grade: selectedGrade,
      category: selectedCategory,
    }));
  }, [selectedSubject, selectedGrade, selectedCategory]);

  const hasUnsavedChanges = draftEdits.size > 0 || pendingDeletes.size > 0;

  // Reset to page 1 when filters change
  useEffect(() => {
    setPage(1);
    setPageInput('1');
  }, [selectedSubject, selectedGrade, selectedCategory, debouncedSearch, sortString, pageSize]);

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
        category: selectedCategory || undefined,
        grade: selectedGrade || undefined,
        subject: selectedSubject || undefined,
        search: debouncedSearch || undefined,
        sort: sortString,
        page: safePage,
        pageSize: pageSize,
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

  const hasActiveFilters = !!(search || selectedSubject || selectedGrade || selectedCategory || sortString);

  const resetFilters = () => {
    const reset = () => {
      setSelectedSubject('');
      setSelectedGrade('');
      setSelectedCategory('');
      setSearch('');
      resetSort();
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
      category: selectedCategory || undefined,
      grade: selectedGrade || undefined,
      subject: selectedSubject || undefined,
      search: debouncedSearch || undefined,
      sort: sortString,
      page: safePage,
      pageSize: pageSize,
    });
  };

  const handlePromptSaveFilter = async () => {
    await handlePromptSave();
    applyPendingFilter();
  };

  const handlePromptDiscardFilter = () => {
    handlePromptDiscard();
    applyPendingFilter();
  };

  return (
    <div className="h-full flex flex-col bg-surface">
      <header className="bg-sidebar text-white px-6 py-4 flex items-center justify-between flex-shrink-0 h-14">
        <div className="flex items-center gap-3">
          <BookOpen size={22} />
          <h1 className="text-lg font-bold">edu-workspace</h1>
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide ${APP_ENV_CLASS}`}>
            {APP_ENV}
          </span>
          {APP_ENV === 'TEST' && APP_COMMIT && (
            <span className="font-mono text-[10px] text-gray-400" title={`构建版本 ${APP_COMMIT}`}>
              {APP_COMMIT}
            </span>
          )}
        </div>
        <Link to="/admin" target="_blank" rel="noopener noreferrer" title="后台管理" className="flex items-center justify-center bg-primary hover:bg-primaryDark h-9 w-9 rounded-lg transition">
          <Settings size={18} />
        </Link>
      </header>

      <main className={`flex-1 p-6 ${total === 0 && !loading ? 'overflow-hidden' : 'overflow-auto'}`}>
        {/* Row 1: filters + edit toggle */}
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <ClearableSelect value={selectedSubject} onChange={safeSetSubject} placeholder="全部学科" options={subjectOptions} />
          <ClearableSelect value={selectedGrade} onChange={safeSetGrade} placeholder="全部学期" options={gradeOptions} />
          <ClearableSelect value={selectedCategory} onChange={safeSetCategory} placeholder="全部分类" options={categoryOptions} />
          <div className="relative w-40">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" size={13} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onBlur={() => { if (search !== debouncedSearch) setDebouncedSearch(search); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (search !== debouncedSearch) setDebouncedSearch(search); } }}
              placeholder="关键字..."
              className="w-full rounded-lg border border-gray-300 bg-white py-1.5 pl-7 pr-3 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 flex h-4 w-4 items-center justify-center rounded-full bg-gray-300 text-white hover:bg-gray-400"
                title="清除"
              >
                <X size={10} strokeWidth={3} />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={hasActiveFilters ? resetFilters : refreshBooks}
            className={`flex items-center rounded-lg border px-2 py-1.5 text-xs transition ${
              hasActiveFilters
                ? 'border-primary bg-primary/5 text-primary hover:bg-primary/10'
                : 'border-gray-300 bg-white text-gray-600 hover:border-primary hover:text-primary'
            }`}
            title={hasActiveFilters ? '重置所有筛选条件' : '刷新列表'}
          >
            {hasActiveFilters ? <RotateCcw size={13} /> : <RefreshCw size={13} />}
          </button>
          <div className="flex-1" />

          {/* Sort controls (draggable, 3-state toggle) */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-gray-400">排序</span>
            {sortFields.map((s, idx) => {
            const labels: Record<string, string> = { subject: '学科', grade: '学期', category: '分类', title: '关键字' };
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
                    : 'border-gray-200 bg-gray-50 text-gray-400 hover:border-gray-300'
                } ${dragIndex === idx ? 'opacity-50' : ''}`}
                title={hasSort ? `当前：${s.dir === 'asc' ? '升序' : '降序'}，点击切换` : '点击启用排序'}
              >
                <GripVertical size={12} className="text-gray-300 pointer-events-none" />
                <span className={hasSort ? 'font-medium' : '' + ' pointer-events-none'}>{labels[s.field]}</span>
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
                ? 'border-primary/40 bg-primary/5 text-primary hover:bg-primary/10'
                : 'border-gray-200 bg-gray-50 text-gray-400 hover:border-gray-300'
            }`}
            title="重置排序"
          >
            <RotateCcw size={13} />
          </button>
          </div>
        </div>

        {loading ? (
          <div className="relative flex flex-wrap gap-3">
            {Array.from({ length: pageSize }).map((_, i) => (
              <div key={i} className="bg-gray-100 rounded-lg animate-pulse" style={{ aspectRatio: '3/4', width: `calc((100% - ${(booksPerRow - 1) * 12}px) / ${booksPerRow})` }} />
            ))}
            <div className="absolute inset-0 flex items-center justify-center bg-white/50">
              <div className="h-8 w-8 rounded-full border-4 border-gray-200 border-t-primary animate-spin" />
            </div>
          </div>
        ) : total === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400">
            <BookOpen size={48} className="mb-4" />
            <p className="mb-2">暂无书籍</p>
            <Link to="/admin" className="text-primary hover:underline">前往后台导入 PDF</Link>
          </div>
        ) : (
          <div className="flex flex-wrap gap-3">
            {pagedBooks.map((book) => {
              const draft = getDraft(book.id);
              const isDeleted = pendingDeletes.has(book.id);
              const isSelected = selectedIds.has(book.id);
              return (
                <div
                  key={book.id}
                  className={`relative bg-white rounded-lg shadow overflow-hidden transition ${
                    isDeleted ? 'opacity-40 ring-2 ring-red-400' : ''
                  } ${isSelected ? 'ring-2 ring-blue-500' : ''}`}
                  style={{ width: `calc((100% - ${(booksPerRow - 1) * 12}px) / ${booksPerRow})` }}
                >
                  {/* Checkbox (edit mode) */}
                  {editMode && (
                    <label className="absolute left-1.5 top-1.5 z-20 flex h-5 w-5 items-center justify-center rounded bg-white/90 shadow">
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
                        isDeleted ? 'bg-red-500 text-white' : 'bg-white/90 text-gray-500 hover:bg-red-100 hover:text-red-500'
                      }`}
                      title={isDeleted ? '取消删除' : '标记删除'}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}

                  <div
                    className={`relative overflow-hidden cursor-pointer ${editMode ? '' : 'hover:shadow-md group'}`}
                    style={{ aspectRatio: '3/4' }}
                    onClick={() => { if (editMode) toggleSelect(book.id); else window.open(`/book/${book.id}`, '_blank'); }}
                  >
                    <BookCover book={book} className={`w-full h-full object-cover ${editMode ? '' : 'transition group-hover:scale-[1.02]'}`} />
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/50 to-transparent pt-8 pb-2 px-2">
                      {editMode ? (
                        <>
                          <input
                            value={draft.title}
                            onChange={(e) => updateDraft(book.id, 'title', e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            className="w-full rounded bg-black/40 px-1 py-0.5 text-xs font-medium text-white placeholder-white/50 focus:outline-none focus:ring-1 focus:ring-white/60"
                            placeholder="标题"
                          />
                          <div className="mt-1 flex gap-1">
                            <select
                              value={draft.subject}
                              onChange={(e) => updateDraft(book.id, 'subject', e.target.value)}
                              onClick={(e) => e.stopPropagation()}
                              className="flex-1 min-w-0 rounded bg-black/50 px-1 py-0.5 text-[10px] text-white focus:outline-none focus:ring-1 focus:ring-white/60"
                            >
                              <option value="" className="text-gray-800">&nbsp;</option>
                              {subjectOptions.map((s) => (
                                <option key={s} value={s} className="text-gray-800">{s}</option>
                              ))}
                            </select>
                            <select
                              value={draft.grade}
                              onChange={(e) => updateDraft(book.id, 'grade', e.target.value)}
                              onClick={(e) => e.stopPropagation()}
                              className="flex-1 min-w-0 rounded bg-black/50 px-1 py-0.5 text-[10px] text-white focus:outline-none focus:ring-1 focus:ring-white/60"
                            >
                              <option value="" className="text-gray-800">&nbsp;</option>
                              {gradeOptions.map((g) => (
                                <option key={g} value={g} className="text-gray-800">{g}</option>
                              ))}
                            </select>
                            <select
                              value={draft.category}
                              onChange={(e) => updateDraft(book.id, 'category', e.target.value)}
                              onClick={(e) => e.stopPropagation()}
                              className="flex-1 min-w-0 rounded bg-black/50 px-1 py-0.5 text-[10px] text-white focus:outline-none focus:ring-1 focus:ring-white/60"
                            >
                              <option value="" className="text-gray-800">&nbsp;</option>
                              {categoryOptions.map((c) => (
                                <option key={c.name} value={c.name} className="text-gray-800">{c.name}</option>
                              ))}
                            </select>
                          </div>
                        </>
                      ) : (
                        <>
                          <h3 className="font-medium text-xs text-white line-clamp-2 leading-tight" title={book.title}>{book.title}</h3>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {book.subject && <span className="bg-emerald-500/90 text-white rounded px-1 py-0.5 text-[9px]">{book.subject}</span>}
                            {book.grade && <span className="bg-blue-500/80 text-white rounded px-1 py-0.5 text-[9px]">{book.grade}</span>}
                            {book.category && <span className="bg-violet-500/80 text-white rounded px-1 py-0.5 text-[9px]">{book.category}</span>}
                          </div>
                        </>
                      )}
                      <div className="mt-1 text-right">
                        <span className="text-[10px] text-white/80">{book.totalPages} 页</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Pager (below the list): select actions on left, pager on right */}
        {total > 0 && (
          <div className="mt-5 flex items-center gap-3">
            <button
              onClick={editMode ? requestExitEdit : () => setEditMode(true)}
              className={`rounded-md border px-2.5 py-1 text-xs ${
                editMode
                  ? 'border-green-300 bg-green-50 text-green-600 hover:bg-green-100'
                  : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              {editMode ? '完成编辑' : '启用编辑'}
            </button>
            {editMode && (
              <div className="flex items-center gap-2">
                <button onClick={selectAll} className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50">全选</button>
                <button onClick={deselectAll} className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50">全不选</button>
                <button onClick={invertSelection} className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50">反选</button>
                <span className="text-xs text-gray-400">已选 {selectedIds.size}</span>
                <button
                  onClick={deleteSelected}
                  disabled={selectedIds.size === 0}
                  className="rounded-md border border-red-300 bg-red-50 px-2.5 py-1 text-xs text-red-600 hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  删除选中
                </button>
              </div>
            )}
            <div className="flex-1" />
            <div className="flex items-center gap-1.5">
              <button onClick={() => goPage(1)} disabled={safePage <= 1} className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40">第一页</button>
              <button onClick={() => goPage(safePage - 1)} disabled={safePage <= 1} className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40"><ChevronLeft size={14} /></button>
              <input
                type="number"
                min={1}
                max={totalPages}
                value={pageInput}
                onChange={(e) => setPageInput(e.target.value)}
                onBlur={() => goPage(parseInt(pageInput, 10) || 1)}
                onKeyDown={(e) => { if (e.key === 'Enter') goPage(parseInt(pageInput, 10) || 1); }}
                className="w-14 rounded-md border border-gray-300 px-2 py-1 text-center text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <span className="text-xs text-gray-500">/ {totalPages}</span>
              <button onClick={() => goPage(safePage + 1)} disabled={safePage >= totalPages} className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40"><ChevronRight size={14} /></button>
              <button onClick={() => goPage(totalPages)} disabled={safePage >= totalPages} className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40">最后一页</button>
              <span className="text-xs text-gray-500 ml-2">共计 {total} 本</span>
              <span className="mx-1 text-gray-300">|</span>
              <label className="text-xs text-gray-500">每行</label>
              <select
                value={booksPerRow}
                onChange={(e) => setBooksPerRow(parseInt(e.target.value, 10))}
                className="rounded-md border border-gray-300 bg-white px-1.5 py-1 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary"
                title="每行显示几本书"
              >
                {Array.from({ length: 8 }, (_, i) => i + 3).map(n => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
              <label className="text-xs text-gray-500">行数</label>
              <select
                value={rowsPerPage}
                onChange={(e) => setRowsPerPage(parseInt(e.target.value, 10))}
                className="rounded-md border border-gray-300 bg-white px-1.5 py-1 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary"
                title="每页显示几行"
              >
                {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
              <span className="text-xs text-gray-400">({pageSize}本/页)</span>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="rounded-lg bg-white px-6 py-4 text-sm text-gray-700 shadow-xl">保存中...</div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="relative w-80 rounded-xl bg-white p-6 shadow-xl">
            <button
              onClick={() => setDeleteConfirm(null)}
              className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              title="取消"
            >
              <X size={16} />
            </button>
            <h3 className="text-base font-semibold text-gray-800">确认删除</h3>
            <p className="mt-2 text-sm text-gray-500">{deleteConfirm.message}</p>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={deleteConfirm.onConfirm} className="rounded-lg bg-red-500 px-3 py-1.5 text-sm text-white hover:bg-red-600">删除</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
