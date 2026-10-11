import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useJpStore } from '../store/useJpStore';
import { FlashCard } from '../components/FlashCard';
import { SrsRating } from '../components/SrsRating';
import { ChevronLeft, Zap, CheckCircle2 } from 'lucide-react';

/** 基于 SRS 的到期卡片复习页 */
export function JpReview() {
  const { init, getDueCards, recordReview, lessons } = useJpStore();

  const [queue, setQueue] = useState<Array<{ cardKey: string; front: string; back: string; reading?: string }>>([]);
  const [idx, setIdx] = useState(0);
  const [doneCount, setDoneCount] = useState(0);
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    init();
  }, [init]);

  // 构建复习队列
  useEffect(() => {
    const due = getDueCards(50);
    const cardMap = new Map<string, { front: string; back: string; reading?: string }>();
    for (const lesson of lessons) {
      for (const item of lesson.items) {
        if (item.cardRef) {
          const key = `japanese:${item.cardRef.category}:${item.cardRef.front}`;
          cardMap.set(key, { front: item.front, back: item.back, reading: item.reading });
        }
      }
    }
    const queue = due
      .map((s) => ({ cardKey: s.cardKey, ...cardMap.get(s.cardKey) }))
      .filter((c): c is { cardKey: string; front: string; back: string; reading?: string } =>
        !!c.front && !!c.back,
      );
    setQueue(queue);
    setIdx(0);
    setFinished(false);
    setDoneCount(0);
  }, [getDueCards, lessons]);

  function rate(grade: number) {
    const cur = queue[idx];
    recordReview(cur.cardKey, grade as 1 | 3 | 4 | 5);
    setDoneCount((c) => c + 1);
    if (idx + 1 >= queue.length) {
      setFinished(true);
    } else {
      setIdx((i) => i + 1);
    }
  }

  if (queue.length === 0) {
    return (
      <div className="mx-auto max-w-md space-y-6 p-8 text-center">
        <div className="rounded-xl border border-green-300 bg-green-50 p-8 shadow-sm dark:border-green-700 dark:bg-green-950/30">
          <CheckCircle2 className="mx-auto h-12 w-12 text-green-600 dark:text-green-400" />
          <h2 className="mt-3 text-lg font-bold text-green-700 dark:text-green-300">今天没有要复习的卡！</h2>
          <p className="mt-1 text-sm text-green-700/80 dark:text-green-300/70">
            去学新课吧，或明天再来。
          </p>
        </div>
        <div className="flex justify-center gap-3">
          <Link to="/jp">
            <Button variant="outline">← 回到首页</Button>
          </Link>
          <Link to="/jp/lessons">
            <Button>开始学习</Button>
          </Link>
        </div>
      </div>
    );
  }

  if (finished) {
    return (
      <div className="mx-auto max-w-md space-y-6 p-8 text-center">
        <div className="rounded-xl border border-green-300 bg-green-50 p-8 shadow-sm dark:border-green-700 dark:bg-green-950/30">
          <CheckCircle2 className="mx-auto h-16 w-16 text-green-600 dark:text-green-400" />
          <h2 className="mt-4 text-2xl font-bold text-green-700 dark:text-green-300">今天的复习完成！</h2>
          <p className="mt-2 text-sm text-green-700/80 dark:text-green-300/70">
            共复习 {doneCount} 张卡
          </p>
        </div>
        <div className="flex justify-center gap-3">
          <Link to="/jp">
            <Button variant="outline">← 回到首页</Button>
          </Link>
        </div>
      </div>
    );
  }

  const cur = queue[idx];
  const progress = ((idx) / queue.length) * 100;

  return (
    <div className="mx-auto max-w-xl space-y-5 p-4 sm:p-6">
      {/* 顶部 */}
      <div className="flex items-center justify-between">
        <Link to="/jp">
          <Button variant="outline" size="sm" className="gap-1">
            <ChevronLeft className="h-4 w-4" /> 返回
          </Button>
        </Link>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Zap className="h-3 w-3 text-amber-600" />
          <span>{idx + 1} / {queue.length}</span>
        </div>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-amber-500 transition-all" style={{ width: `${progress}%` }} />
      </div>

      {/* 闪卡 */}
      <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <FlashCard
          front={cur.front}
          back={cur.back}
          reading={cur.reading}
          size="lg"
        />
      </div>

      {/* 评分按钮 */}
      <div className="space-y-2">
        <p className={cn('text-center text-xs text-muted-foreground')}>
          翻面看看背面，然后选择你记忆的难度
        </p>
        <SrsRating onRate={(g) => rate(g)} />
      </div>
    </div>
  );
}
