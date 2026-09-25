import { useEffect, useState } from 'react';
import { BarChart3, Clock3, Flame, Keyboard, Library } from 'lucide-react';
import { toast } from 'sonner';
import { fetchChapterHistory, fetchSummary, fetchWrongWords } from '../../records';
import { aggregateDaily, aggregateKeyHeat, calcStreak, dailyMap, wordsToday, type ChapterLike, type KeyHeat } from '../../stats';
import { useTypingSettings } from '../../settingsStore';
import type { TypingSummary } from '@/api/client';
import TrendChart from './TrendChart';
import DailyCheckIn from './DailyCheckIn';
import KeyboardHeatmap from './KeyboardHeatmap';
import HistoryList from './HistoryList';

/**
 * 统计页：总览 + 趋势 + 打卡 + 键位热力 + 历史章节。
 * 数据全部来自 records.ts 的既有链路（云端优先 / localStorage 回落），无新增存储。
 */

function OverviewCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        {icon}
      </span>
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="truncate text-lg font-semibold tabular-nums">{value}</div>
      </div>
    </div>
  );
}

function formatDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h > 0 ? `${h}h${m}m` : `${m}m`;
}

export default function StatsView() {
  const dailyGoal = useTypingSettings((s) => s.dailyGoalWords);

  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<TypingSummary | null>(null);
  const [history, setHistory] = useState<ChapterLike[]>([]);
  const [heat, setHeat] = useState<KeyHeat>({ missed: {}, wrongPressed: {} });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [s, rows, wrong] = await Promise.all([
          fetchSummary(),
          fetchChapterHistory(200),
          fetchWrongWords(undefined, 500),
        ]);
        if (cancelled) return;
        setSummary(s);
        setHistory([...rows].sort((a, b) => b.createdAt - a.createdAt));
        setHeat(aggregateKeyHeat(wrong));
      } catch {
        if (!cancelled) toast.error('统计数据加载失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        <BarChart3 size={16} className="mr-2 animate-pulse" />
        正在加载统计数据…
      </div>
    );
  }

  const avgAcc = (() => {
    const total = history.reduce((s, r) => s + r.correctCount + r.wrongCount, 0);
    const correct = history.reduce((s, r) => s + r.correctCount, 0);
    return total === 0 ? 0 : Math.round((correct / total) * 100);
  })();

  const streak = calcStreak(history);
  const todayWords = wordsToday(history);
  const monthDaily = [...dailyMap(history).values()].filter((d) => {
    const now = new Date();
    const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return d.date.startsWith(key);
  });

  return (
    <div className="flex flex-col gap-5 overflow-y-auto pb-4">
      {/* 总览 */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <OverviewCard icon={<Library size={17} />} label="累计练习" value={`${summary?.totalWords ?? 0} 词`} />
        <OverviewCard icon={<Clock3 size={17} />} label="累计用时" value={formatDuration(summary?.totalTimeSec ?? 0)} />
        <OverviewCard icon={<Keyboard size={17} />} label="平均正确率" value={`${avgAcc}%`} />
        <OverviewCard icon={<Flame size={17} />} label="连续打卡" value={`${streak.current} 天`} />
      </div>

      <TrendChart data={aggregateDaily(history, 30)} />

      <DailyCheckIn daily={monthDaily} todayWords={todayWords} dailyGoal={dailyGoal} streak={streak} />

      <KeyboardHeatmap heat={heat} />

      <HistoryList rows={history} />
    </div>
  );
}
