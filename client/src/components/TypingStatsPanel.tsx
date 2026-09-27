/**
 * 单词打字练习的统计卡片（概览口径）。
 *
 * 数据源与 /typing 的统计页完全相同（typing/records.ts：云端优先、localStorage 回落），
 * 这里只取总览数字，聚合逻辑一律复用 typing/stats.ts，不另起一套。
 * 放在首页是为了让学生不用进 /typing 就能看到今天的练习量。
 */

import { useEffect, useState } from 'react';
import { fetchChapterHistory, fetchSummary } from '../typing/records';
import { calcStreak, wordsToday, type ChapterLike } from '../typing/stats';
import { useTypingSettings } from '../typing/settingsStore';
import type { TypingSummary } from '@/api/client';

function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '0m';
  if (sec < 60) return `${Math.round(sec)}s`;
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h > 0 ? `${h}h${m}m` : `${m}m`;
}

interface TileProps {
  label: string;
  value: string;
  hint?: string;
  accent?: 'default' | 'green' | 'amber' | 'sky';
}

function Tile({ label, value, hint, accent = 'default' }: TileProps) {
  const colorMap: Record<NonNullable<TileProps['accent']>, string> = {
    default: 'border-border',
    green: 'border-emerald-300 dark:border-emerald-800',
    amber: 'border-amber-300 dark:border-amber-800',
    sky: 'border-sky-300 dark:border-sky-800',
  };
  return (
    <div className={`rounded-lg border bg-card p-3 ${colorMap[accent]}`}>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1.5 text-2xl font-semibold tabular-nums text-foreground">{value}</div>
      {hint && <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

export default function TypingStatsPanel() {
  const dailyGoal = useTypingSettings((s) => s.dailyGoalWords);

  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<TypingSummary | null>(null);
  const [history, setHistory] = useState<ChapterLike[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [s, rows] = await Promise.all([fetchSummary(), fetchChapterHistory(200)]);
        if (cancelled) return;
        setSummary(s);
        setHistory(rows);
      } catch {
        /* 统计拉不到就算了，不打断首页主流程 */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const avgAcc = (() => {
    const total = history.reduce((s, r) => s + r.correctCount + r.wrongCount, 0);
    const correct = history.reduce((s, r) => s + r.correctCount, 0);
    return total === 0 ? 0 : Math.round((correct / total) * 100);
  })();
  const streak = calcStreak(history);
  const today = wordsToday(history);
  const goal = dailyGoal > 0 ? dailyGoal : 0;
  const goalPct = goal > 0 ? Math.min(100, Math.round((today / goal) * 100)) : 0;

  return (
    <section className="flex flex-col overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div>
          <h2 className="text-sm font-semibold text-foreground">单词打字练习</h2>
          <p className="text-xs text-muted-foreground">
            {summary && summary.chapters > 0
              ? `已完成 ${summary.chapters} 个章节 · 错词 ${summary.wrongWords} 个`
              : '还没有练习记录'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => { window.location.href = '/typing'; }}
          className="rounded-md border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground transition hover:bg-accent hover:text-foreground"
        >
          进入练习 →
        </button>
      </header>

      {/* 顶部 4 个指标 */}
      <div className="grid grid-cols-2 gap-3 p-4">
        <Tile
          label="累计练习"
          value={loading ? '—' : `${(summary?.totalWords ?? 0).toLocaleString()} 词`}
          accent={summary && summary.totalWords > 0 ? 'sky' : 'default'}
        />
        <Tile
          label="累计用时"
          value={loading ? '—' : formatDuration(summary?.totalTimeSec ?? 0)}
        />
        <Tile
          label="平均正确率"
          value={loading ? '—' : `${avgAcc}%`}
          accent={avgAcc >= 80 ? 'green' : avgAcc >= 50 ? 'amber' : 'default'}
        />
        <Tile
          label="连续打卡"
          value={loading ? '—' : `${streak.current} 天`}
          hint={streak.longest > streak.current ? `最长 ${streak.longest} 天` : undefined}
          accent={streak.current > 0 ? 'amber' : 'default'}
        />
      </div>

      {goal > 0 && (
        <div className="border-t border-border px-4 py-2.5">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>今日目标</span>
            <span className="tabular-nums">{today} / {goal} 词</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full rounded-full transition-all ${goalPct >= 100 ? 'bg-emerald-500' : 'bg-primary'}`}
              style={{ width: `${goalPct}%` }}
            />
          </div>
        </div>
      )}
    </section>
  );
}
