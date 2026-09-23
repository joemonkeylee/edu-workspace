import { useState, useEffect, useCallback, useMemo } from 'react';
import { Search, Trash2, CheckSquare, Square, ExternalLink, ChevronLeft, ChevronRight, ChevronDown, BookOpen, Layers, List } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from "@/components/ui/button"
import { adminDeleteAssignment, adminDeleteAssignmentsBatch, adminGetAssignments } from '../../api/client';
import { formatAssignmentTitle } from '../../utils/assignment';
import { useConfirm } from '../ConfirmDialog';
import { useAuthStore } from '../../store/authStore';

const PAGE_SIZE = 20;

function formatDate(value: string) {
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

const STATUS_TEXT: Record<string, string> = {
  graded: '已批改',
  submitted: '已提交',
  returned: '已打回',
  draft: '待提交',
};

const STATUS_CLASS: Record<string, string> = {
  graded: 'bg-green-100 dark:bg-green-950/60 dark:border dark:border-green-800 text-green-700 dark:text-green-400',
  submitted: 'bg-primary/10 text-primary',
  returned: 'bg-amber-100 dark:bg-amber-950/60 dark:border dark:border-amber-800 text-amber-700 dark:text-amber-400 dark:text-amber-400',
  draft: 'bg-muted text-foreground/70',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${STATUS_CLASS[status] || STATUS_CLASS.draft}`}>
      {STATUS_TEXT[status] || '待提交'}
    </span>
  );
}

export default function AssignmentsTable() {
  const confirm = useConfirm();
  const { user, authEnabled } = useAuthStore();
  const isAdmin = !authEnabled || user?.isAdmin || user?.role === 'admin';
  const [items, setItems] = useState<any[]>([]);
  const [books, setBooks] = useState<{ id: number; title: string }[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('submitted');
  const [filterBook, setFilterBook] = useState('all');
  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [viewMode, setViewMode] = useState<'list' | 'book'>('book');
  const [expandedBooks, setExpandedBooks] = useState<number[]>([]);

  const fetchAssignments = useCallback(async () => {
    setLoading(true);
    try {
      // The grouped view needs every match at once to group by book, so it
      // asks for the maximum page size instead of paging through books.
      const params: Record<string, any> = { page, pageSize: viewMode === 'book' ? 200 : PAGE_SIZE };
      if (search.trim()) params.search = search.trim();
      if (filterStatus !== 'all') params.status = filterStatus;
      if (filterBook !== 'all') params.bookId = filterBook;
      const response = await adminGetAssignments(params);
      setItems(response.data);
      setBooks(response.books);
      setTotal(response.total);
      setSelectedIds([]);
    } finally {
      setLoading(false);
    }
  }, [page, search, filterStatus, filterBook, viewMode]);

  useEffect(() => { fetchAssignments(); }, [fetchAssignments]);

  // ── Grouped-by-book view ────────────────────────────────────────────
  const groupedBooks = useMemo(() => {
    const map = new Map<number, { bookId: number; title: string; items: any[] }>();
    for (const item of items) {
      const key = item.bookId;
      if (!map.has(key)) {
        map.set(key, { bookId: key, title: item.book?.title || `书籍 #${key}`, items: [] });
      }
      map.get(key)!.items.push(item);
    }
    // items already come back newest-first, so sort groups by latest attempt
    return [...map.values()].sort(
      (a, b) => new Date(b.items[0].createdAt).getTime() - new Date(a.items[0].createdAt).getTime()
    );
  }, [items]);

  const countByStatus = (list: any[], status: string) => list.filter((i) => i.status === status).length;

  const toggleBook = (bookId: number) => {
    setExpandedBooks((current) =>
      current.includes(bookId) ? current.filter((id) => id !== bookId) : [...current, bookId]
    );
  };

  // Reader links open in a new tab so the admin list keeps its filters,
  // expanded rows and scroll position instead of being navigated away.
  const openInNewTab = (url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const allSelected = items.length > 0 && items.every((item) => selectedIds.includes(item.id));
  const totalPages = Math.ceil(total / PAGE_SIZE) || 1;

  const toggleAll = () => {
    setSelectedIds(allSelected ? [] : items.map((item) => item.id));
  };

  const toggleSelected = (id: number) => {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const handleDelete = async (id: number) => {
    const confirmed = await confirm({
      title: '确认删除',
      message: '确认删除此作业吗？学生笔迹和教师批改笔迹都会被删除，且无法恢复。',
      confirmText: '确认删除',
      confirmClass: 'bg-destructive hover:bg-destructive/90',
    });
    if (!confirmed) return;
    try {
      await adminDeleteAssignment(id);
      toast.success('作业已删除');
      fetchAssignments();
    } catch (e: any) {
      toast.error('删除失败: ' + (e?.message || ''));
    }
  };

  const handleBatchDelete = async () => {
    if (selectedIds.length === 0) return;
    const confirmed = await confirm({
      title: '确认批量删除',
      message: `确认删除选中的 ${selectedIds.length} 个作业吗？相关笔迹都会被删除，且无法恢复。`,
      confirmText: '确认删除',
      confirmClass: 'bg-destructive hover:bg-destructive/90',
    });
    if (!confirmed) return;
    try {
      await adminDeleteAssignmentsBatch(selectedIds);
      toast.success(`已删除 ${selectedIds.length} 个作业`);
      setSelectedIds([]);
      fetchAssignments();
    } catch (e: any) {
      toast.error('批量删除失败: ' + (e?.message || ''));
    }
  };

  return (
    <div className="p-6">
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5">
          <button
            onClick={() => { setViewMode('book'); setPage(1); setSelectedIds([]); setExpandedBooks([]); }}
            className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-sm font-medium transition ${
              viewMode === 'book' ? 'bg-background text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
            title="按书籍聚合展示每次作业"
          >
            <Layers size={14} /> 按书分组
          </button>
          <button
            onClick={() => { setViewMode('list'); setPage(1); setSelectedIds([]); }}
            className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-sm font-medium transition ${
              viewMode === 'list' ? 'bg-background text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
            title="平铺的作业列表"
          >
            <List size={14} /> 列表
          </button>
        </div>
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            onKeyDown={(e) => e.key === 'Enter' && fetchAssignments()}
            placeholder="搜索作业、书名或学科..."
            className="w-full pl-9 pr-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5">
          {[
            { value: 'all', label: '全部' },
            { value: 'draft', label: '待提交' },
            { value: 'submitted', label: '已提交' },
            { value: 'returned', label: '已打回' },
            { value: 'graded', label: '已批改' },
          ].map((tab) => (
            <button
              key={tab.value}
              onClick={() => { setFilterStatus(tab.value); setPage(1); }}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${
                filterStatus === tab.value
                  ? 'bg-background text-primary shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <select
          value={filterBook}
          onChange={(e) => { setFilterBook(e.target.value); setPage(1); }}
          className="max-w-64 px-3 py-2 border border-input rounded-lg text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="all">全部书籍</option>
          {books.map((book) => <option key={book.id} value={book.id}>{book.title}</option>)}
        </select>
        <button onClick={fetchAssignments} className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm hover:bg-primary/90">
          筛选
        </button>
        {isAdmin && (
          <button
            onClick={handleBatchDelete}
            disabled={selectedIds.length === 0}
            className="ml-auto inline-flex items-center gap-1 bg-destructive text-white px-3 py-2 rounded-lg text-sm hover:bg-destructive disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Trash2 size={15} /> 批量删除 ({selectedIds.length})
          </button>
        )}
      </div>

      {viewMode === 'book' ? (
        <div className="space-y-3">
          {loading ? (
            <div className="py-8 text-center text-muted-foreground text-sm bg-background rounded-lg shadow">加载中...</div>
          ) : groupedBooks.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground text-sm bg-background rounded-lg shadow">暂无作业</div>
          ) : (
            <>
              {total > items.length && (
                <p className="px-3 py-2 text-xs rounded-lg text-amber-700 dark:text-amber-400 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/50 dark:border dark:border-amber-800 border border-amber-200 dark:border-amber-800">
                  共匹配 {total} 条，分组视图一次最多加载 {items.length} 条，请缩小筛选范围以查看全部。
                </p>
              )}
              <div className="flex items-center justify-end gap-3">
                <button onClick={() => setExpandedBooks(groupedBooks.map((g) => g.bookId))} className="text-xs text-primary hover:underline">
                  展开全部
                </button>
                <button onClick={() => setExpandedBooks([])} className="text-xs text-muted-foreground hover:underline">
                  收起全部
                </button>
              </div>
              {groupedBooks.map((group) => {
                const open = expandedBooks.includes(group.bookId);
                const returned = countByStatus(group.items, 'returned');
                return (
                  <div key={group.bookId} className="overflow-hidden bg-background rounded-lg shadow">
                    <div className="flex items-center gap-3 px-4 py-3">
                      <button onClick={() => toggleBook(group.bookId)} className="text-muted-foreground transition hover:text-primary" title={open ? '收起' : '展开'}>
                        <ChevronDown size={18} className={`transition-transform ${open ? '' : '-rotate-90'}`} />
                      </button>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-foreground truncate" title={group.title}>{group.title}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          共 {group.items.length} 次作业
                          {' · '}待提交 {countByStatus(group.items, 'draft')}
                          {' · '}已提交 {countByStatus(group.items, 'submitted')}
                          {' · '}已批改 {countByStatus(group.items, 'graded')}
                          {returned > 0 && ` · 已打回 ${returned}`}
                          {' · '}最近 {formatDate(group.items[0].createdAt)}
                        </p>
                      </div>
                      <button
                        onClick={() => openInNewTab(`/book/${group.bookId}`)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg text-primary hover:bg-primary/10"
                        title="打开这本书的阅读页"
                      >
                        <BookOpen size={14} /> 打开书籍
                      </button>
                    </div>
                    {open && (
                      <div className="border-t divide-y divide-gray-100 border-border/50">
                        {group.items.map((item) => (
                          <div key={item.id} className="flex items-center gap-3 px-4 py-2.5 pl-12 transition hover:bg-muted/50">
                            <div className="flex-1 min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-medium text-foreground">
                                  {formatAssignmentTitle(item.title) || `作业 #${item.id}`}
                                </span>
                                <StatusBadge status={item.status} />
                                {item.pages?.length > 0 && (
                                  <span className="text-xs text-muted-foreground">第 {item.pages.join('、')} 页</span>
                                )}
                              </div>
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                {formatDate(item.createdAt)} · {item._count?.strokes ?? 0} 笔
                              </p>
                            </div>
                            <button
                              onClick={() => openInNewTab(`/book/${item.bookId}?assignmentId=${item.id}&grading=1&role=teacher`)}
                              className="inline-flex items-center gap-1 p-1.5 rounded text-primary hover:bg-primary/10"
                              title="进入批改"
                            >
                              <ExternalLink size={16} />
                            </button>
                            {isAdmin && (
                              <button
                                onClick={() => handleDelete(item.id)}
                                className="p-1.5 rounded text-destructive/70 hover:bg-destructive/10"
                                title="删除"
                              >
                                <Trash2 size={16} />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>
      ) : (
      <div className="bg-background rounded-lg shadow overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-foreground/70">
              <tr>
                {isAdmin && (
                  <th className="w-12 px-4 py-3 text-center">
                    <button onClick={toggleAll} title={allSelected ? '取消全选' : '全选'} className="text-muted-foreground hover:text-primary">
                      {allSelected ? <CheckSquare size={17} /> : <Square size={17} />}
                    </button>
                  </th>
                )}
                <th className="text-left px-4 py-3 font-medium">作业</th>
                <th className="text-left px-4 py-3 font-medium">书籍</th>
                <th className="text-left px-4 py-3 font-medium">学科</th>
                <th className="text-left px-4 py-3 font-medium">笔迹</th>
                <th className="text-left px-4 py-3 font-medium">状态</th>
                <th className="text-left px-4 py-3 font-medium">创建时间</th>
                <th className="text-right px-4 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={isAdmin ? 8 : 7} className="text-center py-8 text-muted-foreground">加载中...</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={isAdmin ? 8 : 7} className="text-center py-8 text-muted-foreground">暂无作业</td></tr>
              ) : items.map((item) => (
                <tr key={item.id} className="hover:bg-muted/50 transition">
                  {isAdmin && (
                    <td className="px-4 py-3 text-center">
                      <button onClick={() => toggleSelected(item.id)} className="text-muted-foreground hover:text-primary">
                        {selectedIds.includes(item.id) ? <CheckSquare size={17} /> : <Square size={17} />}
                      </button>
                    </td>
                  )}
                  <td className="px-4 py-3 font-medium text-foreground whitespace-nowrap">
                    {formatAssignmentTitle(item.title) || `作业 #${item.id}`}
                  </td>
                  <td className="px-4 py-3 text-foreground max-w-56 truncate" title={item.book?.title}>{item.book?.title || '-'}</td>
                  <td className="px-4 py-3 text-foreground/70">{item.subject || '-'}</td>
                  <td className="px-4 py-3 text-foreground/70">{item._count?.strokes ?? 0}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={item.status} />
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs whitespace-nowrap">{formatDate(item.createdAt)}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button
                      onClick={() => openInNewTab(`/book/${item.bookId}?assignmentId=${item.id}&grading=1&role=teacher`)}
                      className="inline-flex items-center gap-1 p-1.5 text-primary hover:bg-primary/10 rounded"
                      title="进入批改"
                    >
                      <ExternalLink size={16} />
                    </button>
                    {isAdmin && (
                      <button
                        onClick={() => handleDelete(item.id)}
                        className="p-1.5 text-destructive/70 hover:bg-destructive/10 rounded"
                        title="删除"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border/50">
            <span className="text-sm text-muted-foreground">共 {total} 条</span>
            <div className="flex items-center gap-2">
              <button onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1} className="h-8 w-8 rounded-md hover:bg-accent hover:text-accent-foreground"><ChevronLeft size={18} /></button>
              <span className="text-sm text-foreground/70">{page} / {totalPages}</span>
              <button onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={page >= totalPages} className="h-8 w-8 rounded-md hover:bg-accent hover:text-accent-foreground"><ChevronRight size={18} /></button>
            </div>
          </div>
        )}
      </div>
      )}
    </div>
  );
}
