import { Check, Flame } from 'lucide-react';
import { cn } from '@/lib/utils';
import { dateKey, type DailyAgg } from '../../stats';

/**
 * 每日打卡：当月日历 + 连续天数 + 今日目标进度。
 * 有练习的日期实心标记；今天未达标显示进度环。
 */

const WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日']; // 周一开头

export default function DailyCheckIn({
  daily,
  todayWords,
  dailyGoal,
  streak,
  now = Date.now(),
}: {
  /** 当月每天的聚合（dailyMap 的值集合） */
  daily: DailyAgg[];
  todayWords: number;
  dailyGoal: number;
  streak: { current: number; longest: number; todayDone: boolean };
  now?: number;
}) {
  const today = new Date(now);
  const todayKey = dateKey(today);
  const byDate = new Map(daily.map((d) => [d.date, d]));

  // 当月网格：周一开头，前置补位
  const first = new Date(today.getFullYear(), today.getMonth(), 1);
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const leading = (first.getDay() + 6) % 7; // 周日=0 → 周一开头偏移

  const goalPct = Math.min(100, Math.round((todayWords / Math.max(1, dailyGoal)) * 100));
  const goalDone = todayWords >= dailyGoal;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-medium">每日打卡</h3>
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Flame size={13} className={cn(streak.current > 0 ? 'text-orange-500 dark:text-orange-400' : 'text-muted-foreground/50')} />
          连续 {streak.current} 天 · 最长 {streak.longest} 天
        </span>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3 sm:flex-row sm:items-center">
        {/* 今日目标 */}
        <div className="flex flex-row items-center gap-3 sm:w-44 sm:flex-col sm:items-start">
          <div className="flex-1 sm:w-full">
            <div className="flex items-baseline justify-between text-xs">
              <span className="text-muted-foreground">今日 {goalDone ? '已完成' : '目标'}</span>
              <span className="tabular-nums text-foreground">
                {todayWords} / {dailyGoal} 词
              </span>
            </div>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={cn('h-full rounded-full transition-all', goalDone ? 'bg-emerald-500 dark:bg-emerald-400' : 'bg-primary')}
                style={{ width: `${goalPct}%` }}
              />
            </div>
          </div>
          {goalDone && (
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white dark:bg-emerald-400">
              <Check size={14} />
            </span>
          )}
        </div>

        {/* 当月日历 */}
        <div className="flex-1">
          <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-muted-foreground">
            {WEEK_LABELS.map((w) => (
              <span key={w}>{w}</span>
            ))}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-1">
            {Array.from({ length: leading }, (_, i) => (
              <span key={`pad-${i}`} />
            ))}
            {Array.from({ length: daysInMonth }, (_, i) => {
              const day = i + 1;
              const key = dateKey(new Date(today.getFullYear(), today.getMonth(), day));
              const agg = byDate.get(key);
              const done = (agg?.words ?? 0) > 0;
              const isToday = key === todayKey;
              const isFuture = key > todayKey;
              return (
                <span
                  key={key}
                  title={done ? `${key}：练习 ${agg!.words} 词` : key}
                  className={cn(
                    'flex aspect-square items-center justify-center rounded-md text-[10px] tabular-nums',
                    !done && !isToday && 'text-muted-foreground/70',
                    done && 'bg-emerald-500/15 font-medium text-emerald-700 dark:text-emerald-300',
                    isToday && 'ring-2 ring-primary',
                    isFuture && 'opacity-40',
                  )}
                >
                  {day}
                </span>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
