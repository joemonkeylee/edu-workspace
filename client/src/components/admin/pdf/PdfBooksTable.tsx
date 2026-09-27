import { useState, useEffect, useCallback } from 'react';
import { Search, Trash2, RotateCcw, Edit3, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Archive, Square, CheckSquare, Download } from 'lucide-react';
import { toast } from 'sonner';
import { useConfirm } from '../../ConfirmDialog';
import { useAuthStore } from '../../../store/authStore';
import {
  adminListPdfBooks, adminSoftDeletePdfBook, adminRestorePdfBook,
  adminSoftDeletePdfBooksBatch, adminRestorePdfBooksBatch,
  adminUpdatePdfBook, adminGetPdfBookBatches, adminGetPdfBookFacets,
  adminListPdfDeletedBooks, type PdfAdminBook,
} from '../../../pdf/api/pdfClient';

function coverUrlFor(id: number, coverPage: number) {
  return `/api/pdf/books/${id}/cover?page=${coverPage || 1}&w=200`;
}

function sizeText(bytes: number) {
  if (!bytes) return '-';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

export default function PdfBooksTable() {
  const confirm = useConfirm();
  const { user, authEnabled } = useAuthStore();
  const isAdmin = !authEnabled || user?.isAdmin || user?.role === 'admin';

  const [books, setBooks] = useState<PdfAdminBook[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [batchFilter, setBatchFilter] = useState('all');
  const [gradeFilter, setGradeFilter] = useState('all');
  const [subjectFilter, setSubjectFilter] = useState('all');
  const [searchableFilter, setSearchableFilter] = useState('all');
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [viewDeleted, setViewDeleted] = useState(false);

  const [batches, setBatches] = useState<string[]>([]);
  const [facets, setFacets] = useState<{ grades: any[]; subjects: any[]; categories: any[]; searchables: any[]; missing: number } | null>(null);

  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [editingBook, setEditingBook] = useState<PdfAdminBook | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = { page, pageSize };
      if (search.trim()) params.search = search.trim();
      if (batchFilter !== 'all') params.batchId = batchFilter;
      if (gradeFilter !== 'all') params.grade = gradeFilter;
      if (subjectFilter !== 'all') params.subject = subjectFilter;
      if (searchableFilter !== 'all') params.searchable = searchableFilter;
      if (onlyMissing) params.missing = true;

      const fn = viewDeleted ? adminListPdfDeletedBooks : adminListPdfBooks;
      const res = await fn(params);
      setBooks(res.data);
      setTotal(res.total);
      setSelectedIds([]);
    } catch (e: any) {
      toast.error('加载失败: ' + (e?.message || ''));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, search, batchFilter, gradeFilter, subjectFilter, searchableFilter, onlyMissing, viewDeleted]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    adminGetPdfBookBatches().then(setBatches).catch(() => {});
    adminGetPdfBookFacets().then((f: any) => setFacets(f)).catch(() => {});
  }, []);

  const totalPages = Math.ceil(total / pageSize) || 1;
  const allSelected = books.length > 0 && books.every((b) => selectedIds.includes(b.id));

  const toggleSelectAll = () => {
    setSelectedIds(allSelected ? [] : books.map((b) => b.id));
  };

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };

  const handleFilter = () => { setPage(1); fetchData(); };

  const handleDelete = async (book: PdfAdminBook) => {
    const ok = await confirm({
      title: '确认删除',
      message: `确认删除「${book.title}」？批注/错题/作业仍会保留，可在回收站恢复。`,
      confirmText: '确认删除',
      confirmClass: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
    });
    if (!ok) return;
    try {
      await adminSoftDeletePdfBook(book.id);
      toast.success('已删除');
      fetchData();
    } catch (e: any) {
      toast.error('删除失败: ' + (e?.message || ''));
    }
  };

  const handleRestore = async (book: PdfAdminBook) => {
    try {
      await adminRestorePdfBook(book.id);
      toast.success('已恢复');
      fetchData();
    } catch (e: any) {
      toast.error('恢复失败: ' + (e?.message || ''));
    }
  };

  const handleBatchDelete = async () => {
    if (selectedIds.length === 0) return;
    const ok = await confirm({
      title: '确认批量删除',
      message: `确认删除选中的 ${selectedIds.length} 本书？可在回收站恢复。`,
      confirmText: '确认删除',
      confirmClass: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
    });
    if (!ok) return;
    try {
      await adminSoftDeletePdfBooksBatch(selectedIds);
      toast.success(`已删除 ${selectedIds.length} 本`);
      setSelectedIds([]);
      fetchData();
    } catch (e: any) {
      toast.error('批量删除失败: ' + (e?.message || ''));
    }
  };

  const handleBatchRestore = async () => {
    if (selectedIds.length === 0) return;
    try {
      const res = await adminRestorePdfBooksBatch(selectedIds);
      toast.success(`已恢复 ${res.restored} 本`);
      setSelectedIds([]);
      fetchData();
    } catch (e: any) {
      toast.error('批量恢复失败: ' + (e?.message || ''));
    }
  };

  const handleSaveEdit = async (payload: any) => {
    if (!editingBook) return;
    try {
      await adminUpdatePdfBook(editingBook.id, payload);
      toast.success('保存成功');
      setEditingBook(null);
      fetchData();
    } catch (e: any) {
      toast.error('保存失败: ' + (e?.message || ''));
    }
  };

  return (
    <div className="p-6">
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            onKeyDown={(e) => e.key === 'Enter' && handleFilter()}
            placeholder="搜索书名..."
            className="w-full pl-9 pr-3 py-2 border border-input bg-background text-foreground placeholder:text-muted-foreground rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <select value={batchFilter} onChange={(e) => { setBatchFilter(e.target.value); setPage(1); }} className="px-3 py-2 border border-input bg-background rounded-lg text-sm">
          <option value="all">全部批次</option>
          {batches.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        <select value={gradeFilter} onChange={(e) => { setGradeFilter(e.target.value); setPage(1); }} className="px-3 py-2 border border-input bg-background rounded-lg text-sm">
          <option value="all">全部学期</option>
          {facets?.grades.map((g) => <option key={g.value} value={g.value}>{g.value} ({g.count})</option>)}
        </select>
        <select value={subjectFilter} onChange={(e) => { setSubjectFilter(e.target.value); setPage(1); }} className="px-3 py-2 border border-input bg-background rounded-lg text-sm">
          <option value="all">全部学科</option>
          {facets?.subjects.map((s) => <option key={s.value} value={s.value}>{s.value} ({s.count})</option>)}
        </select>
        <select value={searchableFilter} onChange={(e) => { setSearchableFilter(e.target.value); setPage(1); }} className="px-3 py-2 border border-input bg-background rounded-lg text-sm">
          <option value="all">全部可搜索</option>
          {facets?.searchables.map((s) => <option key={s.value} value={s.value}>{s.value} ({s.count})</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-foreground cursor-pointer">
          <input type="checkbox" checked={onlyMissing} onChange={(e) => { setOnlyMissing(e.target.checked); setPage(1); }} className="accent-destructive" />
          仅缺失 ({facets?.missing || 0})
        </label>
        <button onClick={handleFilter} className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm hover:bg-primary/90">
          筛选
        </button>

        <div className="flex items-center gap-1 ml-auto">
          {isAdmin && (
            <button
              onClick={viewDeleted ? handleBatchRestore : handleBatchDelete}
              disabled={selectedIds.length === 0}
              className={`inline-flex items-center gap-1 px-3 py-2 rounded-lg text-sm text-white disabled:opacity-40 ${viewDeleted ? 'bg-green-600 hover:bg-green-600/90' : 'bg-destructive hover:bg-destructive/90'}`}
            >
              {viewDeleted ? <RotateCcw size={15} /> : <Trash2 size={15} />}
              {viewDeleted ? '批量恢复' : '批量删除'} ({selectedIds.length})
            </button>
          )}
          <button
            onClick={() => { setViewDeleted((v) => !v); setPage(1); }}
            className={`inline-flex items-center gap-1 px-3 py-2 rounded-lg text-sm border ${viewDeleted ? 'bg-amber-100 dark:bg-amber-950/60 dark:border dark:border-amber-800 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400' : 'bg-background border-input hover:bg-muted'}`}
          >
            <Archive size={15} /> {viewDeleted ? '回收站' : '书籍库'}
          </button>
        </div>
      </div>

      <div className="bg-background rounded-lg shadow overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-foreground/70">
              <tr>
                {isAdmin && (
                  <th className="w-12 px-4 py-3 text-center">
                    <button onClick={toggleSelectAll} className="text-muted-foreground hover:text-primary">
                      {allSelected ? <CheckSquare size={17} /> : <Square size={17} />}
                    </button>
                  </th>
                )}
                <th className="text-left px-4 py-3 font-medium">封面</th>
                <th className="text-left px-4 py-3 font-medium">书名</th>
                <th className="text-left px-4 py-3 font-medium">分类</th>
                <th className="text-left px-4 py-3 font-medium">学期</th>
                <th className="text-left px-4 py-3 font-medium">学科</th>
                <th className="text-left px-4 py-3 font-medium">页数</th>
                <th className="text-left px-4 py-3 font-medium">大小</th>
                <th className="text-left px-4 py-3 font-medium">可搜索</th>
                <th className="text-left px-4 py-3 font-medium">批次</th>
                <th className="text-right px-4 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr><td colSpan={isAdmin ? 11 : 10} className="text-center py-12 text-muted-foreground">加载中...</td></tr>
              ) : books.length === 0 ? (
                <tr><td colSpan={isAdmin ? 11 : 10} className="text-center py-12 text-muted-foreground">暂无数据</td></tr>
              ) : books.map((book) => (
                <tr key={book.id} className="hover:bg-muted/50 transition">
                  {isAdmin && (
                    <td className="px-4 py-3 text-center">
                      <button onClick={() => toggleSelect(book.id)} className="text-muted-foreground hover:text-primary">
                        {selectedIds.includes(book.id) ? <CheckSquare size={17} /> : <Square size={17} />}
                      </button>
                    </td>
                  )}
                  <td className="px-4 py-3">
                    {book.missing ? (
                      <div className="w-12 h-16 bg-destructive/10 rounded flex items-center justify-center" title="PDF 文件缺失">
                        <span className="text-[9px] text-destructive">缺失</span>
                      </div>
                    ) : (
                      <img
                        src={coverUrlFor(book.id, book.coverPage)}
                        alt={book.title}
                        className="w-12 h-16 object-cover rounded border border-border"
                      />
                    )}
                  </td>
                  <td className="px-4 py-3 max-w-[220px]">
                    <div className="font-medium text-foreground truncate" title={book.title}>{book.title}</div>
                    <div className="text-xs text-muted-foreground">#{book.id}</div>
                  </td>
                  <td className="px-4 py-3 text-foreground/70">{book.category}</td>
                  <td className="px-4 py-3 text-primary">{book.grade}</td>
                  <td className="px-4 py-3 text-emerald-600 dark:text-emerald-400">{book.subject}</td>
                  <td className="px-4 py-3 text-foreground/70">{book.totalPages} 页</td>
                  <td className="px-4 py-3 text-muted-foreground text-xs whitespace-nowrap">{sizeText(book.fileSize)}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs ${book.searchable === 'ok' ? 'text-green-600 dark:text-green-400' : book.searchable === 'watermark_only' ? 'text-sky-600 dark:text-sky-400' : 'text-amber-600 dark:text-amber-400'}`}>
                      {book.searchable}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs max-w-[120px] truncate" title={book.batchId}>
                    {book.batchId || '-'}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {viewDeleted ? (
                      <button
                        onClick={() => handleRestore(book)}
                        className="p-1.5 text-green-600 hover:bg-green-50 dark:bg-green-950/50 dark:border dark:border-green-800 rounded"
                        title="恢复"
                      >
                        <RotateCcw size={16} />
                      </button>
                    ) : (
                      <>
                        {isAdmin && (
                          <button
                            onClick={() => setEditingBook(book)}
                            className="p-1.5 text-primary hover:bg-primary/10 rounded"
                            title="编辑"
                          >
                            <Edit3 size={16} />
                          </button>
                        )}
                        <a
                          href={`/api/pdf/books/${book.id}/file`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1.5 text-muted-foreground hover:bg-muted rounded inline-block"
                          title="下载 PDF"
                        >
                          <Download size={16} />
                        </a>
                        {isAdmin && (
                          <button
                            onClick={() => handleDelete(book)}
                            className="p-1.5 text-destructive/70 hover:bg-destructive/10 rounded"
                            title="删除"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-border/50">
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span>共 <span className="text-foreground font-medium">{total}</span> 本</span>
            <span className="text-border">|</span>
            <span>每页</span>
            <select
              value={pageSize}
              onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
              className="h-7 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            >
              {[10, 20, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <span>条</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(1)}
              disabled={page <= 1}
              className="h-8 w-8 rounded-md hover:bg-accent hover:text-accent-foreground disabled:opacity-30 disabled:cursor-not-allowed"
              title="首页"
            >
              <ChevronsLeft size={18} />
            </button>
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="h-8 w-8 rounded-md hover:bg-accent hover:text-accent-foreground disabled:opacity-30 disabled:cursor-not-allowed"
              title="上一页"
            >
              <ChevronLeft size={18} />
            </button>
            <span className="px-2 text-sm text-foreground/80">
              第 <span className="text-foreground font-medium">{page}</span> / {totalPages} 页
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="h-8 w-8 rounded-md hover:bg-accent hover:text-accent-foreground disabled:opacity-30 disabled:cursor-not-allowed"
              title="下一页"
            >
              <ChevronRight size={18} />
            </button>
            <button
              onClick={() => setPage(totalPages)}
              disabled={page >= totalPages}
              className="h-8 w-8 rounded-md hover:bg-accent hover:text-accent-foreground disabled:opacity-30 disabled:cursor-not-allowed"
              title="末页"
            >
              <ChevronsRight size={18} />
            </button>
          </div>
        </div>
      </div>

      {editingBook && (
        <EditBookDialog
          book={editingBook}
          onClose={() => setEditingBook(null)}
          onSave={handleSaveEdit}
        />
      )}
    </div>
  );
}

function EditBookDialog({ book, onClose, onSave }: { book: PdfAdminBook; onClose: () => void; onSave: (payload: any) => void }) {
  const [title, setTitle] = useState(book.title);
  const [category, setCategory] = useState(book.category);
  const [grade, setGrade] = useState(book.grade);
  const [subject, setSubject] = useState(book.subject);
  const [coverPage, setCoverPage] = useState(book.coverPage || 1);
  const [tocInput, setTocInput] = useState(book.tocJson ? JSON.stringify(book.tocJson, null, 2) : '');
  const [tocError, setTocError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    let parsedToc: any = book.tocJson;
    if (tocInput.trim()) {
      try {
        parsedToc = JSON.parse(tocInput);
        setTocError('');
      } catch {
        setTocError('TOC 必须是合法 JSON 数组');
        return;
      }
    }
    setSaving(true);
    try {
      await onSave({ title, category, grade, subject, coverPage, tocJson: parsedToc });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-background rounded-lg shadow-xl border border-border w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-border">
          <h3 className="text-lg font-semibold text-foreground">编辑 PDF 书籍 #{book.id}</h3>
        </div>
        <div className="px-6 py-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">书名</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full px-3 py-2 border border-input bg-background rounded-lg text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">分类</label>
              <input value={category} onChange={(e) => setCategory(e.target.value)} className="w-full px-3 py-2 border border-input bg-background rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">学期</label>
              <input value={grade} onChange={(e) => setGrade(e.target.value)} className="w-full px-3 py-2 border border-input bg-background rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">学科</label>
              <input value={subject} onChange={(e) => setSubject(e.target.value)} className="w-full px-3 py-2 border border-input bg-background rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">封面页（1 起）</label>
              <input type="number" min={1} value={coverPage} onChange={(e) => setCoverPage(Number(e.target.value) || 1)} className="w-full px-3 py-2 border border-input bg-background rounded-lg text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">TOC（JSON 数组）</label>
            <textarea
              value={tocInput}
              onChange={(e) => setTocInput(e.target.value)}
              rows={8}
              className="w-full px-3 py-2 border border-input bg-background rounded-lg text-sm font-mono"
              placeholder='[{"title":"第一章","page":1,"children":[...]}]'
            />
            {tocError && <p className="mt-1 text-xs text-destructive">{tocError}</p>}
          </div>
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-border">
          <button onClick={onClose} disabled={saving} className="px-4 py-2 border border-input rounded-lg text-sm hover:bg-muted">
            取消
          </button>
          <button onClick={handleSave} disabled={saving} className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm hover:bg-primary/90">
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
