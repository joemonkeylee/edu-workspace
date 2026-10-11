import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useJpStore } from '../store/useJpStore';
import { BookOpen, Trophy, Zap, List, ChevronRight } from 'lucide-react';

/** 日语学习首页 — shadcn 风格仪表盘 */
export function JpHome() {
  const { init, study, lessons, srs } = useJpStore();

  useEffect(() => {
    init();
  }, [init]);

  const dueCount = Object.values(srs).filter((s) => s.nextReview <= Date.now()).length;
  const availableLessons = lessons.filter((l) => useJpStore.getState().getLessonStatus(l.id) === 'available').length;
  const completedLessons = lessons.filter((l) => useJpStore.getState().getLessonStatus(l.id) === 'completed').length;

  const stats = [
    { label: '今日待复习', value: dueCount, icon: Zap, color: 'text-amber-600' },
    { label: '连续天数', value: study.streak, icon: Trophy, color: 'text-orange-600' },
    { label: '已学卡片', value: study.learned, icon: BookOpen, color: 'text-primary' },
    { label: '成熟卡片', value: study.mature, icon: List, color: 'text-green-600' },
  ];

  const levels = [
    { id: 'n5', name: 'JLPT N5', desc: '入门', order: 1 },
    { id: 'n4', name: 'JLPT N4', desc: '初级', order: 2 },
    { id: 'n3', name: 'JLPT N3', desc: '中级', order: 3 },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
      {/* 标题区 */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">日本語学習</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          从零开始 — 先搞定五十音，再啃语法和技术词
        </p>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map(({ label, value, icon: Icon, color }) => (
          <div
            key={label}
            className="rounded-lg border border-border bg-card p-4 shadow-sm"
          >
            <div className="flex items-center gap-2 text-muted-foreground">
              <Icon className={cn('h-4 w-4', color)} />
              <span className="text-xs">{label}</span>
            </div>
            <div className="mt-1 text-2xl font-bold text-foreground">{value}</div>
          </div>
        ))}
      </div>

      {/* 入口按钮 */}
      <div className="flex gap-3">
        <Button asChild size="lg" className="flex-1">
          <Link to="/jp/lessons">
            <BookOpen className="mr-2 h-5 w-5" />
            开始学习
            {availableLessons > 0 && (
              <span className="ml-2 rounded-full bg-primary-foreground/20 px-2 py-0.5 text-xs">
                {availableLessons} 课可学
              </span>
            )}
          </Link>
        </Button>
        {dueCount > 0 && (
          <Button asChild size="lg" variant="outline" className="flex-1">
            <Link to="/jp/review">
              <Zap className="mr-2 h-5 w-5 text-amber-600" />
              今天复习 ({dueCount})
            </Link>
          </Button>
        )}
      </div>

      {/* 等级进度 */}
      <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground">学习路径</h2>
        <div className="space-y-2">
          {levels.map((level) => {
            const levelLessons = lessons.filter((l) => l.level === level.id);
            const levelCompleted = levelLessons.filter(
              (l) => useJpStore.getState().getLessonStatus(l.id) === 'completed',
            ).length;
            const pct = levelLessons.length > 0 ? (levelCompleted / levelLessons.length) * 100 : 0;
            return (
              <div key={level.id} className="rounded-md border border-border/60 bg-background p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm font-medium text-foreground">{level.name}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{level.desc}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {levelCompleted}/{levelLessons.length}
                  </span>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 快速入口 */}
      <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground">课程分类</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {[
            { cat: 'characters', label: '五十音', icon: 'あ' },
            { cat: 'vocabulary', label: '词汇', icon: '単' },
            { cat: 'grammar', label: '语法', icon: '文' },
            { cat: 'reading', label: '阅读', icon: '読' },
          ].map((item) => (
            <Link
              key={item.cat}
              to={`/jp/lessons?cat=${item.cat}`}
              className="group flex items-center gap-3 rounded-md border border-border/60 bg-background p-3 transition-colors hover:border-primary/40 hover:bg-accent"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-lg font-semibold text-primary">
                {item.icon}
              </span>
              <span className="text-sm font-medium text-foreground group-hover:text-primary">
                {item.label}
              </span>
              <ChevronRight className="ml-auto h-4 w-4 text-muted-foreground" />
            </Link>
          ))}
        </div>
      </div>

      {completedLessons > 0 && (
        <div className="text-center text-xs text-muted-foreground">
          已完成 {completedLessons} 课，继续加油！
        </div>
      )}
    </div>
  );
}
