import { RotateCcw, ArrowRight, Star } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatTime } from './StatsBar';
import { starsFor } from '../stats';

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  timeSec: number;
  wpm: number;
  accuracy: number;
  wordCount: number;
  correctCount: number;
  wrongCount: number;
  hasNextChapter: boolean;
  onRetry: () => void;
  onNextChapter: () => void;
};

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3 text-center">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

export default function ChapterResult({
  open,
  onOpenChange,
  timeSec,
  wpm,
  accuracy,
  wordCount,
  correctCount,
  wrongCount,
  hasNextChapter,
  onRetry,
  onNextChapter,
}: Props) {
  const stars = starsFor(accuracy);
  const starText = stars === 3 ? '完美！' : stars === 2 ? '很不错' : stars === 1 ? '完成本章' : '错误有点多，再练一次试试';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>本章完成</DialogTitle>
          <DialogDescription>共 {wordCount} 个单词，{starText}</DialogDescription>
        </DialogHeader>

        {/* 星级：按字母正确率 98% / 90% / 60% 三档 */}
        <div className="flex items-center justify-center gap-1.5" title={`正确率 ${accuracy}%`}>
          {[1, 2, 3].map((i) => (
            <Star
              key={i}
              size={26}
              className={cn(
                'transition-colors',
                i <= stars ? 'fill-amber-400 text-amber-400' : 'fill-none text-muted-foreground/40',
              )}
            />
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Metric label="用时" value={formatTime(timeSec)} />
          <Metric label="速度" value={`${wpm} WPM`} />
          <Metric label="正确率" value={`${accuracy}%`} />
          <Metric label="错误字母" value={String(wrongCount)} />
        </div>

        <div className="text-xs text-muted-foreground">
          正确输入 {correctCount} 个字母，输错 {wrongCount} 个。
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onRetry}>
            <RotateCcw size={15} className="mr-1.5" />
            再练一次
          </Button>
          {hasNextChapter && (
            <Button onClick={onNextChapter}>
              下一章
              <ArrowRight size={15} className="ml-1.5" />
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
