/**
 * 首页的学生统计区。
 *
 * admin 的「概览」是自己的工作台（作业 + 英语），但学生进不去 /admin，
 * 所以这里在首页复刻一套同类面板，数据源换成「我自己的」那一套：
 *   - 作业：/assignments/mine 与 /pdf/assignments/mine（含批改结论）
 *   - 单词打字：typing 模块（云端优先 / localStorage 回落）
 *   - 英语打字：english 模块的 localStorage 学习记录
 * 界面与 admin 概览保持一致，只是挪到了首页并按学生视角把批改结论前置。
 *
 * 显示条件：AUTH_ENABLED=false（单机单人）或当前登录者是学生；
 * 教师/管理员仍旧在 /admin 看，避免首页重复一大块。
 */

import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, LayoutDashboard } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import MyWorkspace from './admin/MyWorkspace';
import EnglishStudyPanel from './admin/EnglishStudyPanel';
import TypingStatsPanel from './TypingStatsPanel';

const STORAGE_KEY = 'edu-home-student-overview-collapsed';

function loadCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export default function StudentOverview() {
  const { user, authEnabled } = useAuthStore();
  const [collapsed, setCollapsed] = useState(loadCollapsed);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0');
    } catch { /* 隐私模式下写不进去，不影响展开收起 */ }
  }, [collapsed]);

  // authEnabled 为 null 表示还没探到服务端配置，先不渲染，免得一闪而过
  const isStudent = authEnabled === false
    ? true
    : Boolean(user) && !user!.isAdmin && !user!.roles?.includes('teacher');

  if (authEnabled === null || !isStudent) return null;

  return (
    <section className="rounded-lg border border-border bg-muted/30">
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        title={collapsed ? '展开统计' : '收起统计'}
      >
        <LayoutDashboard size={14} className="text-muted-foreground" />
        <span className="text-sm font-semibold text-foreground">我的学习统计</span>
        <span className="text-[11px] text-muted-foreground">作业批改 · 打字练习 · 英语学习</span>
        <span className="flex-1" />
        {collapsed ? (
          <ChevronDown size={14} className="text-muted-foreground" />
        ) : (
          <ChevronUp size={14} className="text-muted-foreground" />
        )}
      </button>

      {!collapsed && (
        <div className="border-t border-border p-3">
          {/* 宽屏时作业区占 2/3、练习统计占 1/3，尽量一屏放完不出纵向滚动条；窄屏自动上下堆叠 */}
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <MyWorkspace />
            <div className="flex flex-col gap-3">
              <TypingStatsPanel />
              <EnglishStudyPanel compact />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
