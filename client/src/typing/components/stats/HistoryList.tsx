import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getDict } from '../../dictionaries';
import { accuracyOf, starsFor, type ChapterLike } from '../../stats';

/** 历史章节列表：倒序展示最近的练习，附星级评定 */

function Stars({ count }: { count: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" title={`${count} 星`}>
      {[1, 2, 3].map((i) => (
        <Star
          key={i}
          size={12}
          className={cn(
            i <= count ? 'fill-amber-400 text-amber-400' : 'fill-none text-muted-foreground/40',
          )}
        />
      ))}
    </span>
  );
}

function formatDateTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function HistoryList({ rows, limit = 30 }: { rows: ChapterLike[]; limit?: number }) {
  const shown = rows.slice(0, limit);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-medium">历史章节</h3>
        <span className="text-xs text-muted-foreground">最近 {shown.length} 次练习</span>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {shown.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            还没有练习记录，去练一章吧
          </p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="px-3 py-2 font-medium">时间</th>
                <th className="px-3 py-2 font-medium">词库 / 章节</th>
                <th className="px-3 py-2 text-right font-medium">词数</th>
                <th className="px-3 py-2 text-right font-medium">用时</th>
                <th className="hidden px-3 py-2 text-right font-medium sm:table-cell">速度</th>
                <th className="px-3 py-2 text-right font-medium">正确率</th>
                <th className="px-3 py-2 text-right font-medium">星级</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => {
                const acc = accuracyOf(r);
                const dict = getDict(r.dictId);
                // getDict 找不到时会回落到第一个词库，此时显示原始 dictId 更诚实
                const dictName = dict.id === r.dictId ? dict.name : r.dictId;
                const chapterLabel = r.chapter < 0 ? '错词复习' : `第 ${r.chapter + 1} 章`;
                return (
                  <tr key={`${r.createdAt}-${i}`} className="border-b border-border/60 last:border-b-0">
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums text-muted-foreground">
                      {formatDateTime(r.createdAt)}
                    </td>
                    <td className="px-3 py-2">
                      <span className="text-foreground">{dictName}</span>
                      <span className="ml-1 text-muted-foreground">· {chapterLabel}</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.wordCount}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {r.timeSec >= 60 ? `${Math.floor(r.timeSec / 60)}m${r.timeSec % 60}s` : `${r.timeSec}s`}
                    </td>
                    <td className="hidden px-3 py-2 text-right tabular-nums text-muted-foreground sm:table-cell">
                      {r.timeSec > 0 ? Math.round((r.wordCount / r.timeSec) * 60) : 0} WPM
                    </td>
                    <td className={cn('px-3 py-2 text-right tabular-nums', acc >= 90 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400')}>
                      {acc}%
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Stars count={starsFor(acc)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
