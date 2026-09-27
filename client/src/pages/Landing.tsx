import { Link } from 'react-router-dom';
import { GraduationCap } from 'lucide-react';
import AppHeaderRight from "@/components/AppHeaderRight";
import EnvBadge from "@/components/EnvBadge";
import StudentOverview from "@/components/StudentOverview";

/**
 * 站点默认页（/）—— 学生进来直接看到自己的统计：作业批改反馈 + 打字/英语练习进展。
 * 教师与管理员这里由 StudentOverview 自行判空（他们的同款面板在 /admin 概览），
 * 看书仍然去 /books。
 */
export default function Landing() {
  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <header className="flex h-14 flex-shrink-0 items-center justify-between bg-sidebar px-6 text-sidebar-foreground">
        <div className="flex items-center gap-3">
          <Link to="/" className="flex items-center gap-2">
            <GraduationCap size={22} />
            <span className="text-lg font-normal">edu-workspace</span>
          </Link>
          <EnvBadge />
        </div>
        <AppHeaderRight />
      </header>
      <main className="flex-1 overflow-auto px-6 py-4">
        <div className="mx-auto w-full max-w-[1400px]">
          <StudentOverview />
        </div>
      </main>
    </div>
  );
}
