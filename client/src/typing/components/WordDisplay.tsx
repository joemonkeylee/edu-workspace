import { Volume2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { EXPLICIT_SPACE, type WordState } from '../engine';
import type { PronunciationType, Word } from '../types';

type Props = {
  word: Word;
  state: WordState;
  fontSize: number;
  /** false 时释义隐藏，鼠标悬停才显示 */
  showTrans: boolean;
  pronunciationType: PronunciationType;
  onPronounce: () => void;
};

function Letter({
  char,
  state,
  isCurrent,
  fontSize,
}: {
  char: string;
  state: WordState['letterStates'][number];
  isCurrent: boolean;
  fontSize: number;
}) {
  return (
    <span
      className={cn(
        'relative inline-block transition-colors duration-75',
        state === 'correct' && 'text-emerald-600 dark:text-emerald-400',
        state === 'wrong' && 'text-destructive',
        state === 'normal' && 'text-foreground',
      )}
      style={{ fontSize, lineHeight: 1.4 }}
    >
      {char}
      {isCurrent && state === 'normal' && (
        <span className="absolute -bottom-0.5 left-0 right-0 h-0.5 rounded-full bg-primary" />
      )}
    </span>
  );
}

export default function WordDisplay({ word, state, fontSize, showTrans, pronunciationType, onPronounce }: Props) {
  const phonetic = pronunciationType === 'uk' ? word.ukphone : word.usphone;
  const cursor = state.inputWord.length;

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        <button
          type="button"
          onClick={onPronounce}
          title="发音（Ctrl/Cmd + J）"
          className="flex h-7 w-7 items-center justify-center rounded-md transition hover:bg-muted hover:text-foreground"
        >
          <Volume2 size={16} />
        </button>
        {phonetic && <span className="font-mono text-sm">/{phonetic}/</span>}
      </div>

      <div
        className={cn(
          'flex flex-wrap items-center justify-center font-mono font-medium',
          state.hasWrong && 'animate-shake',
        )}
      >
        {state.displayWord.split('').map((char, i) => (
          <Letter
            key={`${i}-${char}`}
            char={char === EXPLICIT_SPACE ? '␣' : char}
            state={state.letterStates[i] ?? 'normal'}
            isCurrent={i === cursor}
            fontSize={fontSize}
          />
        ))}
      </div>

      <div
        className={cn(
          'max-w-2xl text-center text-sm leading-relaxed transition-opacity duration-150',
          showTrans ? 'text-muted-foreground' : 'text-transparent hover:text-muted-foreground',
        )}
      >
        {word.trans.length > 0 ? word.trans.join('；') : '—'}
      </div>
    </div>
  );
}
