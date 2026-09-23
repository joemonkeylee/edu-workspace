import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Button } from "@/components/ui/button"
import { GraduationCap, BookOpen, Highlighter, AlertCircle, ClipboardList, Link2, Scan, Users, ShieldCheck, FolderCog, Database, LogOut } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { cn } from '@/lib/utils';
import { Separator } from '@/components/ui/separator';

interface MenuItem {
  path: string;
  label: string;
  icon: LucideIcon;
  roles?: string[];
}

interface MenuGroup {
  key: string;
  label: string;
  icon: LucideIcon;
  items: MenuItem[];
}

const MENU_GROUPS: MenuGroup[] = [
  {
    key: 'data',
    label: '数据',
    icon: BookOpen,
    items: [
      { path: '/admin/scan', label: 'PDF 扫描导入', icon: Scan, roles: ['admin'] },
      { path: '/admin/books', label: '书籍资产', icon: BookOpen },
      { path: '/admin/book-pairs', label: '教材配对', icon: Link2 },
      { path: '/admin/annotations', label: '批注数据', icon: Highlighter },
      { path: '/admin/mistakes', label: '错题本', icon: AlertCircle },
      { path: '/admin/assignments', label: '作业管理', icon: ClipboardList },
    ],
  },
  {
    key: 'system',
    label: '系统',
    icon: ShieldCheck,
    items: [
      { path: '/admin/users', label: '用户管理', icon: Users, roles: ['admin'] },
      { path: '/admin/auth-settings', label: '认证设置', icon: ShieldCheck, roles: ['admin'] },
      { path: '/admin/storage', label: '资源目录', icon: FolderCog, roles: ['admin'] },
      { path: '/admin/db-backup', label: '数据库备份', icon: Database, roles: ['admin'] },
    ],
  },
];

function getActiveGroupKey(pathname: string, groups: MenuGroup[]): string {
  for (const group of groups) {
    if (group.items.some((item) => pathname.startsWith(item.path))) return group.key;
  }
  return groups[0].key;
}

export default function AdminLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout, authEnabled } = useAuthStore();

  const userRoles = Array.isArray(user?.roles) && user.roles.length > 0
    ? user.roles
    : [user?.role || (user?.isAdmin ? 'admin' : 'student')];

  const filteredGroups = MENU_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !authEnabled || !item.roles || item.roles.some((r) => userRoles.includes(r))),
  })).filter((group) => group.items.length > 0);

  const activeGroupKey = getActiveGroupKey(location.pathname, filteredGroups);
  const activeGroup = filteredGroups.find((g) => g.key === activeGroupKey) ?? filteredGroups[0];

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const roleBadge = (() => {
    if (!authEnabled) return '';
    if (userRoles.includes('admin')) return '管理员';
    if (userRoles.includes('teacher')) return '教师';
    return '';
  })();

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Top Header */}
      <header className="flex h-14 flex-shrink-0 items-center bg-sidebar px-4 text-sidebar-foreground border-b border-sidebar-border">
        <Link to="/" className="flex items-center gap-2 mr-6">
          <GraduationCap size={22} />
          <span className="text-lg font-normal">edu-workspace</span>
        </Link>

        {/* Top-level tabs */}
        <div className="flex items-center gap-1">
          {filteredGroups.map((group) => (
            <button
              key={group.key}
              onClick={() => {
                const firstItem = group.items[0];
                if (firstItem) navigate(firstItem.path);
              }}
              className={cn(
                'flex items-center gap-1.5 h-8 px-3 rounded-md text-sm transition',
                activeGroupKey === group.key
                  ? 'bg-sidebar-accent text-sidebar-foreground font-medium'
                  : 'text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50'
              )}
            >
              <group.icon size={14} />
              {group.label}
            </button>
          ))}
        </div>

        <div className="mx-auto" />

        {/* Right side: user + logout */}
        {authEnabled && user && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-sidebar-foreground/70">
              {user.nickName || user.phone}
              {roleBadge && (
                <span className="ml-1.5 rounded bg-sidebar-accent px-1.5 py-0.5 text-[10px] font-medium text-sidebar-foreground/80">
                  {roleBadge}
                </span>
              )}
            </span>
            <Button variant="ghost" size="icon" onClick={handleLogout} title="退出登录" className="h-8 w-8 text-sidebar-foreground/70 hover:text-sidebar-foreground">
              <LogOut size={16} />
            </Button>
            <Link to="/" target="_blank" rel="noopener noreferrer"
              className="flex h-8 w-8 items-center justify-center rounded-md text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent transition"
              title="返回前台">
              <GraduationCap size={16} />
            </Link>
          </div>
        )}
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar: secondary menu */}
        <nav className="flex-shrink-0 w-[140px] py-3 bg-sidebar border-r border-sidebar-border overflow-y-auto">
          {activeGroup?.items.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) =>
                  cn(
                    'mx-2 mb-1 flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition',
                    isActive
                      ? 'bg-sidebar-accent text-sidebar-foreground font-medium'
                      : 'text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50'
                  )
                }
              >
                <Icon size={15} />
                {item.label}
              </NavLink>
            );
          })}
        </nav>

        {/* Main content */}
        <main className="flex-1 overflow-auto bg-background">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
