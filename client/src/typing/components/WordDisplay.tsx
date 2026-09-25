import { EyeOff, Volume2 } from 'lucide-react';
import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { EXPLICIT_SPACE, type WordState } from '../engine';
import type { BlindMode, PronunciationType, Word } from '../types';

const VOWELS = new Set('AEIOUaeiou');

/**
 * 给定盲打模式，判断第 i 个字母是否应该显示原文。
 * 返回 false 时渲染成下划线占位。
 *
 * 设计：打字已经打出的字母（correct / wrong）**总是显示原文**，
 * 盲打只隐藏「还没轮到」的字母 —— 这样用户能立刻知道自己打对了没有，
 * 也能看到已打出部分对不对。
 */
function letterVisible(
  char: string,
  index: number,
  mode: BlindMode,
  letterState: WordState['letterStates'][number],
  randomMask: boolean[],
): boolean {
  // 已打出的字母一律显示
  if (letterState === 'correct' || letterState === 'wrong') return true;
  // 空格永远显示（不可能藏空格让用户打）
  if (char === EXPLICIT_SPACE) return true;

  switch (mode) {
    case 'off':
      return true;
    case 'all':
      return false;
    case 'vowel':
      // 藏元音 → 元音不显示，辅音显示
      return !VOWELS.has(char);
    case 'consonant':
      // 藏辅音 → 辅音不显示，元音显示
      return VOWELS.has(char);
    case 'random':
      return randomMask[index] ?? true;
  }
}

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
  blindMode: BlindMode;
  hidePhonetic: boolean;
  onPronounce: () => void;
};

function Letter({
  char,
  visible,
  state,
  isCurrent,
  fontSize,
}: {
  char: string;
  visible: boolean;
  state: WordState['letterStates'][number];
  isCurrent: boolean;
  fontSize: number;
}) {
  const displayChar = char === EXPLICIT_SPACE ? '␣' : char;
  const placeholder = visible ? displayChar : '_';

  return (
    <span
      className={cn(
        'relative inline-block transition-colors duration-75',
        state === 'correct' && 'text-emerald-600 dark:text-emerald-400',
        state === 'wrong' && 'text-destructive',
        state === 'normal' && (visible ? 'text-foreground' : 'text-border'),
      )}
      style={{ fontSize, lineHeight: 1.4 }}
    >
      {placeholder}
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
  blindMode,
  hidePhonetic,
  onPronounce,
}: Props) {
  const phonetic = pronunciationType === 'uk' ? word.ukphone : word.usphone;
  const cursor = state.inputWord.length;
  const phoneticSize = Math.max(12, Math.round(fontSize * 0.3));
  const transSize = Math.max(12, Math.round(fontSize * 0.28));

  // random 模式：每个单词一份独立掩码，随 word 切换重新生成
  const randomMask = useMemo(
    () => state.displayWord.split('').map(() => Math.random() > 0.5),
    [state.displayWord],
  );

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
        {!hidePhonetic && phonetic && <span className="font-mono">/{phonetic}/</span>}
      </div>

      <div
        className={cn(
          'flex flex-wrap items-center justify-center font-mono font-medium',
          state.hasWrong && 'animate-shake',
        )}
      >
        {state.displayWord.split('').map((char, i) => {
          const ls = state.letterStates[i] ?? 'normal';
          return (
            <Letter
              key={`${i}-${char}`}
              char={char}
              visible={letterVisible(char, i, blindMode, ls, randomMask)}
              state={ls}
              isCurrent={i === cursor}
              fontSize={fontSize}
            />
          );
        })}
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
