import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Trash2, CheckSquare, Square, ExternalLink, ChevronLeft, ChevronRight } from 'lucide-react';
import { adminDeleteAssignment, adminDeleteAssignmentsBatch, adminGetAssignments } from '../../api/client';
import { formatAssignmentTitle } from '../../utils/assignment';

const PAGE_SIZE = 20;

function formatDate(value: string) {
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

export default function AssignmentsTable() {
  const navigate = useNavigate();
  const [items, setItems] = useState<any[]>([]);
  const [books, setBooks] = useState<{ id: number; title: string }[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('submitted');
  const [filterBook, setFilterBook] = useState('all');
  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  const fetchAssignments = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = { page, pageSize: PAGE_SIZE };
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
  }, [page, search, filterStatus, filterBook]);

  useEffect(() => { fetchAssignments(); }, [fetchAssignments]);

  const allSelected = items.length > 0 && items.every((item) => selectedIds.includes(item.id));
  const totalPages = Math.ceil(total / PAGE_SIZE) || 1;

  const toggleAll = () => {
    setSelectedIds(allSelected ? [] : items.map((item) => item.id));
  };

  const toggleSelected = (id: number) => {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('确认删除此作业吗？学生笔迹和教师批改笔迹都会被删除，且无法恢复。')) return;
    await adminDeleteAssignment(id);
    fetchAssignments();
  };

  const handleBatchDelete = async () => {
    if (selectedIds.length === 0) return;
    if (!window.confirm(`确认删除选中的 ${selectedIds.length} 个作业吗？相关笔迹都会被删除，且无法恢复。`)) return;
    await adminDeleteAssignmentsBatch(selectedIds);
    fetchAssignments();
  };

  return (
    <div className="p-6">
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            onKeyDown={(e) => e.key === 'Enter' && fetchAssignments()}
            placeholder="搜索作业、书名或学科..."
            className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
          {[
            { value: 'all', label: '全部' },
            { value: 'draft', label: '草稿' },
            { value: 'submitted', label: '已提交' },
            { value: 'returned', label: '已打回' },
            { value: 'graded', label: '已批改' },
          ].map((tab) => (
            <button
              key={tab.value}
              onClick={() => { setFilterStatus(tab.value); setPage(1); }}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${
                filterStatus === tab.value
                  ? 'bg-white text-primary shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <select
          value={filterBook}
          onChange={(e) => { setFilterBook(e.target.value); setPage(1); }}
          className="max-w-64 px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="all">全部书籍</option>
          {books.map((book) => <option key={book.id} value={book.id}>{book.title}</option>)}
        </select>
        <button onClick={fetchAssignments} className="bg-primary text-white px-4 py-2 rounded-lg text-sm hover:bg-primaryDark">
          筛选
        </button>
        <button
          onClick={handleBatchDelete}
          disabled={selectedIds.length === 0}
          className="ml-auto inline-flex items-center gap-1 bg-red-500 text-white px-3 py-2 rounded-lg text-sm hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Trash2 size={15} /> 批量删除 ({selectedIds.length})
        </button>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="w-12 px-4 py-3 text-center">
                  <button onClick={toggleAll} title={allSelected ? '取消全选' : '全选'} className="text-gray-500 hover:text-primary">
                    {allSelected ? <CheckSquare size={17} /> : <Square size={17} />}
                  </button>
                </th>
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
                <tr><td colSpan={8} className="text-center py-8 text-gray-400">加载中...</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-8 text-gray-400">暂无作业</td></tr>
              ) : items.map((item) => (
                <tr key={item.id} className="hover:bg-gray-50 transition">
                  <td className="px-4 py-3 text-center">
                    <button onClick={() => toggleSelected(item.id)} className="text-gray-500 hover:text-primary">
                      {selectedIds.includes(item.id) ? <CheckSquare size={17} /> : <Square size={17} />}
                    </button>
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-800 whitespace-nowrap">
                    {formatAssignmentTitle(item.title) || `作业 #${item.id}`}
                  </td>
                  <td className="px-4 py-3 text-gray-700 max-w-56 truncate" title={item.book?.title}>{item.book?.title || '-'}</td>
                  <td className="px-4 py-3 text-gray-600">{item.subject || '-'}</td>
                  <td className="px-4 py-3 text-gray-600">{item._count?.strokes ?? 0}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                      item.status === 'graded' ? 'bg-green-100 text-green-700'
                        : item.status === 'submitted' ? 'bg-blue-100 text-blue-700'
                        : item.status === 'returned' ? 'bg-amber-100 text-amber-700'
                        : 'bg-gray-100 text-gray-600'
                    }`}>
                      {item.status === 'graded' ? '已批改' : item.status === 'submitted' ? '已提交' : item.status === 'returned' ? '已打回' : '草稿'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{formatDate(item.createdAt)}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button
                      onClick={() => navigate(`/book/${item.bookId}?assignmentId=${item.id}&grading=1`)}
                      className="inline-flex items-center gap-1 p-1.5 text-primary hover:bg-primary/10 rounded"
                      title="进入批改"
                    >
                      <ExternalLink size={16} />
                    </button>
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

        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
            <span className="text-sm text-gray-500">共 {total} 条</span>
            <div className="flex items-center gap-2">
              <button onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1} className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-30"><ChevronLeft size={18} /></button>
              <span className="text-sm text-gray-600">{page} / {totalPages}</span>
              <button onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={page >= totalPages} className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-30"><ChevronRight size={18} /></button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
