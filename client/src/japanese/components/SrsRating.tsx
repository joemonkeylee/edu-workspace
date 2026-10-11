import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ReviewGrade } from '@/japanese/types/models';

interface SrsRatingProps {
  onRate: (grade: ReviewGrade) => void;
  disabled?: boolean;
  labels?: { again: string; hard: string; good: string; easy: string };
}

/** SM-2 四级评分按钮 — shadcn 风格 */
export function SrsRating({
  onRate,
  disabled,
  labels = { again: '重来', hard: '困难', good: '良好', easy: '简单' },
}: SrsRatingProps) {
  const btnClass = 'flex-1 text-sm font-medium';
  return (
    <div className="flex gap-2">
      <Button
        variant="destructive"
        size="sm"
        className={btnClass}
        disabled={disabled}
        onClick={() => onRate(ReviewGrade.Again)}
      >
        {labels.again}
      </Button>
      <Button
        variant="outline"
        size="sm"
        className={cn(btnClass, 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-400')}
        disabled={disabled}
        onClick={() => onRate(ReviewGrade.Hard)}
      >
        {labels.hard}
      </Button>
      <Button
        variant="outline"
        size="sm"
        className={cn(btnClass, 'border-green-300 bg-green-50 text-green-700 hover:bg-green-100 dark:border-green-700 dark:bg-green-950/50 dark:text-green-400')}
        disabled={disabled}
        onClick={() => onRate(ReviewGrade.Good)}
      >
        {labels.good}
      </Button>
      <Button
        variant="outline"
        size="sm"
        className={cn(btnClass, 'border-sky-300 bg-sky-50 text-sky-700 hover:bg-sky-100 dark:border-sky-700 dark:bg-sky-950/50 dark:text-sky-400')}
        disabled={disabled}
        onClick={() => onRate(ReviewGrade.Easy)}
      >
        {labels.easy}
      </Button>
    </div>
  );
}
