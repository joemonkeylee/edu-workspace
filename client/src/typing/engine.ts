/**
 * 单词打字练习的状态机。
 *
 * 判定逻辑提取自 qwerty-learner（MIT），但重写为**纯 reducer**：
 * - 不依赖 jotai / use-immer / Dexie，只用 React 内置 useReducer
 * - 不直接操作 DOM 或播放声音，所有副作用以 `effect` 字段暴露给外层 useEffect
 * - 章节状态与单词状态合并在一棵 state 树里，避免跨 reducer 同步
 */

import type { LetterMistakes, LetterState, Word } from './types';

/** 单词中的空格用可见符号代替，避免用户看不出要打空格 */
export const EXPLICIT_SPACE = '␣';

/** 每章的词数 */
export const CHAPTER_LENGTH = 20;

/** 输入一个字母后产生的效果，用于驱动音效 / 发音等副作用 */
export type TypingEffect = 'none' | 'correct' | 'wrong' | 'finish';

/** 单词级状态 */
export type WordState = {
  /** 待输入的单词，空格已替换为 EXPLICIT_SPACE */
  displayWord: string;
  inputWord: string;
  letterStates: LetterState[];
  /** 当前处于错误态（输入被锁，等待重置） */
  hasWrong: boolean;
  wrongCount: number;
  /** 每次「正确」输入的时刻，用于计算逐字母耗时 */
  letterTimeArray: number[];
  letterMistake: LetterMistakes;
  isFinished: boolean;
};

/** 章节级状态 */
export type ChapterState = {
  words: Word[];
  index: number;
  /** 已完成的单词数 */
  wordCount: number;
  /** 正确输入的「字母」数 */
  correctCount: number;
  /** 输错的「字母」数 */
  wrongCount: number;
  /** 当前词已循环的次数 */
  loopCount: number;
  isTyping: boolean;
  isFinished: boolean;
  /** 错误次数过多时提示可跳过 */
  isShowSkip: boolean;
  time: number;
  accuracy: number;
  wpm: number;
};

/** 单个单词完成后的记录，章节结束时批量上报 */
export type WordLog = {
  word: string;
  wrongCount: number;
  /** 相邻字母输入间隔（ms） */
  timing: number[];
  mistakes: LetterMistakes;
};

export type TypingState = {
  chapter: ChapterState;
  word: WordState;
  wordLogs: WordLog[];
  /** seq 保证连续相同的 effect 也能被 useEffect 捕获 */
  effect: { type: TypingEffect; seq: number };
};

export type TypingAction =
  | { type: 'setup'; words: Word[]; initialIndex?: number; startTyping?: boolean }
  | { type: 'start' }
  | { type: 'pause' }
  | { type: 'input'; char: string; ignoreCase: boolean }
  | { type: 'clearWrong' }
  | { type: 'advance'; loopTimes: number }
  | { type: 'skipWord' }
  | { type: 'tick' }
  | { type: 'restart' };

export function emptyWordState(): WordState {
  return {
    displayWord: '',
    inputWord: '',
    letterStates: [],
    hasWrong: false,
    wrongCount: 0,
    letterTimeArray: [],
    letterMistake: {},
    isFinished: false,
  };
}

/** 把一个词条转成可输入的显示串：空格变可见符号，省略号收敛为两个点 */
export function toDisplayWord(name: string): string {
  return (name ?? '').replace(/ /g, EXPLICIT_SPACE).replace(/…/g, '..');
}

export function makeWordState(word: Word | undefined): WordState {
  if (!word) return emptyWordState();
  const displayWord = toDisplayWord(word.name);
  return {
    displayWord,
    inputWord: '',
    letterStates: new Array(displayWord.length).fill('normal'),
    hasWrong: false,
    wrongCount: 0,
    letterTimeArray: [],
    letterMistake: {},
    isFinished: false,
  };
}

/** 逐字母时刻 → 相邻间隔 */
export function toTiming(letterTimeArray: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < letterTimeArray.length; i += 1) {
    out.push(Math.max(0, letterTimeArray[i] - letterTimeArray[i - 1]));
  }
  return out;
}

export function createInitialState(words: Word[], initialIndex = 0, startTyping = false): TypingState {
  const index = initialIndex >= 0 && initialIndex < words.length ? initialIndex : 0;
  return {
    chapter: {
      words,
      index,
      wordCount: 0,
      correctCount: 0,
      wrongCount: 0,
      loopCount: 0,
      isTyping: startTyping,
      isFinished: false,
      isShowSkip: false,
      time: 0,
      accuracy: 0,
      wpm: 0,
    },
    word: makeWordState(words[index]),
    wordLogs: [],
    effect: { type: 'none', seq: 0 },
  };
}

function recomputeMetrics(chapter: ChapterState): ChapterState {
  const inputSum = chapter.correctCount + chapter.wrongCount;
  return {
    ...chapter,
    accuracy: Math.round((chapter.correctCount / (inputSum === 0 ? 1 : inputSum)) * 100),
    wpm: Math.round((chapter.wordCount / (chapter.time === 0 ? 1 : chapter.time)) * 60),
  };
}

export function typingReducer(state: TypingState, action: TypingAction): TypingState {
  switch (action.type) {
    case 'setup':
      return createInitialState(action.words, action.initialIndex ?? 0, action.startTyping ?? false);

    case 'start': {
      if (state.chapter.isFinished) return state;
      return { ...state, chapter: { ...state.chapter, isTyping: true } };
    }

    case 'pause':
      return { ...state, chapter: { ...state.chapter, isTyping: false } };

    case 'input': {
      const { chapter, word } = state;
      if (!chapter.isTyping || chapter.isFinished) return state;
      // 错误态下输入被锁定，等待 clearWrong 重置
      if (word.hasWrong || word.isFinished) return state;

      const inputWord = word.inputWord + action.char;
      const i = inputWord.length - 1;
      const correctChar = word.displayWord[i];
      // 输入超出单词长度，忽略
      if (correctChar === undefined) return state;

      const inputChar = inputWord[i];
      const isEqual = action.ignoreCase
        ? inputChar.toLowerCase() === correctChar.toLowerCase()
        : inputChar === correctChar;

      const nextSeq = state.effect.seq + 1;

      if (isEqual) {
        const letterStates = word.letterStates.slice();
        letterStates[i] = 'correct';
        const letterTimeArray = [...word.letterTimeArray, Date.now()];
        const isLast = inputWord.length >= word.displayWord.length;

        let wordLogs = state.wordLogs;
        if (isLast) {
          const current = chapter.words[chapter.index];
          wordLogs = [
            ...state.wordLogs,
            {
              word: current?.name ?? '',
              wrongCount: word.wrongCount,
              timing: toTiming(letterTimeArray),
              mistakes: word.letterMistake,
            },
          ];
        }

        return {
          ...state,
          chapter: { ...chapter, correctCount: chapter.correctCount + 1 },
          word: { ...word, inputWord, letterStates, letterTimeArray, isFinished: isLast },
          wordLogs,
          effect: { type: isLast ? 'finish' : 'correct', seq: nextSeq },
        };
      }

      // 输错：记录一次，随后整体清空重打
      const letterStates = word.letterStates.slice();
      letterStates[i] = 'wrong';
      const prevMistakes = word.letterMistake[i] ?? [];
      const wrongCount = word.wrongCount + 1;

      return {
        ...state,
        chapter: { ...chapter, wrongCount: chapter.wrongCount + 1, isShowSkip: wrongCount >= 4 },
        word: {
          ...word,
          inputWord,
          letterStates,
          hasWrong: true,
          wrongCount,
          // 出错后逐字母计时作废，重新计时
          letterTimeArray: [],
          letterMistake: { ...word.letterMistake, [i]: [...prevMistakes, inputChar] },
        },
        effect: { type: 'wrong', seq: nextSeq },
      };
    }

    case 'clearWrong': {
      if (!state.word.hasWrong) return state;
      return {
        ...state,
        word: {
          ...state.word,
          inputWord: '',
          letterStates: new Array(state.word.letterStates.length).fill('normal'),
          hasWrong: false,
        },
      };
    }

    case 'advance': {
      const { chapter } = state;
      const loopCount = chapter.loopCount + 1;

      // 循环打当前词
      if (loopCount < action.loopTimes) {
        return {
          ...state,
          chapter: { ...chapter, loopCount, wordCount: chapter.wordCount + 1, isShowSkip: false },
          word: makeWordState(chapter.words[chapter.index]),
        };
      }

      const nextIndex = chapter.index + 1;
      const advanced: ChapterState = {
        ...chapter,
        loopCount: 0,
        wordCount: chapter.wordCount + 1,
        isShowSkip: false,
      };

      // 本章最后一个词 → 结束
      if (nextIndex >= chapter.words.length) {
        return {
          ...state,
          chapter: { ...advanced, isTyping: false, isFinished: true },
          word: state.word,
        };
      }

      return {
        ...state,
        chapter: { ...advanced, index: nextIndex },
        word: makeWordState(chapter.words[nextIndex]),
      };
    }

    case 'skipWord': {
      const { chapter } = state;
      const nextIndex = chapter.index + 1;
      if (nextIndex >= chapter.words.length) {
        return {
          ...state,
          chapter: { ...chapter, isTyping: false, isFinished: true, isShowSkip: false, loopCount: 0 },
        };
      }
      return {
        ...state,
        chapter: { ...chapter, index: nextIndex, isShowSkip: false, loopCount: 0 },
        word: makeWordState(chapter.words[nextIndex]),
      };
    }

    case 'tick': {
      if (!state.chapter.isTyping || state.chapter.isFinished) return state;
      return {
        ...state,
        chapter: recomputeMetrics({ ...state.chapter, time: state.chapter.time + 1 }),
      };
    }

    case 'restart': {
      const base = createInitialState(state.chapter.words, 0, true);
      return base;
    }

    default:
      return state;
  }
}

/** 当前正在练习的词 */
export function currentWord(state: TypingState): Word | undefined {
  return state.chapter.words[state.chapter.index];
}
