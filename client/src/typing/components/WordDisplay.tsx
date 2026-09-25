import { EyeOff, Volume2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { EXPLICIT_SPACE, type WordState } from '../engine';
import type { PronunciationType, Word } from '../types';

type Props = {
  word: Word;
  state: WordState;
  /** 单词字号（px），音标与释义按同一比例联动 */
  fontSize: number;
  /** false 时释义隐藏，显示一个「显示释义」按钮 */
  showTrans: boolean;
  /** 是否允许点击释义区切换显隐（跟随「默认隐藏释义」设置） */
  transToggleable: boolean;
  onToggleTrans: () => void;
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

export default function WordDisplay({
  word,
  state,
  fontSize,
  showTrans,
  transToggleable,
  onToggleTrans,
  pronunciationType,
  onPronounce,
}: Props) {
  const phonetic = pronunciationType === 'uk' ? word.ukphone : word.usphone;
  const cursor = state.inputWord.length;
  const phoneticSize = Math.max(12, Math.round(fontSize * 0.3));
  const transSize = Math.max(12, Math.round(fontSize * 0.28));

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="flex items-center gap-2 text-muted-foreground" style={{ fontSize: phoneticSize }}>
        <button
          type="button"
          onClick={onPronounce}
          title="发音（Ctrl/Cmd + J）"
          className="flex h-7 w-7 items-center justify-center rounded-md transition hover:bg-muted hover:text-foreground"
        >
          <Volume2 size={16} />
        </button>
        {phonetic && <span className="font-mono">/{phonetic}/</span>}
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

      {/* 释义区：高度固定，隐藏与显示之间切换时不会跳动 */}
      <div className="flex min-h-[2rem] w-full items-center justify-center px-2">
        {showTrans ? (
          <div
            onClick={transToggleable ? onToggleTrans : undefined}
            title={transToggleable ? '点击隐藏释义' : undefined}
            className={cn(
              'max-w-2xl text-center leading-relaxed text-muted-foreground',
              transToggleable && 'cursor-pointer select-none',
            )}
            style={{ fontSize: transSize }}
          >
            {word.trans.length > 0 ? word.trans.join('；') : '—'}
          </div>
        ) : (
          <button
            type="button"
            onClick={onToggleTrans}
            className="flex items-center gap-1.5 rounded-md border border-dashed border-border px-3 py-1 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <EyeOff size={13} />
            显示释义（Tab）
          </button>
        )}
      </div>
    </div>
  );
}
