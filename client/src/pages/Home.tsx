import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { BookOpen, Settings, ChevronLeft, ChevronRight, X, Edit3, Trash2, Check } from 'lucide-react';
import BookCover from '../components/BookCover';
import { updateBook, deleteBook } from '../api/client';

const PAGE_SIZE = 16; // 2 rows × 8 cols
const STORAGE_KEY = 'edu-home-filters';

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
  options: string[];
}) {
  return (
    <div className="relative w-44">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full appearance-none rounded-lg border border-gray-300 bg-white py-2 pl-3 pr-9 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary"
      >
        <option value="">{placeholder}</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400">▾</span>
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="absolute right-7 top-1/2 -translate-y-1/2 flex h-4 w-4 items-center justify-center rounded-full bg-gray-300 text-white hover:bg-gray-400"
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
  const { books, fetchBooks, loading } = useStore();

  const saved = useMemo(loadSavedFilters, []);
  const [selectedSubject, setSelectedSubject] = useState(saved.subject);
  const [selectedGrade, setSelectedGrade] = useState(saved.grade);
  const [selectedCategory, setSelectedCategory] = useState(saved.category);
  const [page, setPage] = useState(1);
  const [pageInput, setPageInput] = useState('1');

  // Edit mode state
  const [editMode, setEditMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [draftEdits, setDraftEdits] = useState<Map<number, { title: string; category: string; subject: string; grade: string }>>(new Map());
  const [pendingDeletes, setPendingDeletes] = useState<Set<number>>(new Set());
  const [showSavePrompt, setShowSavePrompt] = useState(false);
  const [promptAction, setPromptAction] = useState<null | 'exit' | 'filter'>(null);
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{ message: string; onConfirm: () => void } | null>(null);

  useEffect(() => {
    fetchBooks();
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      subject: selectedSubject,
      grade: selectedGrade,
      category: selectedCategory,
    }));
  }, [selectedSubject, selectedGrade, selectedCategory]);

  const subjectOptions = useMemo(() => {
    const values = new Set((books || []).map((b) => (b.subject || '').trim()).filter(Boolean));
    return Array.from(values).sort((a, b) => (SUBJECT_ORDER.indexOf(a) + 1 || 999) - (SUBJECT_ORDER.indexOf(b) + 1 || 999));
  }, [books]);

  const gradeOptions = useMemo(() => {
    const values = new Set((books || []).map((b) => (b.grade || '').trim()).filter(Boolean));
    return Array.from(values).sort((a, b) => (GRADE_ORDER.indexOf(a) + 1 || 999) - (GRADE_ORDER.indexOf(b) + 1 || 999));
  }, [books]);

  const categoryOptions = useMemo(() => {
    const values = new Set((books || []).map((b) => (b.category || '').trim()).filter(Boolean));
    return Array.from(values).sort();
  }, [books]);

  const filteredBooks = useMemo(() => {
    return (books || []).filter((book) => {
      if (selectedSubject && (book.subject || '') !== selectedSubject) return false;
      if (selectedGrade && (book.grade || '') !== selectedGrade) return false;
      if (selectedCategory && (book.category || '') !== selectedCategory) return false;
      return true;
    });
  }, [books, selectedSubject, selectedGrade, selectedCategory]);

  const hasUnsavedChanges = draftEdits.size > 0 || pendingDeletes.size > 0;

  useEffect(() => {
    setPage(1);
    setPageInput('1');
  }, [selectedSubject, selectedGrade, selectedCategory]);

  const totalPages = Math.max(1, Math.ceil(filteredBooks.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedBooks = useMemo(
    () => filteredBooks.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filteredBooks, safePage]
  );

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

  const selectAll = () => setSelectedIds(new Set(filteredBooks.map((b) => b.id)));
  const deselectAll = () => setSelectedIds(new Set());
  const invertSelection = () => {
    setSelectedIds((prev) => {
      const all = new Set(filteredBooks.map((b) => b.id));
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
      await fetchBooks();
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
        </div>
        <Link to="/admin" title="后台管理" className="flex items-center justify-center bg-primary hover:bg-primaryDark h-9 w-9 rounded-lg transition">
          <Settings size={18} />
        </Link>
      </header>

      <main className="flex-1 overflow-auto p-6">
        {/* Row 1: filters + edit toggle */}
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <ClearableSelect value={selectedSubject} onChange={safeSetSubject} placeholder="全部学科" options={subjectOptions} />
          <ClearableSelect value={selectedGrade} onChange={safeSetGrade} placeholder="全部学期" options={gradeOptions} />
          <ClearableSelect value={selectedCategory} onChange={safeSetCategory} placeholder="全部分类" options={categoryOptions} />
          <div className="flex-1" />
          {editMode && (
            <button
              onClick={deleteSelected}
              disabled={selectedIds.size === 0}
              className="flex items-center gap-1 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-600 hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Trash2 size={15} /> 删除选中
            </button>
          )}
          <button
            onClick={editMode ? requestExitEdit : () => setEditMode(true)}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
              editMode
                ? 'bg-green-600 text-white hover:bg-green-700'
                : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            {editMode ? <><Check size={16} /> 完成编辑</> : <><Edit3 size={16} /> 启用编辑</>}
          </button>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center h-full">
            <div className="h-8 w-8 rounded-full border-4 border-gray-200 border-t-primary animate-spin" />
          </div>
        ) : filteredBooks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400">
            <BookOpen size={48} className="mb-4" />
            <p className="mb-2">暂无书籍</p>
            <Link to="/admin" className="text-primary hover:underline">前往后台导入 PDF</Link>
          </div>
        ) : (
          <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-8 gap-3">
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
                    className={`relative overflow-hidden ${editMode ? '' : 'cursor-pointer hover:shadow-md group'}`}
                    style={{ aspectRatio: '3/4' }}
                    onClick={() => { if (!editMode) window.open(`/book/${book.id}`, '_blank'); }}
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
                                <option key={c} value={c} className="text-gray-800">{c}</option>
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
        {!loading && filteredBooks.length > 0 && (
          <div className="mt-5 flex items-center gap-3">
            {editMode && (
              <div className="flex items-center gap-2">
                <button onClick={selectAll} className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50">全选</button>
                <button onClick={deselectAll} className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50">全部不选</button>
                <button onClick={invertSelection} className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50">反选</button>
                <span className="text-xs text-gray-400">已选 {selectedIds.size}</span>
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
              <span className="text-xs text-gray-500 ml-2">共计 {filteredBooks.length} 本</span>
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
