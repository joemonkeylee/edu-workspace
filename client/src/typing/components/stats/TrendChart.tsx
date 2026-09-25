import { cn } from '@/lib/utils';
import { accuracyOf, type DailyAgg } from '../../stats';

/**
 * 每日练习量柱状图（纯 SVG/Div，不引图表库）。
 * 柱高 = 当天词数；柱色 = 当天正确率（绿 ≥98 / 蓝 ≥90 / 琥珀 <90）。
 * 悬停原生 title 展示明细。
 */

function barColor(correct: number, wrong: number): string {
  if (correct + wrong === 0) return 'bg-muted';
  const acc = Math.round((correct / (correct + wrong)) * 100);
  if (acc >= 98) return 'bg-emerald-500 dark:bg-emerald-400';
  if (acc >= 90) return 'bg-primary';
  return 'bg-amber-500 dark:bg-amber-400';
}

export default function TrendChart({ data }: { data: DailyAgg[] }) {
  const max = Math.max(1, ...data.map((d) => d.words));
  const activeDays = data.filter((d) => d.words > 0).length;
  const totalWords = data.reduce((s, d) => s + d.words, 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-medium">近 {data.length} 天练习量</h3>
        <span className="text-xs text-muted-foreground">
          {activeDays > 0 ? `练了 ${activeDays} 天 · 共 ${totalWords} 词` : '还没有练习记录'}
        </span>
      </div>

      <div className="rounded-xl border border-border bg-card p-3">
        <div className="flex h-28 items-end gap-[3px]">
          {data.map((d) => {
            const pct = d.words === 0 ? 0 : Math.max(6, Math.round((d.words / max) * 100));
            return (
              <div
                key={d.date}
                className="group relative flex h-full min-w-0 flex-1 flex-col justify-end"
                title={`${d.date}\n练习 ${d.words} 词 · ${d.chapters} 章\n用时 ${d.timeSec}s · 正确率 ${accuracyOf(d)}%`}
              >
                <div
                  className={cn(
                    'w-full rounded-t-sm transition-all group-hover:opacity-80',
                    barColor(d.correct, d.wrong),
                    d.words === 0 && 'min-h-[2px]',
                  )}
                  style={{ height: `${d.words === 0 ? 2 : pct}%` }}
                />
                <span className="pointer-events-none absolute -top-5 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded bg-foreground px-1.5 py-0.5 text-[10px] text-background group-hover:block">
                  {d.words}
                </span>
              </div>
            );
          })}
        </div>

        {/* x 轴：首/中/尾三个刻度 */}
        <div className="mt-2 flex justify-between text-[10px] text-muted-foreground">
          <span>{data[0]?.date.slice(5).replace('-', '/')}</span>
          <span>{data[Math.floor(data.length / 2)]?.date.slice(5).replace('-', '/')}</span>
          <span>今天</span>
        </div>
      </div>

      <div className="flex items-center justify-end gap-3 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm bg-emerald-500 dark:bg-emerald-400" />≥98%
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm bg-primary" />≥90%
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm bg-amber-500 dark:bg-amber-400" />&lt;90%
        </span>
      </div>
    </div>
  );
}
