import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { getBookCoverUrl } from '../api/client';
import { BookOpen, Settings, Trash2 } from 'lucide-react';

const DEFAULT_CATEGORY = '学习';

export default function Home() {
  const { books, fetchBooks, removeBook, loading } = useStore();
  const navigate = useNavigate();
  const [selectedCategory, setSelectedCategory] = useState(DEFAULT_CATEGORY);
  const [selectedFilters, setSelectedFilters] = useState<Record<string, string>>({});

  useEffect(() => {
    fetchBooks();
  }, []);

  const categoryOptions = useMemo(() => {
    const values = new Set((books || []).map((book) => (book.category || DEFAULT_CATEGORY).trim()).filter(Boolean));
    return Array.from(values).sort();
  }, [books]);

  const attributeKeys = useMemo(() => {
    const keys = new Set<string>();
    const currentCategoryBooks = (books || []).filter((book) => (book.category || DEFAULT_CATEGORY) === selectedCategory);
    currentCategoryBooks.forEach((book) => {
      if (book.grade) keys.add('grade');
      if (book.subject) keys.add('subject');
      const attrs = book.attributes || {};
      Object.keys(attrs || {}).forEach((key) => keys.add(key));
    });
    return Array.from(keys).sort();
  }, [books, selectedCategory]);

  const attributeOptions = useMemo(() => {
    const map: Record<string, Set<string>> = {};
    const currentCategoryBooks = (books || []).filter((book) => (book.category || DEFAULT_CATEGORY) === selectedCategory);

    currentCategoryBooks.forEach((book) => {
      const attrs = typeof book.attributes === 'object' && book.attributes ? book.attributes as Record<string, any> : {};
      const entries = [...attributeKeys];
      entries.forEach((key) => {
        const value = key === 'grade' ? book.grade : key === 'subject' ? book.subject : attrs[key];
        if (value !== undefined && value !== null && value !== '') {
          map[key] ??= new Set<string>();
          map[key].add(String(value));
        }
      });
    });

    return Object.fromEntries(
      Object.entries(map).map(([key, values]) => [key, Array.from(values).sort()])
    );
  }, [attributeKeys, books, selectedCategory]);

  const filteredBooks = useMemo(() => {
    return (books || []).filter((book) => {
      const matchCategory = (book.category || DEFAULT_CATEGORY) === selectedCategory;
      if (!matchCategory) return false;
      return attributeKeys.every((key) => {
        const selected = selectedFilters[key];
        if (!selected || selected === 'all') return true;
        const value = key === 'grade' ? book.grade : key === 'subject' ? book.subject : (book.attributes as Record<string, any> | undefined)?.[key];
        return String(value ?? '') === selected;
      });
    });
  }, [attributeKeys, books, selectedCategory, selectedFilters]);

  const setFilter = (key: string, value: string) => {
    setSelectedFilters((prev) => ({ ...prev, [key]: value }));
  };

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
        <div className="mb-4 flex flex-wrap gap-3 items-center">
          <select
            value={selectedCategory}
            onChange={(e) => {
              setSelectedCategory(e.target.value);
              setSelectedFilters({});
            }}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700"
          >
            {categoryOptions.map((category) => (
              <option key={category} value={category}>{category}</option>
            ))}
          </select>

          {attributeKeys.map((key) => {
            const options = attributeOptions[key] || [];
            return (
              <select
                key={key}
                value={selectedFilters[key] || 'all'}
                onChange={(e) => setFilter(key, e.target.value)}
                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700"
              >
                <option value="all">全部{key}</option>
                {options.map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            );
          })}
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
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {filteredBooks.map((book) => {
              const coverUrl = getBookCoverUrl(book, book.coverPage || 1);

              return (
                <div
                  key={book.id}
                  className="bg-white rounded-lg shadow p-4 hover:shadow-md transition cursor-pointer group"
                  onClick={() => navigate(`/book/${book.id}`)}
                >
                  <div className="mb-3 overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
                    <img
                      src={coverUrl}
                      alt={book.title}
                      className="h-48 w-full object-cover transition group-hover:scale-[1.02]"
                      onError={(e) => {
                        const target = e.target as HTMLImageElement;
                        target.onerror = null;
                        target.src = getBookCoverUrl(book, 1);
                      }}
                    />
                  </div>
                  <div className="flex items-start justify-between mb-2">
                    <div className="bg-primary/10 rounded-lg p-2">
                      <BookOpen className="text-primary" size={20} />
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
                  <h3 className="font-semibold text-sm truncate" title={book.title}>{book.title}</h3>
                  <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
                    {book.grade && <span className="bg-blue-50 text-blue-600 rounded px-1.5 py-0.5">{book.grade}</span>}
                    {book.subject && <span className="bg-amber-50 text-amber-600 rounded px-1.5 py-0.5">{book.subject}</span>}
                  </div>
                  <p className="text-xs text-gray-500 mt-1">{book.category}</p>
                  <p className="text-xs text-gray-400 mt-1">{book.totalPages} 页</p>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
