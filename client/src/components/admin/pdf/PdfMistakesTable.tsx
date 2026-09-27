import { useState, useEffect, useCallback } from 'react';
import { Search, Trash2, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, RotateCcw, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { useConfirm } from '../../ConfirmDialog';
import { useAuthStore } from '../../../store/authStore';
import { adminListPdfMistakes, adminUpdatePdfMistake, adminDeletePdfMistake } from '../../../pdf/api/pdfClient';

const REVIEW_STATUS: Record<number, { label: string; color: string }> = {
  0: { label: '未复习', color: 'bg-muted text-foreground/70' },
  1: { label: '复习中', color: 'bg-amber-100 dark:bg-amber-950/60 dark:border dark:border-amber-800 text-amber-700 dark:text-amber-400' },
  2: { label: '已掌握', color: 'bg-green-100 dark:bg-green-950/60 dark:border dark:border-green-800 text-green-700 dark:text-green-400' },
};

export default function PdfMistakesTable() {
  const confirm = useConfirm();
  const { user, authEnabled } = useAuthStore();
  const isAdmin = !authEnabled || Boolean(user?.isAdmin);
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [filterSubject, setFilterSubject] = useState('all');
  const [filterTag, setFilterTag] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [loading, setLoading] = useState(false);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = { page, pageSize };
      if (filterSubject !== 'all') params.subject = filterSubject;
      if (filterTag) params.tag = filterTag;
      if (filterStatus !== 'all') params.reviewStatus = filterStatus;
      const res = await adminListPdfMistakes(params);
      setItems(res.data);
      setTotal(res.total);
    } finally { setLoading(false); }
  }, [page, pageSize, filterSubject, filterTag, filterStatus]);

  useEffect(() => { fetch(); }, [fetch]);

  const handleFilter = () => { setPage(1); fetch(); };
  const totalPages = Math.ceil(total / pageSize) || 1;

  const handleStatusChange = async (id: number, newStatus: number) => {
    try {
      await adminUpdatePdfMistake(id, { reviewStatus: newStatus });
      toast.success('状态已更新');
      fetch();
    } catch (e: any) {
      toast.error('更新失败: ' + (e?.message || '未知错误'));
    }
  };

  const handleDelete = async (id: number) => {
    const ok = await confirm({
      title: '确认删除',
      message: '确认删除此错题？裁图文件也会被删除，且无法恢复。',
      confirmText: '确认删除',
      confirmClass: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
    });
    if (!ok) return;
    try {
      await adminDeletePdfMistake(id);
      toast.success('错题已删除');
      fetch();
    } catch (e: any) {
      toast.error('删除失败: ' + (e?.message || '未知错误'));
    }
  };

  const subjects = Array.from(new Set(items.map((i) => i.subject).filter(Boolean)));

  return (
    <div className="p-6">
      <div className="flex flex-wrap gap-3 mb-4">
        <select
          value={filterSubject}
          onChange={(e) => { setFilterSubject(e.target.value); setPage(1); }}
          className="px-3 py-2 border border-input bg-background rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="all">全部学科</option>
          {subjects.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <div className="relative w-40">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
          <input
            type="text"
            value={filterTag}
            onChange={(e) => setFilterTag(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleFilter()}
            placeholder="标签搜索..."
            className="w-full pl-9 pr-3 py-2 border border-input bg-background text-foreground placeholder:text-muted-foreground rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <select
          value={filterStatus}
          onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}
          className="px-3 py-2 border border-input bg-background rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="all">全部状态</option>
          <option value="0">未复习</option>
          <option value="1">复习中</option>
          <option value="2">已掌握</option>
        </select>
        <button onClick={handleFilter} className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm hover:bg-primary/90">
          筛选
        </button>
      </div>

      <div className="bg-background rounded-lg shadow overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-foreground/70">
              <tr>
                <th className="text-left px-4 py-3 font-medium">ID</th>
                <th className="text-left px-4 py-3 font-medium">图片</th>
                <th className="text-left px-4 py-3 font-medium">书名</th>
                <th className="text-left px-4 py-3 font-medium">页码</th>
                <th className="text-left px-4 py-3 font-medium">学科</th>
                <th className="text-left px-4 py-3 font-medium">标签</th>
                <th className="text-left px-4 py-3 font-medium">复习状态</th>
                <th className="text-left px-4 py-3 font-medium">创建时间</th>
                <th className="text-right px-4 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr><td colSpan={9} className="text-center py-8 text-muted-foreground">加载中...</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-8 text-muted-foreground">暂无数据</td></tr>
              ) : items.map((item) => {
                const st = REVIEW_STATUS[item.reviewStatus] || REVIEW_STATUS[0];
                return (
                  <tr key={item.id} className="hover:bg-muted/50 transition">
                    <td className="px-4 py-3 text-muted-foreground">{item.id}</td>
                    <td className="px-4 py-3">
                      <img
                        src={item.imageUrl}
                        alt={`错题#${item.id}`}
                        className="w-14 h-18 object-cover rounded border border-border"
                        onError={(e) => { (e.target as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="56" height="72"><rect fill="%23f3f4f6" width="56" height="72"/><text x="50%25" y="50%25" text-anchor="middle" fill="%239ca3af" font-size="10" dy=".3em">N/A</text></svg>'; }}
                      />
                    </td>
                    <td className="px-4 py-3 max-w-[140px]">
                      <span className="truncate block text-foreground" title={item.book?.title}>
                        {item.book?.title || `Book#${item.bookId}`}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-foreground/70">P{item.pageNumber}</td>
                    <td className="px-4 py-3 text-foreground">{item.subject}</td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">{item.tags || '-'}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${st.color}`}>
                          {st.label}
                        </span>
                        {isAdmin && (
                          <div className="flex gap-0.5 ml-1">
                            {item.reviewStatus < 2 && (
                              <button
                                onClick={() => handleStatusChange(item.id, item.reviewStatus + 1)}
                                className="p-1 text-green-500 hover:bg-green-50 dark:bg-green-950/50 dark:border dark:border-green-800 rounded"
                                title="升级状态"
                              >
                                <CheckCircle2 size={14} />
                              </button>
                            )}
                            {item.reviewStatus > 0 && (
                              <button
                                onClick={() => handleStatusChange(item.id, item.reviewStatus - 1)}
                                className="p-1 text-muted-foreground hover:bg-muted rounded"
                                title="回退状态"
                              >
                                <RotateCcw size={14} />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs whitespace-nowrap">
                      {new Date(item.createdAt).toLocaleString('zh-CN')}
                    </td>
                    <td className="px-4 py-3 text-right">
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
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-border/50">
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span>共 <span className="text-foreground font-medium">{total}</span> 条</span>
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
            <button onClick={() => setPage(1)} disabled={page <= 1} className="h-8 w-8 rounded-md hover:bg-muted disabled:opacity-30" title="首页">
              <ChevronsLeft size={18} />
            </button>
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="h-8 w-8 rounded-md hover:bg-muted disabled:opacity-30" title="上一页">
              <ChevronLeft size={18} />
            </button>
            <span className="px-2 text-sm text-foreground/80">第 <span className="text-foreground font-medium">{page}</span> / {totalPages} 页</span>
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="h-8 w-8 rounded-md hover:bg-muted disabled:opacity-30" title="下一页">
              <ChevronRight size={18} />
            </button>
            <button onClick={() => setPage(totalPages)} disabled={page >= totalPages} className="h-8 w-8 rounded-md hover:bg-muted disabled:opacity-30" title="末页">
              <ChevronsRight size={18} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
