import { RotateCcw, ArrowRight } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { formatTime } from './StatsBar';

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
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>本章完成</DialogTitle>
          <DialogDescription>共 {wordCount} 个单词，继续保持。</DialogDescription>
        </DialogHeader>

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
