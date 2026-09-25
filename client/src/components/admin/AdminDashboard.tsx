import MyWorkspace from './MyWorkspace';
import EnglishStudyPanel from './EnglishStudyPanel';

/**
 * /admin 的首页。这里放的是「我自己的」工作台 —— 作业进展与学习概览；
 * 管理别人的数据走左侧菜单里的各项（作业管理、批注数据、错题本…）。
 */
export default function AdminDashboard() {
  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">概览</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          自己的学习进展与作业完成情况。批改或查看他人作业请去「作业管理」。
        </p>
      </div>

      <EnglishStudyPanel />

      <MyWorkspace />
    </div>
  );
}
