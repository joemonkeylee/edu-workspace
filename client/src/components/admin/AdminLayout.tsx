import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Scan, BookOpen, Highlighter, AlertCircle, ClipboardList, FolderCog, Users, LogOut, ShieldCheck, Link2, Database } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';

interface MenuItem {
  path: string;
  label: string;
  icon: LucideIcon;
  roles?: string[]; // roles allowed to see this item; undefined = all
}

interface MenuGroup {
  group: string;
  items: MenuItem[];
}

const MENU_GROUPS: MenuGroup[] = [
  {
    group: '数据管理',
    items: [
      { path: '/admin/scan', label: 'PDF 扫描导入', icon: Scan, roles: ['admin'] },
      { path: '/admin/books', label: '书籍资产管理', icon: BookOpen },
      { path: '/admin/book-pairs', label: '教材答案配对', icon: Link2 },
      { path: '/admin/annotations', label: '批注数据管理', icon: Highlighter },
      { path: '/admin/mistakes', label: '错题本管理', icon: AlertCircle },
      { path: '/admin/assignments', label: '作业管理', icon: ClipboardList },
    ],
  },
  {
    group: '系统管理',
    items: [
      { path: '/admin/users', label: '用户管理', icon: Users, roles: ['admin'] },
      { path: '/admin/auth-settings', label: '认证设置', icon: ShieldCheck, roles: ['admin'] },
      { path: '/admin/storage', label: '资源目录', icon: FolderCog, roles: ['admin'] },
      { path: '/admin/db-backup', label: '数据库备份', icon: Database, roles: ['admin'] },
    ],
  },
];

const ALL_ITEMS = MENU_GROUPS.flatMap((g) => g.items);

export default function AdminLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout, authEnabled } = useAuthStore();

  // Filter menu groups by user role (in standalone mode, show all items)
  const userRoles = Array.isArray(user?.roles) && user.roles.length > 0
    ? user.roles
    : [user?.role || (user?.isAdmin ? 'admin' : 'student')];
  const filteredMenuGroups = MENU_GROUPS
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !authEnabled || !item.roles || item.roles.some((r) => userRoles.includes(r))),
    }))
    .filter((group) => group.items.length > 0);

  const allFilteredItems = filteredMenuGroups.flatMap((g) => g.items);
  const activeItem = allFilteredItems.find((item) => location.pathname.startsWith(item.path));
  const title = activeItem?.label ?? '后台管理';

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const roleBadge = (() => {
    if (!authEnabled) return '';
    const roles = Array.isArray(user?.roles) && user.roles.length > 0
      ? user.roles
      : [user?.role || (user?.isAdmin ? 'admin' : 'student')];
    if (roles.includes('admin')) return ' (管理员)';
    if (roles.includes('teacher')) return ' (教师)';
    return '';
  })();

  return (
    <div className="flex flex-col h-full bg-surface">
      <header className="flex items-center flex-shrink-0 gap-4 px-6 py-4 text-white bg-sidebar h-14">
        <Link to="/" className="flex items-center gap-2 text-gray-300 transition hover:text-white">
          <ArrowLeft size={20} />
        </Link>
        <h1 className="text-lg font-bold">后台 · {title}</h1>
        {authEnabled && user && (
          <div className="flex items-center gap-3 ml-auto">
            <span className="text-sm text-gray-300">{user.nickName || user.phone}{roleBadge}</span>
            <button onClick={handleLogout} className="flex items-center gap-1 text-sm text-gray-300 transition hover:text-white" title="退出登录">
              <LogOut size={16} />
            </button>
          </div>
        )}
      </header>

      <div className="flex flex-1 overflow-hidden">
        <nav className="flex-shrink-0 w-48 py-4 overflow-y-auto bg-white border-r border-gray-200">
          {filteredMenuGroups.map((group) => (
            <div key={group.group} className="mb-4">
              <p className="px-4 pb-2 text-xs font-medium tracking-wider text-gray-400 uppercase">{group.group}</p>
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    className={({ isActive }) =>
                      `w-full flex items-center gap-3 px-4 py-2.5 text-sm font-medium transition border-l-2 ${
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
            </div>
          ))}
        </nav>

        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
