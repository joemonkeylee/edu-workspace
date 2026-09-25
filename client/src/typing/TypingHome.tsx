import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Keyboard,
  Play,
  Settings2,
  SkipForward,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { DICTIONARIES, getDict } from './dictionaries';
import { CHAPTER_LENGTH, createInitialState, currentWord, typingReducer } from './engine';
import { playCorrectSound, playKeySound, playWrongSound } from './sounds';
import { playPronunciation } from './pronunciation';
import { useTypingSettings } from './settingsStore';
import { chapterCountOf, shuffle, sliceChapter, useDictWords } from './useDictWords';
import { buildReviewWords, fetchWrongWords, syncChapterRecord, syncWordLogs } from './records';
import type { Word } from './types';
import WordDisplay from './components/WordDisplay';
import StatsBar from './components/StatsBar';
import ChapterResult from './components/ChapterResult';
import SettingsDialog from './components/SettingsDialog';

const LAST_DICT_KEY = 'typing-last-dict';

/** 单章完成后停留一下再进入下一个词，让用户看到完整的绿色单词 */
const ADVANCE_DELAY = 350;
/** 输错后锁定输入的时间 */
const WRONG_LOCK_DELAY = 300;

function readLastDict(): string {
  try {
    return localStorage.getItem(LAST_DICT_KEY) ?? DICTIONARIES[0].id;
  } catch {
    return DICTIONARIES[0].id;
  }
}

export default function TypingHome() {
  const settings = useTypingSettings();
  const [dictId, setDictId] = useState<string>(readLastDict);
  const [chapter, setChapter] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [resultOpen, setResultOpen] = useState(false);
  const [reviewWords, setReviewWords] = useState<Word[] | null>(null);
  const [showAnswer, setShowAnswer] = useState(false);

  const { words, loading, error } = useDictWords(dictId);
  const [state, dispatch] = useReducer(typingReducer, undefined, () => createInitialState([]));

  const isReview = reviewWords !== null;
  const savedRef = useRef(false);

  const chapterWords = useMemo(() => {
    const base = isReview ? reviewWords.slice(0, CHAPTER_LENGTH) : words ? sliceChapter(words, chapter) : [];
    return settings.isShuffle ? shuffle(base) : base;
  }, [words, chapter, isReview, reviewWords, settings.isShuffle]);

  const totalChapters = useMemo(
    () => (words ? chapterCountOf(words.length) : 1),
    [words],
  );

  // 词表变化 → 重置章节状态
  useEffect(() => {
    savedRef.current = false;
    setResultOpen(false);
    // 不自动开始：浏览器要求先有用户交互才能播放音频，
    // 也让用户有时间看清本章第一个词
    dispatch({ type: 'setup', words: chapterWords });
  }, [chapterWords]);

  // ── 计时 ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!state.chapter.isTyping || state.chapter.isFinished) return;
    const id = window.setInterval(() => dispatch({ type: 'tick' }), 1000);
    return () => window.clearInterval(id);
  }, [state.chapter.isTyping, state.chapter.isFinished]);

  // ── 输错后清空重打 ──────────────────────────────────────────────
  useEffect(() => {
    if (!state.word.hasWrong) return;
    const id = window.setTimeout(() => dispatch({ type: 'clearWrong' }), WRONG_LOCK_DELAY);
    return () => window.clearTimeout(id);
  }, [state.word.hasWrong]);

  // ── 音效副作用 ──────────────────────────────────────────────────
  useEffect(() => {
    const { type } = state.effect;
    if (type === 'correct' && settings.isKeySoundOpen) {
      playKeySound(settings.keySoundName, settings.keySoundVolume);
    } else if (type === 'wrong' && settings.isHintSoundOpen) {
      playWrongSound(settings.hintSoundVolume);
    } else if (type === 'finish' && settings.isHintSoundOpen) {
      playCorrectSound(settings.hintSoundVolume);
    }
    // 只在 effect 序号变化时触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.effect.seq]);

  // ── 完成单词 → 进入下一个 ───────────────────────────────────────
  useEffect(() => {
    if (state.effect.type !== 'finish') return;
    const id = window.setTimeout(
      () => dispatch({ type: 'advance', loopTimes: settings.loopTimes }),
      ADVANCE_DELAY,
    );
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.effect.seq, state.effect.type, settings.loopTimes]);

  // ── 新词自动发音 ────────────────────────────────────────────────
  const pronounce = useCallback(
    (word?: Word) => {
      const target = word ?? currentWord(state);
      if (target) playPronunciation(target.name, settings.pronunciationType);
    },
    [state, settings.pronunciationType],
  );

  useEffect(() => {
    if (!settings.isPronunciationOpen || !state.chapter.isTyping) return;
    pronounce();
    // 切词（含循环重打）时触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.chapter.index, state.chapter.loopCount, state.chapter.isTyping]);

  // ── 章节完成：上报记录 + 弹出结果 ───────────────────────────────
  useEffect(() => {
    if (!state.chapter.isFinished || savedRef.current) {
      if (state.chapter.isFinished) setResultOpen(true);
      return;
    }
    savedRef.current = true;
    setResultOpen(true);

    const { timeSec, correctCount, wrongCount, wordCount } = {
      timeSec: state.chapter.time,
      correctCount: state.chapter.correctCount,
      wrongCount: state.chapter.wrongCount,
      wordCount: state.chapter.wordCount,
    };

    void (async () => {
      try {
        await syncWordLogs(dictId, isReview ? -1 : chapter, state.wordLogs);
        await syncChapterRecord({
          dictId,
          chapter: isReview ? -1 : chapter,
          timeSec,
          correctCount,
          wrongCount,
          wordCount,
        });
      } catch {
        toast.error('练习记录保存失败，已保留在本机');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.chapter.isFinished]);

  // ── 键盘输入 ────────────────────────────────────────────────────
  useEffect(() => {
    if (settingsOpen || resultOpen) return;

    const onKeyDown = (e: KeyboardEvent) => {
      // Ctrl/Cmd + J 发音
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        pronounce();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }

      if (e.key === 'Tab') {
        e.preventDefault();
        setShowAnswer((v) => !v);
        return;
      }

      if (e.key === 'Escape') {
        if (state.chapter.isTyping && !state.chapter.isFinished) dispatch({ type: 'skipWord' });
        return;
      }

      // 未开始 → 任意可输入字符即开始
      if (!state.chapter.isTyping && !state.chapter.isFinished) {
        if (e.key.length === 1) {
          e.preventDefault();
          dispatch({ type: 'start' });
        }
        return;
      }

      if (e.key.length !== 1) return;
      e.preventDefault();
      dispatch({ type: 'input', char: e.key, ignoreCase: settings.isIgnoreCase });
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    settings.isIgnoreCase,
    settingsOpen,
    resultOpen,
    pronounce,
    state.chapter.isTyping,
    state.chapter.isFinished,
  ]);

  // ── 交互 ────────────────────────────────────────────────────────
  const handleSelectDict = (id: string) => {
    setDictId(id);
    setChapter(0);
    setReviewWords(null);
    try {
      localStorage.setItem(LAST_DICT_KEY, id);
    } catch {
      /* ignore */
    }
  };

  const handleNextChapter = () => {
    if (chapter + 1 >= totalChapters) {
      toast.info('已经是最后一章了');
      return;
    }
    setChapter((c) => c + 1);
  };

  const handleRetry = () => {
    setResultOpen(false);
    // 允许重练完成后再次上报
    savedRef.current = false;
    dispatch({ type: 'restart' });
  };

  const handleStartReview = async () => {
    try {
      const wrong = await fetchWrongWords(dictId, CHAPTER_LENGTH);
      if (wrong.length === 0) {
        toast.info('这个词库还没有错词，先练一章吧');
        return;
      }
      // 释义从当前词库回填，保证复习时也有中文提示
      setReviewWords(buildReviewWords(wrong, words ?? []));
      toast.success(`已载入 ${wrong.length} 个错词`);
    } catch {
      toast.error('错词本加载失败');
    }
  };

  const exitReview = () => setReviewWords(null);

  const dict = getDict(dictId);
  const word = currentWord(state);
  const showTrans = (settings.isTransHidden ? showAnswer : true) || state.word.isFinished;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {/* 工具栏 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={dictId} onValueChange={handleSelectDict}>
            <SelectTrigger className="h-9 w-[11rem]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DICTIONARIES.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {isReview ? (
            <Button variant="outline" size="sm" onClick={exitReview}>
              退出错词复习
            </Button>
          ) : (
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                className="h-9 w-9"
                disabled={chapter === 0}
                onClick={() => setChapter((c) => Math.max(0, c - 1))}
                title="上一章"
              >
                <ChevronLeft size={16} />
              </Button>
              <span className="min-w-[5.5rem] text-center text-sm tabular-nums text-muted-foreground">
                第 {chapter + 1} / {totalChapters} 章
              </span>
              <Button
                variant="outline"
                size="icon"
                className="h-9 w-9"
                disabled={chapter + 1 >= totalChapters}
                onClick={handleNextChapter}
                title="下一章"
              >
                <ChevronRight size={16} />
              </Button>
            </div>
          )}

          <Button variant="outline" size="sm" onClick={handleStartReview}>
            <Sparkles size={15} className="mr-1.5" />
            错词复习
          </Button>
        </div>

        <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>
          <Settings2 size={15} className="mr-1.5" />
          设置
        </Button>
      </div>

      {/* 练习区 */}
      <div className="relative flex min-h-[16rem] flex-1 items-center justify-center overflow-hidden rounded-xl border border-border bg-card px-6">
        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Keyboard size={16} className="animate-pulse" />
            正在加载 {dict.name}…
          </div>
        )}

        {!loading && error && (
          <div className="text-center">
            <p className="text-sm text-destructive">词库加载失败：{error}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => handleSelectDict(dictId)}>
              重试
            </Button>
          </div>
        )}

        {!loading && !error && chapterWords.length === 0 && (
          <p className="text-sm text-muted-foreground">当前没有可练习的单词</p>
        )}

        {!loading && !error && word && chapterWords.length > 0 && (
          <WordDisplay
            word={word}
            state={state.word}
            fontSize={settings.fontSize}
            showTrans={showTrans}
            pronunciationType={settings.pronunciationType}
            onPronounce={() => pronounce(word)}
          />
        )}

        {/* 未开始的引导层 */}
        {!loading && !error && chapterWords.length > 0 && !state.chapter.isTyping && !state.chapter.isFinished && (
          <button
            type="button"
            onClick={() => dispatch({ type: 'start' })}
            className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-card/80 backdrop-blur-sm transition hover:bg-card/70"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <Play size={20} />
            </span>
            <span className="text-sm text-muted-foreground">点击或按任意字母键开始</span>
          </button>
        )}

        {/* 错误过多时提示可跳过 */}
        {state.chapter.isShowSkip && (
          <button
            type="button"
            onClick={() => dispatch({ type: 'skipWord' })}
            className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            跳过（Esc）
            <SkipForward size={13} />
          </button>
        )}

        {isReview && (
          <span className="absolute left-3 top-3 rounded-md bg-accent px-2 py-0.5 text-xs text-accent-foreground">
            错词复习
          </span>
        )}
      </div>

      {/* 统计 */}
      <StatsBar
        time={state.chapter.time}
        wpm={state.chapter.wpm}
        accuracy={state.chapter.accuracy}
        index={state.chapter.index}
        total={chapterWords.length}
        wrongCount={state.chapter.wrongCount}
        isTyping={state.chapter.isTyping}
      />

      <ChapterResult
        open={resultOpen}
        onOpenChange={setResultOpen}
        timeSec={state.chapter.time}
        wpm={state.chapter.wpm}
        accuracy={state.chapter.accuracy}
        wordCount={state.chapter.wordCount}
        correctCount={state.chapter.correctCount}
        wrongCount={state.chapter.wrongCount}
        hasNextChapter={!isReview && chapter + 1 < totalChapters}
        onRetry={handleRetry}
        onNextChapter={() => {
          setResultOpen(false);
          handleNextChapter();
        }}
      />

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
