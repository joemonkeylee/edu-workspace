import { useState, useEffect, useCallback } from 'react';
import { adminGetBooks, adminUpdateBook, adminDeleteBook } from '../../api/client';
import { Search, Edit3, Trash2, Check, X, ChevronLeft, ChevronRight, BookOpen } from 'lucide-react';

const PAGE_SIZE = 10;

export default function BooksTable() {
  const [books, setBooks] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editCategory, setEditCategory] = useState('');

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
    setEditCategory(book.category);
  };
  const cancelEdit = () => setEditingId(null);

  const saveEdit = async (id: number) => {
    await adminUpdateBook(id, { title: editTitle, category: editCategory });
    setEditingId(null);
    fetch();
  };

  const handleDelete = async (id: number, title: string) => {
    if (!confirm(`删除「${title}」？将同时清理所有切图、批注和错题。`)) return;
    await adminDeleteBook(id);
    fetch();
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
                <th className="text-left px-4 py-3 font-medium">入库时间</th>
                <th className="text-right px-4 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={6} className="text-center py-8 text-gray-400">加载中...</td></tr>
              ) : books.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-8 text-gray-400">暂无数据</td></tr>
              ) : books.map((book) => (
                <tr key={book.id} className="hover:bg-gray-50 transition">
                  <td className="px-4 py-3">
                    <img
                      src={`${book.storagePath}page-0001.png`}
                      alt={book.title}
                      className="w-12 h-16 object-cover rounded border border-gray-200"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  </td>
                  <td className="px-4 py-3 max-w-xs">
                    {editingId === book.id ? (
                      <input
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                    ) : (
                      <span className="truncate block" title={book.title}>{book.title}</span>
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
                        <button onClick={() => startEdit(book)} className="p-1.5 text-blue-500 hover:bg-blue-50 rounded" title="编辑">
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
    </div>
  );
}
