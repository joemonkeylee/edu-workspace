import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { BookOpen, Settings, Trash2 } from 'lucide-react';

export default function Home() {
  const { books, fetchBooks, removeBook, loading } = useStore();
  const navigate = useNavigate();

  useEffect(() => {
    fetchBooks();
  }, []);

  return (
    <div className="h-full flex flex-col bg-surface">
      <header className="bg-sidebar text-white px-6 py-4 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <BookOpen size={24} />
          <h1 className="text-xl font-bold">edu-workspace</h1>
          <span className="text-gray-400 text-sm">学习与错题管理</span>
        </div>
        <Link
          to="/admin"
          className="flex items-center gap-2 bg-primary hover:bg-primaryDark px-4 py-2 rounded-lg transition text-sm"
        >
          <Settings size={18} /> 后台管理
        </Link>
      </header>

      <main className="flex-1 overflow-auto p-6">
        {loading ? (
          <p className="text-gray-500">加载中...</p>
        ) : books.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400">
            <BookOpen size={48} className="mb-4" />
            <p className="mb-2">暂无书籍</p>
            <Link to="/admin" className="text-primary hover:underline">
              前往后台导入 PDF
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {books.map((book) => (
              <div
                key={book.id}
                className="bg-white rounded-lg shadow p-4 hover:shadow-md transition cursor-pointer group"
                onClick={() => navigate(`/book/${book.id}`)}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="bg-primary/10 rounded-lg p-2">
                    <BookOpen className="text-primary" size={28} />
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`删除「${book.title}」？`)) removeBook(book.id);
                    }}
                    className="text-gray-300 hover:text-red-500 transition"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
                <h3 className="font-semibold text-sm truncate" title={book.title}>
                  {book.title}
                </h3>
                <p className="text-xs text-gray-500 mt-1">{book.category}</p>
                <p className="text-xs text-gray-400 mt-1">{book.totalPages} 页</p>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
