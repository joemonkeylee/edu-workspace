import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Button } from "@/components/ui/button"
import {
  Sidebar, SidebarContent, SidebarHeader, SidebarFooter,
  SidebarMenu, SidebarMenuButton, SidebarGroup,
  SidebarProvider, SidebarInset, SidebarTrigger, SidebarRail,
} from "@/components/ui/sidebar"
import { GraduationCap, BookOpen, Highlighter, AlertCircle, ClipboardList, Link2, Scan, Users, ShieldCheck, FolderCog, Database, LogOut } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { cn } from '@/lib/utils';

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
    <SidebarProvider defaultOpen={true}>
      <Sidebar variant="inset" collapsible="icon">
        {/* Sidebar Header: only logo */}
        <SidebarHeader className="!p-0 !gap-0 h-14 border-b border-sidebar-border">
          <Link to="/" className="flex h-full items-center gap-2 px-2 text-sidebar-foreground hover:text-sidebar-foreground/80 group-data-[collapsible=icon]:justify-center">
            <GraduationCap size={22} />
            <span className="text-base font-medium truncate group-data-[collapsible=icon]:hidden">edu-workspace</span>
          </Link>
        </SidebarHeader>

        {/* Sidebar Content: secondary menu (grouped by active tab) */}
        <SidebarContent>
          <SidebarGroup>
            <SidebarMenu>
              {activeGroup?.items.map((item) => {
                const Icon = item.icon;
                return (
                  <SidebarMenuButton asChild tooltip={item.label} key={item.path}>
                    <NavLink to={item.path}>
                      {({ isActive }) => (
                        <>
                          <Icon size={15} />
                          <span className={cn(isActive ? 'font-medium' : '')}>{item.label}</span>
                        </>
                      )}
                    </NavLink>
                  </SidebarMenuButton>
                );
              })}
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>

        {/* Sidebar Footer: spacer only */}
        <SidebarFooter />

        <SidebarRail />
      </Sidebar>

      {/* Main area */}
      <SidebarInset className="bg-background">
        {/* Top header: SidebarTrigger + logo + primary tabs + user */}
        <header className="flex h-14 flex-shrink-0 items-center gap-2 border-b border-sidebar-border bg-sidebar px-4 text-sidebar-foreground">
          <SidebarTrigger className="h-8 w-8 text-sidebar-foreground/70 hover:text-sidebar-foreground" title="收起/展开侧边栏 (B)" />

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
                    'flex items-center gap-1.5 h-8 px-3 rounded-md text-sm transition',
                    activeGroupKey === group.key
                      ? 'bg-sidebar-accent text-sidebar-foreground font-medium'
                      : 'text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50'
                  )}
                >
                  <GroupIcon size={14} />
                  {group.label}
                </button>
              );
            })}
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
            </div>
          )}
        </header>

        <main className="overflow-auto">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
