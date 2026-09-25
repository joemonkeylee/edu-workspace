import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Button } from "@/components/ui/button"
import { GraduationCap, BookOpen, Highlighter, AlertCircle, ClipboardList, Link2, Scan, Users, ShieldCheck, FolderCog, Database, LogOut, PanelLeftClose, LayoutDashboard } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { cn } from '@/lib/utils';
import { ThemeSwitcher } from '@/components/ThemeSwitcher';
import WebVitalsInfoPanel from '@/english/components/WebVitalsInfoPanel';
import { convertMetricToVitalInfo, reportWebVitals, type Metric } from '@/english/metrics';

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
      // /admin 就是概览页。放在首位，点顶部的「数据」分组也会回到这里。
      { path: '/admin', label: '概览', icon: LayoutDashboard },
      { path: '/admin/scan', label: 'PDF切图', icon: Scan, roles: ['admin'] },
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
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setCollapsed((c) => !c);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const [vitals, setVitals] = useState<ReturnType<typeof convertMetricToVitalInfo>[]>([]);
  useEffect(() => {
    reportWebVitals((metric: Metric) => {
      const info = convertMetricToVitalInfo(metric);
      setVitals((prev) => {
        const filtered = prev.filter((v) => v.name !== metric.name);
        return [...filtered, info];
      });
    });
  }, []);

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
    <div className="flex h-full bg-surface">
      {/* Left sidebar: native, logo header mirrors the front-site header exactly */}
      <aside
        className={cn(
          "relative flex flex-shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200",
          collapsed ? "w-12" : "w-60"
        )}
      >
        {/* Logo header: same structure/padding as Home header (h-14, px-6, no border) */}
        <header className={cn("flex h-14 flex-shrink-0 items-center", collapsed ? "justify-center" : "px-6")}>
          <Link to="/" className="flex items-center gap-2 text-sidebar-foreground hover:text-sidebar-foreground/80">
            <GraduationCap size={22} />
            {!collapsed && <span className="truncate text-lg font-normal">edu-workspace</span>}
          </Link>
        </header>

        {/* Secondary menu (grouped by active top tab) */}
        <nav className="flex-1 overflow-auto border-t border-sidebar-border p-2">
          {activeGroup?.items.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                end
                title={item.label}
                className={({ isActive }) =>
                  cn(
                    "mb-0.5 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition",
                    isActive
                      ? "bg-sidebar-accent font-medium text-sidebar-foreground"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
                    collapsed && "justify-center px-0"
                  )
                }
              >
                <Icon size={15} />
                {!collapsed && <span>{item.label}</span>}
              </NavLink>
            );
          })}
        </nav>

        {/* Collapse toggle on the sidebar/main boundary */}
        <button
          onClick={() => setCollapsed((c) => !c)}
          title="收起/展开侧边栏 (⌘B)"
          className="absolute top-1/2 -right-3 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md border border-sidebar-border bg-sidebar hover:bg-sidebar-accent"
        >
          <PanelLeftClose size={14} className={cn("opacity-70 transition-transform", collapsed && "rotate-180")} />
        </button>
      </aside>

      {/* Main area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top header: primary tabs + user */}
        <header className="flex h-14 flex-shrink-0 items-center gap-2 border-b border-sidebar-border bg-sidebar px-4 text-sidebar-foreground">
          {/* Top-level tabs */}
          <div className="flex items-center gap-1">
            {filteredGroups.map((group) => {
              const GroupIcon = group.icon;
              return (
                <button
                  key={group.key}
                  onClick={() => {
                    const firstItem = group.items[0];
                    if (firstItem) navigate(firstItem.path);
                  }}
                  className={cn(
                    'flex h-7 items-center gap-1.5 rounded-md px-3 text-sm transition',
                    activeGroupKey === group.key
                      ? 'bg-sidebar-accent font-medium text-sidebar-foreground'
                      : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
                  )}
                >
                  <GroupIcon size={14} />
                  {group.label}
                </button>
              );
            })}
          </div>

          <div className="mx-auto" />

          {/* Right side: theme + vitals + user + logout */}
          <div className="flex items-center gap-2">
            <ThemeSwitcher />
            <WebVitalsInfoPanel vitals={vitals} />
            {authEnabled && user && (
              <>
                <div className="mx-1 h-5 w-px bg-sidebar-border" />
                <span className="text-sm text-sidebar-foreground/70">
                  {user.nickName || user.phone}
                  {roleBadge && (
                    <span className="ml-1.5 rounded bg-sidebar-accent px-1.5 py-0.5 text-[10px] font-medium text-sidebar-foreground/80">
                      {roleBadge}
                    </span>
                  )}
                </span>
                <Button variant="ghost" size="icon" onClick={handleLogout} title="退出登录" className="h-7 w-7 text-sidebar-foreground/70 hover:text-sidebar-foreground">
                  <LogOut size={16} />
                </Button>
              </>
            )}
          </div>
        </header>

        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
