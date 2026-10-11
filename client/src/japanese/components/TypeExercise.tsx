import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface TypeExerciseProps {
  question: string;        // 要输入的目标（如罗马音 "a" 或假名 "あ"）
  hint?: string;           // 提示（如 "ひらがな"）
  label?: string;          // 输入什么
  onResult: (correct: boolean) => void;
}

/** 打字练习（不引入 wanakana，直接 raw 输入） */
export function TypeExercise({ question, hint, label, onResult }: TypeExerciseProps) {
  const [input, setInput] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [correct, setCorrect] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, [revealed]);

  function check() {
    const ok = input.trim().toLowerCase() === question.toLowerCase();
    setCorrect(ok);
    setRevealed(true);
    onResult(ok);
  }

  function next() {
    setInput('');
    setRevealed(false);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="text-center text-xs text-muted-foreground">{label ?? '输入对应的读法'}</div>

      {/* 题目 */}
      <div className="flex items-center justify-center rounded-xl border border-border bg-card py-10">
        <span className="text-6xl font-semibold text-card-foreground">{question}</span>
      </div>

      {/* 输入 */}
      <div className="flex gap-2">
        <Input
          ref={inputRef}
          value={input}
          disabled={revealed}
          placeholder={hint ?? '在这里输入…'}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !revealed) check();
          }}
          className={cn(
            'h-12 text-lg text-center',
            revealed && correct && 'border-green-500 bg-green-50 dark:bg-green-950/30',
            revealed && !correct && 'border-red-500 bg-red-50 dark:bg-red-950/30',
          )}
        />
        {!revealed ? (
          <Button onClick={check} className="h-12">
            确认
          </Button>
        ) : (
          <Button onClick={next} className="h-12">
            下一个
          </Button>
        )}
      </div>

      {revealed && (
        <div className={cn('text-center text-sm', correct ? 'text-green-600' : 'text-red-600')}>
          {correct ? '✓ 正确！' : `✗ 正确答案是：${question}`}
        </div>
      )}
    </div>
  );
}
