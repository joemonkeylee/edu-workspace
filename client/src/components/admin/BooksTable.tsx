import { useState, useEffect, useCallback } from 'react';
import type { TocNode } from '../../types';
import { adminGetBooks, adminGetBatches, adminUpdateBook, adminSoftDeleteBook, adminSoftDeleteBooksBatch, adminClearBooks } from '../../api/client';
import { Search, Edit3, Trash2, Check, X, ChevronLeft, ChevronRight, BookOpen, GripVertical, Save, RotateCcw, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import BookCover from '../BookCover';
import { useAuthStore } from '../../store/authStore';
import { Button } from '@/components/ui/button';

const PAGE_SIZE = 10;

const GRADE_PRESETS = ['7上', '7下', '8上', '8下', '9上', '9下', '高一', '高二', '高三', '小学', '初一', '初二', '初三'];
const SUBJECT_PRESETS = ['语文', '数学', '英语', '物理', '化学', '生物', '政治', '历史', '地理', '科学'];

type TocPath = number[];
type PreviewState = { bookId: number; page: number } | null;

function normalizeAttributes(value: any): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).map(([key, val]) => [key, String(val ?? '')])
  );
}

function getCategoryPresetFields(category: string) {
  const normalized = (category || '').trim();
  if (normalized === '学习') return ['grade', 'subject'];
  return [];
}

function getPathString(path: TocPath) {
  return path.join('.');
}

function getArrayAtPath(nodes: TocNode[], path: TocPath): TocNode[] {
  if (path.length === 0) return nodes;

  let current = nodes;
  for (let i = 0; i < path.length - 1; i += 1) {
    const idx = path[i];
    const node = current[idx];
    if (!node || !node.children) return [];
    current = node.children;
  }

  return current;
}

function updateTocNodeAtPath(nodes: TocNode[], path: TocPath, updater: (node: TocNode) => TocNode): TocNode[] {
  if (path.length === 0) {
    return nodes.map((node) => updater(node));
  }

  const next = JSON.parse(JSON.stringify(nodes)) as TocNode[];
  const parentPath = path.slice(0, -1);
  const parent = getArrayAtPath(next, parentPath);
  const idx = path[path.length - 1];
  const node = parent[idx];
  if (!node) return nodes;

  parent[idx] = updater(node);
  return next;
}

function moveTocNode(nodes: TocNode[], sourcePath: TocPath, targetPath: TocPath): TocNode[] {
  if (sourcePath.length === 0 || targetPath.length === 0 || sourcePath.join('.') === targetPath.join('.')) return nodes;

  const next = JSON.parse(JSON.stringify(nodes)) as TocNode[];
  const sourceParentPath = sourcePath.slice(0, -1);
  const targetParentPath = targetPath.slice(0, -1);
  const sourceParent = getArrayAtPath(next, sourceParentPath);
  const targetParent = getArrayAtPath(next, targetParentPath);
  if (!sourceParent || !targetParent) return nodes;

  const sourceIndex = sourcePath[sourcePath.length - 1];
  const targetIndex = targetPath[targetPath.length - 1];
  const sameParent = sourceParentPath.join('.') === targetParentPath.join('.');
  const [node] = sourceParent.splice(sourceIndex, 1);

  if (!node) return nodes;

  const adjustedTargetIndex = sameParent && sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
  targetParent.splice(Math.max(0, adjustedTargetIndex), 0, node);

  return next;
}

function isDescendantPath(sourcePath: TocPath, targetPath: TocPath) {
  if (sourcePath.length >= targetPath.length) return false;
  return sourcePath.every((value, index) => value === targetPath[index]);
}

function getPageImageUrl(book: any, pageNumber: number) {
  const storageBase = (book?.storagePath || '').replace(/\/+$/, '');
  const bestDpi = Array.isArray(book?.availableDpis) && book.availableDpis.length > 0 ? Number(book.availableDpis[0]) : 0;
  const dir = bestDpi > 0 ? `${storageBase}/${bestDpi}/` : `${storageBase}/`;
  const page = String(pageNumber).padStart(4, '0');
  return `${dir}page-${page}.png`;
}

export default function BooksTable() {
  const { user, authEnabled } = useAuthStore();
  const isAdmin = !authEnabled || user?.isAdmin || user?.role === 'admin';
  const [books, setBooks] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [batchFilter, setBatchFilter] = useState('');
  const [batches, setBatches] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editGrade, setEditGrade] = useState('');
  const [editSubject, setEditSubject] = useState('');
  const [editCoverPage, setEditCoverPage] = useState<number>(1);
  const [tocBookId, setTocBookId] = useState<number | null>(null);
  const [tocDraft, setTocDraft] = useState<TocNode[]>([]);
  const [draggedPath, setDraggedPath] = useState<string | null>(null);
  const [dropPath, setDropPath] = useState<string | null>(null);
  const [tocSaving, setTocSaving] = useState(false);
  const [previewPage, setPreviewPage] = useState<PreviewState>(null);
  const [editAttributes, setEditAttributes] = useState<Record<string, string>>({});
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState<{ current: number; total: number; title: string } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = { page, pageSize: PAGE_SIZE, search };
      if (batchFilter) params.batchId = batchFilter;
      const res = await adminGetBooks(params);
      setBooks(res.data);
      setTotal(res.total);
    } finally { setLoading(false); }
  }, [page, search, batchFilter]);

  useEffect(() => { fetch(); }, [fetch]);
  useEffect(() => { adminGetBatches().then(setBatches).catch(() => {}); }, []);

  const handleSearch = () => { setPage(1); fetch(); };
  const totalPages = Math.ceil(total / PAGE_SIZE) || 1;

  const startEdit = (book: any) => {
    setEditingId(book.id);
    setEditTitle(book.title);
    setEditCategory(book.category || '学习');
    setEditGrade(book.grade || '');
    setEditSubject(book.subject || '');
    setEditCoverPage(Number(book.coverPage) || 1);
    setEditAttributes(normalizeAttributes(book.attributes));
  };
  const cancelEdit = () => setEditingId(null);

  const saveEdit = async (id: number) => {
    const nextAttributes = { ...editAttributes };
    if ((editCategory || '学习') === '学习') {
      if (editGrade) nextAttributes.grade = editGrade;
      if (editSubject) nextAttributes.subject = editSubject;
      delete nextAttributes.grade;
      delete nextAttributes.subject;
    }

    await adminUpdateBook(id, {
      title: editTitle,
      category: editCategory,
      grade: editGrade,
      subject: editSubject,
      coverPage: editCoverPage,
      attributes: nextAttributes,
    });
    setEditingId(null);
    fetch();
  };

  const handleDelete = (id: number, title: string) => {
    setDeleteConfirm({
      title: '软删除确认',
      message: `将「${title}」移到「已删除」？资源文件搬至 books-deleted，可随时恢复。`,
      onConfirm: async () => {
        setDeleteConfirm(null);
        await adminSoftDeleteBook(id);
        toast.success(`已软删除「${title}」`);
        setSelectedIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        fetch();
      },
    });
  };

  const pageIds = books.map((b) => b.id);
  const allSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
  const someSelected = pageIds.some((id) => selectedIds.has(id));

  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        pageIds.forEach((id) => next.delete(id));
      } else {
        pageIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const toggleSelectOne = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBatchDelete = () => {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    setDeleteConfirm({
      title: '批量软删除确认',
      message: `将选中的 ${count} 本书移到「已删除」？资源文件搬至 books-deleted，可随时恢复。`,
      onConfirm: async () => {
        setDeleteConfirm(null);
        const ids = Array.from(selectedIds);
        setDeleting(true);
        setDeleteProgress({ current: 0, total: ids.length, title: '' });
        try {
          setDeleteProgress({ current: 0, total: ids.length, title: `批量软删除 ${ids.length} 本` });
          const res = await adminSoftDeleteBooksBatch(ids);
          setDeleteProgress({ current: res.deleted, total: ids.length, title: '完成' });
          toast.success(`已软删除 ${res.deleted} 本（${res.skipped} 本跳过）`);
          await new Promise((r) => setTimeout(r, 300));
          setSelectedIds(new Set());
          fetch();
        } catch (e: any) {
          toast.error('批量软删除失败: ' + (e?.message || ''));
        } finally {
          setDeleting(false);
          setDeleteProgress(null);
        }
      },
    });
  };

  const handleClearAll = () => {
    if (total === 0) return;
    setDeleteConfirm({
      title: '⚠️ 清空全部书籍',
      message: `确定清空全部 ${total} 本书？所有数据将被删除，无法恢复！`,
      onConfirm: async () => {
        setDeleteConfirm(null);
        setDeleting(true);
        try {
          await adminClearBooks((progress) => {
            setDeleteProgress(progress);
          });
          setSelectedIds(new Set());
          fetch();
        } finally {
          setDeleting(false);
          setDeleteProgress(null);
        }
      },
    });
  };

  const openTocEditor = (book: any) => {
    setTocBookId(book.id);
    setTocDraft(Array.isArray(book.tocJson) ? JSON.parse(JSON.stringify(book.tocJson)) : []);
    setDraggedPath(null);
    setDropPath(null);
    setPreviewPage(null);
  };

  const closeTocEditor = () => {
    setTocBookId(null);
    setDraggedPath(null);
    setDropPath(null);
    setTocSaving(false);
    setPreviewPage(null);
  };

  const handleTocDrop = (targetPath: string) => {
    if (!draggedPath || !targetPath || draggedPath === targetPath) return;

    const sourceParts = draggedPath.split('.').filter(Boolean).map(Number);
    const targetParts = targetPath.split('.').filter(Boolean).map(Number);

    if (sourceParts.length && targetParts.length && isDescendantPath(sourceParts, targetParts)) {
      return;
    }

    setTocDraft((prev) => moveTocNode(prev, sourceParts, targetParts));
    setDraggedPath(null);
    setDropPath(null);
  };

  const toggleIgnoreTocNode = (path: TocPath) => {
    setTocDraft((prev) => updateTocNodeAtPath(prev, path, (node) => ({
      ...node,
      ignored: !node.ignored,
    })));
  };

  const saveTocEdit = async () => {
    if (!tocBookId) return;
    setTocSaving(true);
    try {
      await adminUpdateBook(tocBookId, { tocJson: tocDraft });
      closeTocEditor();
      fetch();
    } finally {
      setTocSaving(false);
    }
  };

  const renderTocRows = (nodes: TocNode[], parentPath: TocPath = []) => {
    return nodes.map((node, index) => {
      const currentPath = [...parentPath, index];
      const pathText = getPathString(currentPath);
      const hasChildren = !!node.children?.length;
      const activeBook = books.find((book) => book.id === tocBookId);

      return (
        <div key={pathText} className="space-y-1">
          <div
            draggable
            onDragStart={() => setDraggedPath(pathText)}
            onDragOver={(event) => {
              event.preventDefault();
              setDropPath(pathText);
            }}
            onDragLeave={() => setDropPath((prev) => (prev === pathText ? null : prev))}
            onDrop={(event) => {
              event.preventDefault();
              handleTocDrop(pathText);
            }}
            onClick={() => {
              if (activeBook) {
                setPreviewPage({ bookId: activeBook.id, page: node.page });
              }
            }}
            className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm transition cursor-pointer ${
              dropPath === pathText ? 'border-primary bg-primary/10' : node.ignored ? 'border-transparent bg-muted opacity-60' : 'border-transparent bg-background hover:bg-muted/50'
            }`}
            style={{ marginLeft: `${parentPath.length * 16}px` }}
          >
            <GripVertical size={14} className="text-muted-foreground" />
            <span className="flex-1 truncate font-medium text-foreground">{node.title}</span>
            <span className="text-xs text-muted-foreground">{node.page}</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  toggleIgnoreTocNode(currentPath);
                }}
                className={`p-1 rounded ${node.ignored ? 'text-amber-600 hover:bg-amber-50' : 'text-muted-foreground hover:bg-muted'}`}
                title={node.ignored ? '显示页面' : '隐藏页面'}
              >
                {node.ignored ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>
          {hasChildren && <div>{renderTocRows(node.children || [], currentPath)}</div>}
        </div>
      );
    });
  };

  return (
    <div className="p-6">
      {/* Search bar */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="搜索书名或分类..."
            className="w-full pl-9 pr-4 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <Button onClick={handleSearch} size="sm">
          搜索
        </Button>
        <select
          value={batchFilter}
          onChange={(e) => { setBatchFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 border border-input rounded-lg text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="">全部批次</option>
          {batches.map(b => (
            <option key={b} value={b}>{b}</option>
          ))}
        </select>
        <div className="flex-1" />
        {isAdmin && selectedIds.size > 0 && (
          <div className="flex items-center gap-2 bg-primary/10 border border-primary/30 rounded-lg px-3 py-1.5">
            <span className="text-sm text-primary">已选 {selectedIds.size} 本</span>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleBatchDelete}
              disabled={deleting}
            >
              <Trash2 size={14} />
              {deleting ? '删除中...' : '批量删除'}
            </Button>
          </div>
        )}
        {isAdmin && (
          <Button
            variant="destructive"
            size="sm"
            onClick={handleClearAll}
            disabled={deleting || total === 0}
          >
            <Trash2 size={14} />
            一键清空
          </Button>
        )}
      </div>

      {/* Table */}
      <div className="bg-background rounded-lg shadow overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-foreground/70">
              <tr>
                <th className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => { if (el) el.indeterminate = !allSelected && someSelected; }}
                    onChange={toggleSelectAll}
                    className="w-4 h-4 cursor-pointer accent-primary"
                  />
                </th>
                <th className="text-left px-4 py-3 font-medium">封面</th>
                <th className="text-left px-4 py-3 font-medium">书名</th>
                <th className="text-left px-4 py-3 font-medium">页数</th>
                <th className="text-left px-4 py-3 font-medium">DPI</th>
                <th className="text-left px-4 py-3 font-medium">封皮</th>
                <th className="text-left px-4 py-3 font-medium">批次</th>
                <th className="text-left px-4 py-3 font-medium">入库时间</th>
                <th className="text-right px-4 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={8} className="text-center py-8 text-muted-foreground">加载中...</td></tr>
              ) : books.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-8 text-muted-foreground">暂无数据</td></tr>
              ) : books.map((book) => (
                <tr key={book.id} className={`transition ${selectedIds.has(book.id) ? 'bg-primary/10/60' : 'hover:bg-muted/50'}`}>
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(book.id)}
                      onChange={() => toggleSelectOne(book.id)}
                      className="w-4 h-4 cursor-pointer accent-primary"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <BookCover
                      book={book}
                      fit="contain"
                      className="aspect-[210/297] h-16 rounded border border-border"
                    />
                  </td>
                  <td className="px-4 py-3 max-w-xs">
                    {editingId === book.id ? (
                      <div className="space-y-2">
                        <input
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          className="w-full px-2 py-1 border border-input rounded text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                        <div className="grid grid-cols-2 gap-2">
                          <input
                            list="grade-presets"
                            value={editGrade}
                            onChange={(e) => setEditGrade(e.target.value)}
                            placeholder="阶段 (如 7上)"
                            className="w-full px-2 py-1 border border-input rounded text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                          <datalist id="grade-presets">
                            {GRADE_PRESETS.map((g) => <option key={g} value={g} />)}
                          </datalist>
                          <input
                            list="subject-presets"
                            value={editSubject}
                            onChange={(e) => setEditSubject(e.target.value)}
                            placeholder="学科 (如 语文)"
                            className="w-full px-2 py-1 border border-input rounded text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                          <datalist id="subject-presets">
                            {SUBJECT_PRESETS.map((s) => <option key={s} value={s} />)}
                          </datalist>
                        </div>
                        <input
                          value={editCategory}
                          onChange={(e) => setEditCategory(e.target.value)}
                          placeholder="分类"
                          className="w-full px-2 py-1 border border-input rounded text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                        <input
                          type="number"
                          min={1}
                          value={editCoverPage}
                          onChange={(e) => setEditCoverPage(Number(e.target.value) || 1)}
                          placeholder="封皮页"
                          className="w-full px-2 py-1 border border-input rounded text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                        <div className="space-y-2">
                          {getCategoryPresetFields(editCategory).length === 0 && (
                            <>
                              {Object.entries(editAttributes).length === 0 && (
                                <button
                                  type="button"
                                  onClick={() => setEditAttributes((prev) => ({ ...prev, custom_1: '' }))}
                                  className="text-xs text-primary hover:underline"
                                >
                                  + 添加自定义属性
                                </button>
                              )}
                              {Object.entries(editAttributes).map(([key, value], idx) => (
                                <div key={`${key}-${idx}`} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                                  <input
                                    value={key}
                                    onChange={(e) => {
                                      const next = { ...editAttributes };
                                      delete next[key];
                                      next[e.target.value || `custom_${idx}`] = value;
                                      setEditAttributes(next);
                                    }}
                                    placeholder="字段名"
                                    className="w-full px-2 py-1 border border-input rounded text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                                  />
                                  <input
                                    value={value}
                                    onChange={(e) => setEditAttributes((prev) => ({ ...prev, [key]: e.target.value }))}
                                    placeholder="字段值"
                                    className="w-full px-2 py-1 border border-input rounded text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => setEditAttributes((prev) => {
                                      const next = { ...prev };
                                      delete next[key];
                                      return next;
                                    })}
                                    className="px-2 py-1 text-destructive hover:bg-destructive/10 rounded"
                                  >
                                    删除
                                  </button>
                                </div>
                              ))}
                              <button
                                type="button"
                                onClick={() => setEditAttributes((prev) => ({ ...prev, [`custom_${Date.now()}`]: '' }))}
                                className="text-xs text-primary hover:underline"
                              >
                                + 添加自定义属性
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <span className="truncate block" title={book.title}>{book.title}</span>
                        <div className="flex flex-wrap gap-1 text-[11px]">
                          {book.subject && <span className="bg-emerald-50 text-emerald-600 rounded px-1.5 py-0.5">{book.subject}</span>}
                          {book.grade && <span className="bg-primary/10 text-primary rounded px-1.5 py-0.5">{book.grade}</span>}
                          {book.category && <span className="bg-violet-50 text-violet-600 rounded px-1.5 py-0.5">{book.category}</span>}
                          {(() => {
                            const pair = (book.attributes as any)?.pair;
                            if (!pair || !pair.with) return null;
                            if (pair.role === 'textbook') return <span className="bg-primary/10 text-primary rounded px-1.5 py-0.5" title={`教材 → 答案 #${pair.with}`}>教材</span>;
                            if (pair.role === 'answer') return <span className="bg-teal-50 text-teal-600 rounded px-1.5 py-0.5" title={`答案 ← 教材 #${pair.with}`}>答案</span>;
                            return null;
                          })()}
                        </div>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-foreground/70">{book.totalPages}</td>
                  <td className="px-4 py-3">
                    {book.availableDpis?.length ? (
                      <div className="flex flex-wrap gap-1">
                        {book.availableDpis.map((d: number) => (
                          <span key={d} className="inline-block px-1.5 py-0.5 bg-primary/10 text-primary rounded text-xs font-medium">
                            {d}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-muted-foreground text-xs">无</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-foreground/70">{book.coverPage || 1}</td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">
                    {book.batchId ? (
                      <span className="inline-block px-1.5 py-0.5 bg-purple-50 text-purple-600 rounded text-xs font-mono">{book.batchId}</span>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">
                    {new Date(book.createdAt).toLocaleDateString('zh-CN')}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {editingId === book.id ? (
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" onClick={() => saveEdit(book.id)} title="保存">
                          <Check size={16} />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={cancelEdit} title="取消">
                          <X size={16} />
                        </Button>
                      </div>
                    ) : (
                      <div className="flex justify-end gap-1">
                        {isAdmin && (
                          <Button variant="ghost" size="icon" onClick={() => openTocEditor(book)} title="目录排序">
                            <BookOpen size={16} />
                          </Button>
                        )}
                        {isAdmin && (
                          <Button variant="ghost" size="icon" onClick={() => startEdit(book)} title="编辑信息">
                            <Edit3 size={16} />
                          </Button>
                        )}
                        {isAdmin && (
                          <Button variant="ghost" size="icon" onClick={() => handleDelete(book.id, book.title)} title="删除">
                            <Trash2 size={16} />
                          </Button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border/50">
            <span className="text-sm text-muted-foreground">共 {total} 条</span>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}>
                <ChevronLeft size={18} />
              </Button>
              <span className="text-sm text-foreground/70">{page} / {totalPages}</span>
              <Button variant="ghost" size="icon" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
                <ChevronRight size={18} />
              </Button>
            </div>
          </div>
        )}
      </div>

      {deleteProgress && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-background shadow-xl p-6">
            <div className="flex items-center gap-3 mb-3">
              <Trash2 size={20} className="text-destructive" />
              <h3 className="font-semibold text-foreground">正在删除书籍</h3>
            </div>
            <div className="mb-2 text-sm text-foreground/70 truncate" title={deleteProgress.title}>
              {deleteProgress.title || '准备中...'}
            </div>
            <div className="w-full h-2 bg-muted rounded-full overflow-hidden mb-2">
              <div
                className="h-full bg-destructive transition-all duration-200"
                style={{ width: `${deleteProgress.total > 0 ? (deleteProgress.current / deleteProgress.total) * 100 : 0}%` }}
              />
            </div>
            <div className="text-xs text-muted-foreground text-right">
              {deleteProgress.current} / {deleteProgress.total}
              {deleteProgress.total > 0 && ` (${Math.round((deleteProgress.current / deleteProgress.total) * 100)}%)`}
            </div>
          </div>
        </div>
      )}

      {tocBookId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-4xl rounded-xl bg-background shadow-xl">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className="flex items-center gap-2">
                <BookOpen size={18} className="text-violet-500" />
                <h3 className="font-semibold text-foreground">目录排序 · 预览 · 跳过</h3>
              </div>
              <button onClick={closeTocEditor} className="text-muted-foreground hover:text-foreground">关闭</button>
            </div>

            <div className="p-4">
              <div className="mb-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700">
                提示：拖拽节点可调整目录顺序，右侧按钮可预览页面或忽略当前目录项。
              </div>

              <div className="grid grid-cols-[1.4fr_0.9fr] gap-4">
                <div className="max-h-[60vh] overflow-auto rounded-lg border border-border bg-muted/50 p-2">
                  {tocDraft.length === 0 ? (
                    <div className="text-sm text-muted-foreground py-10 text-center">暂无目录</div>
                  ) : (
                    renderTocRows(tocDraft)
                  )}
                </div>

                <div className="rounded-lg border border-border bg-muted/50 p-3">
                  {previewPage ? (
                    (() => {
                      const activeBook = books.find((book) => book.id === previewPage.bookId);
                      const imageUrl = activeBook ? getPageImageUrl(activeBook, previewPage.page) : '';
                      return (
                        <div className="space-y-3">
                          <div className="text-xs font-medium text-muted-foreground">页面预览</div>
                          <div className="flex min-h-[220px] items-start justify-center overflow-auto rounded border border-border bg-background p-2">
                            {imageUrl ? (
                              <img
                                src={imageUrl}
                                alt={`Page ${previewPage.page}`}
                                style={{ maxWidth: '100%', maxHeight: '60vh', width: 'auto', height: 'auto', objectFit: 'contain' }}
                                className="block rounded"
                                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                              />
                            ) : (
                              <div className="text-xs text-muted-foreground py-10">无可预览图片</div>
                            )}
                          </div>
                          <div className="text-sm text-foreground">第 {previewPage.page} 页</div>
                        </div>
                      );
                    })()
                  ) : (
                    <div className="flex h-full min-h-[220px] items-center justify-center text-sm text-muted-foreground text-center">
                      选择目录项即可预览对应页码
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
              <Button variant="outline" size="sm"
                onClick={() => setTocDraft(Array.isArray(books.find((book) => book.id === tocBookId)?.tocJson) ? JSON.parse(JSON.stringify(books.find((book) => book.id === tocBookId)?.tocJson)) : [])}
              >
                <RotateCcw size={15} />
                重置
              </Button>
              <Button size="sm" onClick={saveTocEdit} disabled={tocSaving}>
                <Save size={15} />
                {tocSaving ? '保存中...' : '保存目录'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="relative w-80 rounded-xl bg-background p-6 shadow-xl">
            <Button variant="ghost" size="icon" onClick={() => setDeleteConfirm(null)} className="absolute right-3 top-3 h-6 w-6" title="取消">
              <X size={16} />
            </Button>
            <h3 className="text-base font-semibold text-foreground">{deleteConfirm.title}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{deleteConfirm.message}</p>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setDeleteConfirm(null)}>
                取消
              </Button>
              <Button variant="destructive" size="sm" onClick={deleteConfirm.onConfirm}>
                删除
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
