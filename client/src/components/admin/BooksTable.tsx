import { useState, useEffect, useCallback } from 'react';
import type { TocNode } from '../../types';
import { adminGetBooks, adminUpdateBook, adminDeleteBook, getBookCoverUrl } from '../../api/client';
import { Search, Edit3, Trash2, Check, X, ChevronLeft, ChevronRight, BookOpen, GripVertical, Save, RotateCcw, Eye, EyeOff } from 'lucide-react';

const PAGE_SIZE = 10;

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
  const [books, setBooks] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
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

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminGetBooks({ page, pageSize: PAGE_SIZE, search });
      setBooks(res.data);
      setTotal(res.total);
    } finally { setLoading(false); }
  }, [page, search]);

  useEffect(() => { fetch(); }, [fetch]);

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

  const handleDelete = async (id: number, title: string) => {
    if (!confirm(`删除「${title}」？将同时清理所有切图、批注和错题。`)) return;
    await adminDeleteBook(id);
    fetch();
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
              dropPath === pathText ? 'border-primary bg-blue-50' : node.ignored ? 'border-transparent bg-gray-100 opacity-60' : 'border-transparent bg-white hover:bg-gray-50'
            }`}
            style={{ marginLeft: `${parentPath.length * 16}px` }}
          >
            <GripVertical size={14} className="text-gray-400" />
            <span className="flex-1 truncate font-medium text-gray-700">{node.title}</span>
            <span className="text-xs text-gray-500">{node.page}</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  toggleIgnoreTocNode(currentPath);
                }}
                className={`p-1 rounded ${node.ignored ? 'text-amber-600 hover:bg-amber-50' : 'text-gray-500 hover:bg-gray-100'}`}
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
      <div className="flex gap-2 mb-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="搜索书名或分类..."
            className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <button onClick={handleSearch} className="bg-primary text-white px-4 py-2 rounded-lg text-sm hover:bg-primaryDark">
          搜索
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-left px-4 py-3 font-medium">封面</th>
                <th className="text-left px-4 py-3 font-medium">书名</th>
                <th className="text-left px-4 py-3 font-medium">分类</th>
                <th className="text-left px-4 py-3 font-medium">页数</th>
                <th className="text-left px-4 py-3 font-medium">DPI</th>
                <th className="text-left px-4 py-3 font-medium">入库时间</th>
                <th className="text-right px-4 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={7} className="text-center py-8 text-gray-400">加载中...</td></tr>
              ) : books.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-8 text-gray-400">暂无数据</td></tr>
              ) : books.map((book) => (
                <tr key={book.id} className="hover:bg-gray-50 transition">
                  <td className="px-4 py-3">
                    <img
                      src={getBookCoverUrl(book, book.coverPage || 1)}
                      alt={book.title}
                      className="w-12 h-16 object-cover rounded border border-gray-200"
                      onError={(e) => {
                        const target = e.target as HTMLImageElement;
                        target.onerror = null;
                        target.src = getBookCoverUrl(book, 1);
                      }}
                    />
                  </td>
                  <td className="px-4 py-3 max-w-xs">
                    {editingId === book.id ? (
                      <div className="space-y-2">
                        <input
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                        <div className="grid grid-cols-2 gap-2">
                          <input
                            value={editGrade}
                            onChange={(e) => setEditGrade(e.target.value)}
                            placeholder="年级"
                            className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                          <input
                            value={editSubject}
                            onChange={(e) => setEditSubject(e.target.value)}
                            placeholder="学科"
                            className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                        </div>
                        <input
                          type="number"
                          min={1}
                          value={editCoverPage}
                          onChange={(e) => setEditCoverPage(Number(e.target.value) || 1)}
                          placeholder="封皮页"
                          className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-primary"
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
                                    className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                                  />
                                  <input
                                    value={value}
                                    onChange={(e) => setEditAttributes((prev) => ({ ...prev, [key]: e.target.value }))}
                                    placeholder="字段值"
                                    className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => setEditAttributes((prev) => {
                                      const next = { ...prev };
                                      delete next[key];
                                      return next;
                                    })}
                                    className="px-2 py-1 text-red-500 hover:bg-red-50 rounded"
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
                          {book.grade && <span className="bg-blue-50 text-blue-600 rounded px-1.5 py-0.5">{book.grade}</span>}
                          {book.subject && <span className="bg-amber-50 text-amber-600 rounded px-1.5 py-0.5">{book.subject}</span>}
                          {book.coverPage && <span className="bg-gray-100 text-gray-600 rounded px-1.5 py-0.5">封皮 {book.coverPage}</span>}
                        </div>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {editingId === book.id ? (
                      <input
                        value={editCategory}
                        onChange={(e) => setEditCategory(e.target.value)}
                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                    ) : (
                      <span className="text-gray-600">{book.category}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{book.totalPages}</td>
                  <td className="px-4 py-3">
                    {book.availableDpis?.length ? (
                      <div className="flex flex-wrap gap-1">
                        {book.availableDpis.map((d: number) => (
                          <span key={d} className="inline-block px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded text-xs font-medium">
                            {d}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-gray-400 text-xs">无</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {new Date(book.createdAt).toLocaleDateString('zh-CN')}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {editingId === book.id ? (
                      <div className="flex justify-end gap-1">
                        <button onClick={() => saveEdit(book.id)} className="p-1.5 text-green-600 hover:bg-green-50 rounded" title="保存">
                          <Check size={16} />
                        </button>
                        <button onClick={cancelEdit} className="p-1.5 text-gray-400 hover:bg-gray-100 rounded" title="取消">
                          <X size={16} />
                        </button>
                      </div>
                    ) : (
                      <div className="flex justify-end gap-1">
                        <button onClick={() => openTocEditor(book)} className="p-1.5 text-violet-500 hover:bg-violet-50 rounded" title="目录排序">
                          <BookOpen size={16} />
                        </button>
                        <button onClick={() => startEdit(book)} className="p-1.5 text-blue-500 hover:bg-blue-50 rounded" title="编辑信息">
                          <Edit3 size={16} />
                        </button>
                        <button onClick={() => handleDelete(book.id, book.title)} className="p-1.5 text-red-400 hover:bg-red-50 rounded" title="删除">
                          <Trash2 size={16} />
                        </button>
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
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
            <span className="text-sm text-gray-500">共 {total} 条</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-30"
              >
                <ChevronLeft size={18} />
              </button>
              <span className="text-sm text-gray-600">{page} / {totalPages}</span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-30"
              >
                <ChevronRight size={18} />
              </button>
            </div>
          </div>
        )}
      </div>

      {tocBookId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-4xl rounded-xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
              <div className="flex items-center gap-2">
                <BookOpen size={18} className="text-violet-500" />
                <h3 className="font-semibold text-gray-800">目录排序 · 预览 · 跳过</h3>
              </div>
              <button onClick={closeTocEditor} className="text-gray-500 hover:text-gray-700">关闭</button>
            </div>

            <div className="p-4">
              <div className="mb-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700">
                提示：拖拽节点可调整目录顺序，右侧按钮可预览页面或忽略当前目录项。
              </div>

              <div className="grid grid-cols-[1.4fr_0.9fr] gap-4">
                <div className="max-h-[60vh] overflow-auto rounded-lg border border-gray-200 bg-gray-50 p-2">
                  {tocDraft.length === 0 ? (
                    <div className="text-sm text-gray-400 py-10 text-center">暂无目录</div>
                  ) : (
                    renderTocRows(tocDraft)
                  )}
                </div>

                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                  {previewPage ? (
                    (() => {
                      const activeBook = books.find((book) => book.id === previewPage.bookId);
                      const imageUrl = activeBook ? getPageImageUrl(activeBook, previewPage.page) : '';
                      return (
                        <div className="space-y-3">
                          <div className="text-xs font-medium text-gray-500">页面预览</div>
                          <div className="flex min-h-[220px] items-start justify-center overflow-auto rounded border border-gray-200 bg-white p-2">
                            {imageUrl ? (
                              <img
                                src={imageUrl}
                                alt={`Page ${previewPage.page}`}
                                style={{ maxWidth: '100%', maxHeight: '60vh', width: 'auto', height: 'auto', objectFit: 'contain' }}
                                className="block rounded"
                                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                              />
                            ) : (
                              <div className="text-xs text-gray-400 py-10">无可预览图片</div>
                            )}
                          </div>
                          <div className="text-sm text-gray-700">第 {previewPage.page} 页</div>
                        </div>
                      );
                    })()
                  ) : (
                    <div className="flex h-full min-h-[220px] items-center justify-center text-sm text-gray-400 text-center">
                      选择目录项即可预览对应页码
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-4 py-3">
              <button
                onClick={() => setTocDraft(Array.isArray(books.find((book) => book.id === tocBookId)?.tocJson) ? JSON.parse(JSON.stringify(books.find((book) => book.id === tocBookId)?.tocJson)) : [])}
                className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
              >
                <RotateCcw size={15} />
                重置
              </button>
              <button
                onClick={saveTocEdit}
                disabled={tocSaving}
                className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-2 text-sm text-white hover:bg-primaryDark disabled:opacity-60"
              >
                <Save size={15} />
                {tocSaving ? '保存中...' : '保存目录'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
