import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Scan, BookOpen, Highlighter, AlertCircle } from 'lucide-react';
import PdfScanImport from '../components/admin/PdfScanImport';
import BooksTable from '../components/admin/BooksTable';
import AnnotationsTable from '../components/admin/AnnotationsTable';
import MistakesTable from '../components/admin/MistakesTable';

type MenuKey = 'scan' | 'books' | 'annotations' | 'mistakes';

const MENU_ITEMS: { key: MenuKey; label: string; icon: React.ReactNode }[] = [
  { key: 'scan', label: 'PDF 扫描导入', icon: <Scan size={18} /> },
  { key: 'books', label: '书籍资产管理', icon: <BookOpen size={18} /> },
  { key: 'annotations', label: '批注数据管理', icon: <Highlighter size={18} /> },
  { key: 'mistakes', label: '错题本管理', icon: <AlertCircle size={18} /> },
];

const TITLES: Record<MenuKey, string> = {
  scan: 'PDF 扫描导入',
  books: '书籍资产管理',
  annotations: '批注数据管理',
  mistakes: '错题本数据管理',
};

export default function AdminPanel() {
  const [active, setActive] = useState<MenuKey>('scan');

  return (
    <div className="h-full flex flex-col bg-surface">
      {/* Header */}
      <header className="bg-sidebar text-white px-6 py-4 flex items-center gap-4 flex-shrink-0 h-14">
        <Link to="/" className="flex items-center gap-2 text-gray-300 hover:text-white transition">
          <ArrowLeft size={20} /> 返回
        </Link>
        <h1 className="text-lg font-bold">后台管理 · {TITLES[active]}</h1>
      </header>

      {/* Body: sidebar + content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <nav className="w-48 bg-white border-r border-gray-200 flex-shrink-0 py-4">
          {MENU_ITEMS.map((item) => (
            <button
              key={item.key}
              onClick={() => setActive(item.key)}
              className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-medium transition border-l-2 ${
                active === item.key
                  ? 'border-primary text-primary bg-primary/5'
                  : 'border-transparent text-gray-600 hover:bg-gray-50'
              }`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </nav>

        {/* Content */}
        <main className="flex-1 overflow-auto">
          {active === 'scan' && <PdfScanImport />}
          {active === 'books' && <BooksTable />}
          {active === 'annotations' && <AnnotationsTable />}
          {active === 'mistakes' && <MistakesTable />}
        </main>
      </div>
    </div>
  );
}
