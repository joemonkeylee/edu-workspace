import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { ArrowLeft, Scan, BookOpen, Highlighter, AlertCircle, FolderCog } from 'lucide-react';

const MENU_ITEMS = [
  { path: '/admin/scan', label: 'PDF 扫描导入', icon: Scan },
  { path: '/admin/books', label: '书籍资产管理', icon: BookOpen },
  { path: '/admin/annotations', label: '批注数据管理', icon: Highlighter },
  { path: '/admin/mistakes', label: '错题本管理', icon: AlertCircle },
  { path: '/admin/storage', label: '资源目录设置', icon: FolderCog },
];

export default function AdminLayout() {
  const location = useLocation();
  const activeItem = MENU_ITEMS.find((item) => location.pathname.startsWith(item.path));
  const title = activeItem?.label ?? '后台管理';

  return (
    <div className="h-full flex flex-col bg-surface">
      <header className="bg-sidebar text-white px-6 py-4 flex items-center gap-4 flex-shrink-0 h-14">
        <Link to="/" className="flex items-center gap-2 text-gray-300 hover:text-white transition">
          <ArrowLeft size={20} />
        </Link>
        <h1 className="text-lg font-bold">后台 · {title}</h1>
      </header>

      <div className="flex-1 flex overflow-hidden">
        <nav className="w-48 bg-white border-r border-gray-200 flex-shrink-0 py-4">
          {MENU_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) =>
                  `w-full flex items-center gap-3 px-4 py-3 text-sm font-medium transition border-l-2 ${
                    isActive
                      ? 'border-primary text-primary bg-primary/5'
                      : 'border-transparent text-gray-600 hover:bg-gray-50'
                  }`
                }
              >
                <Icon size={18} />
                {item.label}
              </NavLink>
            );
          })}
        </nav>

        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
