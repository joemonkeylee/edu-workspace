import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Keyboard,
  Library,
  Play,
  Settings2,
  SkipForward,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { DEFAULT_DICT_ID, getDict, isValidDictId } from './dictionaries';
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
import SettingsPanel from './components/SettingsPanel';
import DictPanel from './components/DictPanel';
import StatsView from './components/stats/StatsView';

const LAST_DICT_KEY = 'typing-last-dict';

/** 单章完成后停留一下再进入下一个词，让用户看到完整的绿色单词 */
const ADVANCE_DELAY = 350;
/** 输错后锁定输入的时间 */
const WRONG_LOCK_DELAY = 300;

function readLastDict(): string {
  try {
    const saved = localStorage.getItem(LAST_DICT_KEY);
    // 词库清单更新后旧 id 可能已不存在，直接回落到默认词库
    return isValidDictId(saved) ? (saved as string) : DEFAULT_DICT_ID;
  } catch {
    return DEFAULT_DICT_ID;
  }
}

export default function TypingHome() {
  const settings = useTypingSettings();
  const [dictId, setDictId] = useState<string>(readLastDict);
  const [chapter, setChapter] = useState(0);
  const [resultOpen, setResultOpen] = useState(false);
  const [reviewWords, setReviewWords] = useState<Word[] | null>(null);
  /** 「默认隐藏释义」开启时，用户主动查看释义的临时状态 */
  const [showAnswer, setShowAnswer] = useState(false);
  /** 页面视图：练习 / 统计 */
  const [view, setView] = useState<'practice' | 'stats'>('practice');
  /** 统计视图首次打开后再挂载，之后保留（避免来回切换重复请求） */
  const [statsMounted, setStatsMounted] = useState(false);

  useEffect(() => {
    if (view === 'stats') setStatsMounted(true);
  }, [view]);

  const { words, loading, error } = useDictWords(dictId);
  const [state, dispatch] = useReducer(typingReducer, undefined, () => createInitialState([]));

  const isReview = reviewWords !== null;
  const savedRef = useRef(false);

  // 让发音回调保持稳定引用：读 ref 而非闭包里的 state，
  // 避免每次按键都重建回调、进而反复解绑/绑定全局键盘监听
  const stateRef = useRef(state);
  stateRef.current = state;
  const pronunciationTypeRef = useRef(settings.pronunciationType);
  pronunciationTypeRef.current = settings.pronunciationType;

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

  // 切词（含循环重打）时收起手动展开的释义
  useEffect(() => {
    setShowAnswer(false);
  }, [state.chapter.index, state.chapter.loopCount]);

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
  const pronounce = useCallback((word?: Word) => {
    const target = word ?? currentWord(stateRef.current);
    if (target) playPronunciation(target.name, pronunciationTypeRef.current);
  }, []);

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
    if (resultOpen) return;

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;

      // 统计页不响应打字快捷键（Tab/Esc/字母），避免背景误触
      if (view !== 'practice') return;

      // 设置面板内的任何按键都不参与打字：面板里的 Select / Slider / 开关
      // 都是 button 或 input，若不过滤，调节设置时会被当成打字输入
      if (target?.closest('[data-typing-panel]')) return;
      // Radix Select 的浮层通过 portal 渲染在 body 下，不在面板 DOM 内，单独排除
      if (document.querySelector('[role="listbox"]')) return;

      // Ctrl/Cmd + J 发音
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        pronounce();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

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
    view,
    settings.isIgnoreCase,
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
  // 「默认隐藏释义」开启时必须由用户主动触发（点击或 Tab）才显示，
  // 打完单词也不自动展开，否则这一设置等于没生效
  const showTrans = settings.isTransHidden ? showAnswer : true;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {/* 工具栏：视图切换在最左，章节导航居中，面板开关靠右 */}
      <div className="flex flex-wrap items-center gap-2">
        {/* 练习 / 统计 视图切换 */}
        <div className="flex items-center rounded-lg border border-border p-0.5">
          {(
            [
              ['practice', '练习', <Keyboard key="i" size={14} />],
              ['stats', '统计', <BarChart3 key="i" size={14} />],
            ] as const
          ).map(([v, label, icon]) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              aria-pressed={view === v}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors',
                view === v
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {icon}
              {label}
            </button>
          ))}
        </div>

        {/* 章节导航与错词复习只在练习视图下有意义 */}
        {view === 'practice' && (
          <div className="flex flex-wrap items-center gap-2">
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
        )}

        {/* 两个侧栏只在练习视图存在，统计视图下隐藏开关，避免点了没反应 */}
        {view === 'practice' && (
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant={settings.dictPanelOpen ? 'default' : 'outline'}
              size="sm"
              aria-pressed={settings.dictPanelOpen}
              onClick={settings.toggleDictPanel}
              title="显示 / 收起词库列表"
            >
              <Library size={15} className="mr-1.5 shrink-0" />
              <span className="max-w-[9rem] truncate">{dict.name}</span>
            </Button>

            <Button
              variant={settings.panelOpen ? 'default' : 'outline'}
              size="sm"
              aria-pressed={settings.panelOpen}
              onClick={settings.togglePanel}
            >
              <Settings2 size={15} className="mr-1.5" />
              设置
            </Button>
          </div>
        )}
      </div>

      {view === 'stats' ? (
        <div className="min-h-0 flex-1">
          <StatsView />
        </div>
      ) : (
        <>
      {/* 词库列表 + 练习区 + 设置面板 */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
        {settings.dictPanelOpen && (
          <DictPanel value={dictId} onChange={handleSelectDict} />
        )}

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
              transToggleable={settings.isTransHidden}
              onToggleTrans={() => setShowAnswer((v) => !v)}
              pronunciationType={settings.pronunciationType}
              blindMode={settings.blindMode}
              hidePhonetic={settings.isPhoneticHidden}
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

        {settings.panelOpen && <SettingsPanel />}
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
        </>
      )}

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
    </div>
  );
}
