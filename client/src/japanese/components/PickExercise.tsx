import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { generateOptions } from '@/japanese/utils/kana';

interface PickExerciseProps {
  question: string;          // 显示的字符（如 "あ"）
  correct: string;           // 正确答案（如 "a"）
  optionsPool: string[];     // 所有可能的选项池（用于生成错误选项）
  onResult: (correct: boolean) => void;
  direction?: 'kana→romaji' | 'romaji→kana';
}

/** 四选一练习 */
export function PickExercise({
  question,
  correct,
  optionsPool,
  onResult,
  direction = 'kana→romaji',
}: PickExerciseProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);

  const options = useMemo(
    () => generateOptions(correct, optionsPool, 4),
    [correct, optionsPool],
  );

  const isCorrect = selected === correct;

  function pick(choice: string) {
    if (revealed) return;
    setSelected(choice);
    setRevealed(true);
    onResult(choice === correct);
  }

  function next() {
    setSelected(null);
    setRevealed(false);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="text-center text-xs text-muted-foreground">
        {direction === 'kana→romaji' ? '下面字符怎么读？' : '下面哪个是这个读法？'}
      </div>

      {/* 题目 */}
      <div className="flex items-center justify-center rounded-xl border border-border bg-card py-10">
        <span className="text-6xl font-semibold text-card-foreground">{question}</span>
      </div>

      {/* 选项 */}
      <div className="grid grid-cols-2 gap-3">
        {options.map((opt) => {
          const picked = selected === opt;
          const right = revealed && opt === correct;
          const wrong = revealed && picked && !isCorrect;
          return (
            <Button
              key={opt as string}
              variant={revealed ? 'ghost' : 'outline'}
              size="lg"
              disabled={revealed}
              onClick={() => pick(opt as string)}
              className={cn(
                'h-14 text-lg font-medium',
                right && 'bg-green-500 text-white hover:bg-green-500 dark:bg-green-600',
                wrong && 'bg-red-500 text-white hover:bg-red-500 dark:bg-red-600',
                !revealed && picked && 'bg-primary text-primary-foreground',
              )}
            >
              {opt}
            </Button>
          );
        })}
      </div>

      {revealed && (
        <Button onClick={next} className="w-full">
          下一个
        </Button>
      )}
    </div>
  );
}
