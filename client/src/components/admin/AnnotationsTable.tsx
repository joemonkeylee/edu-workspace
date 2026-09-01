import { useState, useEffect, useCallback } from 'react';
import { adminGetAnnotations, adminDeleteAnnotation } from '../../api/client';
import { Search, Trash2, ChevronLeft, ChevronRight, Highlighter, FileText } from 'lucide-react';

const PAGE_SIZE = 10;

const TYPE_LABELS: Record<string, string> = {
  highlight: '高亮',
  note: '批注',
  underline: '下划线',
};

export default function AnnotationsTable() {
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filterBookId, setFilterBookId] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [loading, setLoading] = useState(false);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = { page, pageSize: PAGE_SIZE };
      if (filterBookId) params.bookId = filterBookId;
      if (filterType !== 'all') params.type = filterType;
      const res = await adminGetAnnotations(params);
      setItems(res.data);
      setTotal(res.total);
    } finally { setLoading(false); }
  }, [page, filterBookId, filterType]);

  useEffect(() => { fetch(); }, [fetch]);

  const handleFilter = () => { setPage(1); fetch(); };
  const totalPages = Math.ceil(total / PAGE_SIZE) || 1;

  const handleDelete = async (id: number) => {
    if (!confirm('确认删除此批注？')) return;
    await adminDeleteAnnotation(id);
    fetch();
  };

  const renderContent = (item: any) => {
    if (!item.contentJson) return '-';
    try {
      const c = typeof item.contentJson === 'string' ? JSON.parse(item.contentJson) : item.contentJson;
      if (item.type === 'highlight' && c.text) {
        return <span className="text-gray-700 text-sm line-clamp-2">{c.text}</span>;
      }
      if (item.type === 'note' && c.note) {
        return <span className="text-gray-700 text-sm line-clamp-2">{c.note}</span>;
      }
      return <span className="text-gray-400 text-xs">{JSON.stringify(c).slice(0, 80)}</span>;
    } catch {
      return '-';
    }
  };

  return (
    <div className="p-6">
      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative w-40">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
          <input
            type="number"
            value={filterBookId}
            onChange={(e) => setFilterBookId(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleFilter()}
            placeholder="书籍ID..."
            className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <select
          value={filterType}
          onChange={(e) => { setFilterType(e.target.value); setPage(1); }}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white"
        >
          <option value="all">全部类型</option>
          <option value="highlight">高亮</option>
          <option value="note">批注</option>
          <option value="underline">下划线</option>
        </select>
        <button onClick={handleFilter} className="bg-primary text-white px-4 py-2 rounded-lg text-sm hover:bg-primaryDark">
          筛选
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-left px-4 py-3 font-medium">ID</th>
                <th className="text-left px-4 py-3 font-medium">书名</th>
                <th className="text-left px-4 py-3 font-medium">页码</th>
                <th className="text-left px-4 py-3 font-medium">类型</th>
                <th className="text-left px-4 py-3 font-medium">内容摘要</th>
                <th className="text-left px-4 py-3 font-medium">标签</th>
                <th className="text-left px-4 py-3 font-medium">创建时间</th>
                <th className="text-right px-4 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={8} className="text-center py-8 text-gray-400">加载中...</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-8 text-gray-400">暂无数据</td></tr>
              ) : items.map((item) => (
                <tr key={item.id} className="hover:bg-gray-50 transition">
                  <td className="px-4 py-3 text-gray-500">{item.id}</td>
                  <td className="px-4 py-3 max-w-[160px]">
                    <span className="truncate block text-gray-700" title={item.book?.title}>
                      {item.book?.title || `Book#${item.bookId}`}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">P{item.pageNumber}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium
                      ${item.type === 'highlight' ? 'bg-yellow-100 text-yellow-700'
                        : item.type === 'note' ? 'bg-blue-100 text-blue-700'
                        : 'bg-gray-100 text-gray-600'}`}>
                      {item.type === 'highlight' ? <Highlighter size={12} /> : <FileText size={12} />}
                      {TYPE_LABELS[item.type] || item.type}
                    </span>
                  </td>
                  <td className="px-4 py-3 max-w-[200px]">{renderContent(item)}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{item.tags || '-'}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                    {new Date(item.createdAt).toLocaleString('zh-CN')}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleDelete(item.id)}
                      className="p-1.5 text-red-400 hover:bg-red-50 rounded"
                      title="删除"
                    >
                      <Trash2 size={16} />
                    </button>
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
    </div>
  );
}
