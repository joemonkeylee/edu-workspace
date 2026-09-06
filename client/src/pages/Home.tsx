import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { BookOpen, Settings, ChevronLeft, ChevronRight, X } from 'lucide-react';
import BookCover from '../components/BookCover';

const PAGE_SIZE = 16; // 2 rows × 8 cols
const STORAGE_KEY = 'edu-home-filters';

const SUBJECT_ORDER = ['语文', '数学', '英语', '物理', '化学', '生物', '政治', '历史', '地理', '科学', '道法'];
const GRADE_ORDER = ['七上', '七下', '八上', '八下', '九上', '九下'];

interface SavedFilters {
  subject: string;
  grade: string;
  category: string;
}

function loadSavedFilters(): SavedFilters {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as SavedFilters;
  } catch { /* ignore */ }
  return { subject: '', grade: '', category: '' };
}

/** Native <select> with a clear (×) button; empty value means "no filter". */
function ClearableSelect({
  value,
  onChange,
  placeholder,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  options: string[];
}) {
  return (
    <div className="relative w-44">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full appearance-none rounded-lg border border-gray-300 bg-white py-2 pl-3 pr-9 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary"
      >
        <option value="">{placeholder}</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
      {/* dropdown arrow */}
      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400">
        ▾
      </span>
      {/* clear button */}
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="absolute right-7 top-1/2 -translate-y-1/2 flex h-4 w-4 items-center justify-center rounded-full bg-gray-300 text-white hover:bg-gray-400"
          title="清除"
        >
          <X size={10} strokeWidth={3} />
        </button>
      )}
    </div>
  );
}

export default function Home() {
  const { books, fetchBooks, loading } = useStore();
  const navigate = useNavigate();

  const saved = useMemo(loadSavedFilters, []);
  const [selectedSubject, setSelectedSubject] = useState(saved.subject);
  const [selectedGrade, setSelectedGrade] = useState(saved.grade);
  const [selectedCategory, setSelectedCategory] = useState(saved.category);
  const [page, setPage] = useState(1);

  useEffect(() => {
    fetchBooks();
  }, []);

  // Persist filters to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      subject: selectedSubject,
      grade: selectedGrade,
      category: selectedCategory,
    }));
  }, [selectedSubject, selectedGrade, selectedCategory]);

  const subjectOptions = useMemo(() => {
    const values = new Set((books || []).map((book) => (book.subject || '').trim()).filter(Boolean));
    return Array.from(values).sort(
      (a, b) => (SUBJECT_ORDER.indexOf(a) + 1 || 999) - (SUBJECT_ORDER.indexOf(b) + 1 || 999)
    );
  }, [books]);

  const gradeOptions = useMemo(() => {
    const values = new Set((books || []).map((book) => (book.grade || '').trim()).filter(Boolean));
    return Array.from(values).sort(
      (a, b) => (GRADE_ORDER.indexOf(a) + 1 || 999) - (GRADE_ORDER.indexOf(b) + 1 || 999)
    );
  }, [books]);

  const categoryOptions = useMemo(() => {
    const values = new Set((books || []).map((book) => (book.category || '').trim()).filter(Boolean));
    return Array.from(values).sort();
  }, [books]);

  const filteredBooks = useMemo(() => {
    return (books || []).filter((book) => {
      if (selectedSubject && (book.subject || '') !== selectedSubject) return false;
      if (selectedGrade && (book.grade || '') !== selectedGrade) return false;
      if (selectedCategory && (book.category || '') !== selectedCategory) return false;
      return true;
    });
  }, [books, selectedSubject, selectedGrade, selectedCategory]);

  // Reset to page 1 whenever filters change
  useEffect(() => {
    setPage(1);
  }, [selectedSubject, selectedGrade, selectedCategory]);

  const totalPages = Math.max(1, Math.ceil(filteredBooks.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedBooks = useMemo(
    () => filteredBooks.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filteredBooks, safePage]
  );

  const goPrev = () => setPage((p) => Math.max(1, p - 1));
  const goNext = () => setPage((p) => Math.min(totalPages, p + 1));

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
        {/* Filters: 学科 → 学期 → 分类 */}
        <div className="mb-4 flex flex-wrap gap-3 items-center">
          <ClearableSelect
            value={selectedSubject}
            onChange={setSelectedSubject}
            placeholder="全部学科"
            options={subjectOptions}
          />
          <ClearableSelect
            value={selectedGrade}
            onChange={setSelectedGrade}
            placeholder="全部学期"
            options={gradeOptions}
          />
          <ClearableSelect
            value={selectedCategory}
            onChange={setSelectedCategory}
            placeholder="全部分类"
            options={categoryOptions}
          />
          <span className="text-sm text-gray-500 ml-1">
            共 {filteredBooks.length} 本
          </span>
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
          <>
            <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-8 gap-3">
              {pagedBooks.map((book) => {
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
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/50 to-transparent pt-8 pb-2 px-2">
                        <h3 className="font-medium text-xs text-white line-clamp-2 leading-tight" title={book.title}>{book.title}</h3>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {book.subject && <span className="bg-emerald-500/90 text-white rounded px-1 py-0.5 text-[9px]">{book.subject}</span>}
                          {book.grade && <span className="bg-blue-500/80 text-white rounded px-1 py-0.5 text-[9px]">{book.grade}</span>}
                          {book.category && <span className="bg-violet-500/80 text-white rounded px-1 py-0.5 text-[9px]">{book.category}</span>}
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

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="mt-5 flex items-center justify-center gap-2">
                <button
                  onClick={goPrev}
                  disabled={safePage <= 1}
                  className="flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ChevronLeft size={16} /> 上一页
                </button>
                <span className="text-sm text-gray-600">
                  {safePage} / {totalPages}
                </span>
                <button
                  onClick={goNext}
                  disabled={safePage >= totalPages}
                  className="flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  下一页 <ChevronRight size={16} />
                </button>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
