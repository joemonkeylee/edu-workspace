import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { BookOpen, Settings } from 'lucide-react';
import BookCover from '../components/BookCover';

export default function Home() {
  const { books, fetchBooks, loading } = useStore();
  const navigate = useNavigate();
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedGrade, setSelectedGrade] = useState('all');
  const [selectedSubject, setSelectedSubject] = useState('all');

  useEffect(() => {
    fetchBooks();
  }, []);

  const categoryOptions = useMemo(() => {
    const values = new Set((books || []).map((book) => (book.category || '').trim()).filter(Boolean));
    return Array.from(values).sort();
  }, [books]);

  const gradeOptions = useMemo(() => {
    const values = new Set((books || []).map((book) => (book.grade || '').trim()).filter(Boolean));
    return Array.from(values).sort();
  }, [books]);

  const subjectOptions = useMemo(() => {
    const values = new Set((books || []).map((book) => (book.subject || '').trim()).filter(Boolean));
    return Array.from(values).sort();
  }, [books]);

  // Auto-switch selected category if current one has no books
  useEffect(() => {
    if (categoryOptions.length > 0 && !categoryOptions.includes(selectedCategory) && selectedCategory !== 'all') {
      setSelectedCategory('all');
    }
  }, [categoryOptions, selectedCategory]);

  const filteredBooks = useMemo(() => {
    return (books || []).filter((book) => {
      if (selectedCategory !== 'all' && (book.category || '') !== selectedCategory) return false;
      if (selectedGrade !== 'all' && (book.grade || '') !== selectedGrade) return false;
      if (selectedSubject !== 'all' && (book.subject || '') !== selectedSubject) return false;
      return true;
    });
  }, [books, selectedCategory, selectedGrade, selectedSubject]);

  return (
    <div className="h-full flex flex-col bg-surface">
      <header className="bg-sidebar text-white px-6 py-4 flex items-center justify-between flex-shrink-0 h-14">
        <div className="flex items-center gap-3">
          <BookOpen size={22} />
          <h1 className="text-lg font-bold">edu-workspace</h1>
        </div>
        <Link
          to="/admin"
          className="flex items-center gap-2 bg-primary hover:bg-primaryDark px-4 py-2 rounded-lg transition text-sm"
        >
          <Settings size={18} /> 后台管理
        </Link>
      </header>

      <main className="flex-1 overflow-auto p-6">
        <div className="mb-4 flex flex-wrap gap-3 items-center">
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700"
          >
            <option value="all">全部分类</option>
            {categoryOptions.map((category) => (
              <option key={category} value={category}>{category}</option>
            ))}
          </select>

          <select
            value={selectedGrade}
            onChange={(e) => setSelectedGrade(e.target.value)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700"
          >
            <option value="all">全部阶段</option>
            {gradeOptions.map((grade) => (
              <option key={grade} value={grade}>{grade}</option>
            ))}
          </select>

          <select
            value={selectedSubject}
            onChange={(e) => setSelectedSubject(e.target.value)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700"
          >
            <option value="all">全部学科</option>
            {subjectOptions.map((subject) => (
              <option key={subject} value={subject}>{subject}</option>
            ))}
          </select>
        </div>

        {loading ? (
          <p className="text-gray-500">加载中...</p>
        ) : filteredBooks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400">
            <BookOpen size={48} className="mb-4" />
            <p className="mb-2">暂无书籍</p>
            <Link to="/admin" className="text-primary hover:underline">
              前往后台导入 PDF
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-3">
            {filteredBooks.map((book) => {
              return (
                <div
                  key={book.id}
                  className="bg-white rounded-lg shadow overflow-hidden hover:shadow-md transition cursor-pointer group"
                  onClick={() => navigate(`/book/${book.id}`)}
                >
                  <div className="relative overflow-hidden" style={{ aspectRatio: '3/4' }}>
                    <BookCover
                      book={book}
                      className="w-full h-full object-cover transition group-hover:scale-[1.02]"
                    />
                    {/* Bottom overlay with title, tags, page count */}
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/50 to-transparent pt-8 pb-2 px-2">
                      <h3 className="font-medium text-xs text-white line-clamp-2 leading-tight" title={book.title}>{book.title}</h3>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {book.category && <span className="bg-blue-600/90 text-white rounded px-1 py-0.5 text-[9px]">{book.category}</span>}
                        {book.grade && <span className="bg-blue-500/80 text-white rounded px-1 py-0.5 text-[9px]">{book.grade}</span>}
                        {book.subject && <span className="bg-blue-400/80 text-white rounded px-1 py-0.5 text-[9px]">{book.subject}</span>}
                      </div>
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
      </main>
    </div>
  );
}
