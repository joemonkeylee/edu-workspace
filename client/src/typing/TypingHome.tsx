import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  BarChart3,
  BookMarked,
  ChevronLeft,
  ChevronRight,
  Keyboard,
  Library,
  Play,
  Settings2,
  SkipForward,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { getDict } from './dictionaries';
import { CHAPTER_LENGTH, createInitialState, currentWord, typingReducer } from './engine';
import { playCorrectSound, playKeySound, playWrongSound } from './sounds';
import { playPronunciation } from './pronunciation';
import { useTypingSettings } from './settingsStore';
import { chapterCountOf, shuffle, sliceChapter, useDictWords } from './useDictWords';
import { syncChapterRecord, syncWordLogs } from './records';
import { buildMixedQueue, pickSpotCheck } from '../review/queue.ts';
import { useDictProgress, useReviewCounts, useReviewHydrate, useReviewPool, useWordStore } from '../review/word.ts';
import type { ReviewInput, ReviewMode } from '../review/types.ts';
import type { Word } from './types';
import WordDisplay from './components/WordDisplay';
import StatsBar from './components/StatsBar';
import ChapterResult from './components/ChapterResult';
import SettingsPanel from './components/SettingsPanel';
import DictPanel from './components/DictPanel';
import ReviewPanel from './components/ReviewPanel';
import StatsView from './components/stats/StatsView';

/** 单章完成后停留一下再进入下一个词，让用户看到完整的绿色单词 */
const ADVANCE_DELAY = 350;
/** 输错后锁定输入的时间 */
const WRONG_LOCK_DELAY = 300;

export default function TypingHome() {
  const settings = useTypingSettings();
  const dictId = settings.selectedDictId;
  const [chapter, setChapter] = useState(0);
  const [resultOpen, setResultOpen] = useState(false);
  const [reviewWords, setReviewWords] = useState<Word[] | null>(null);
  /** 「默认隐藏释义」开启时，用户主动查看释义的临时状态 */
  const [showAnswer, setShowAnswer] = useState(false);
  /** 页面视图：练习 / 统计 */
  const [view, setView] = useState<'practice' | 'stats'>('practice');
  /** 统计视图首次打开后再挂载，之后保留（避免来回切换重复请求） */
  const [statsMounted, setStatsMounted] = useState(false);

  const [reviewPanelOpen, setReviewPanelOpen] = useState(false);
  /** 本次练习/复习/抽查的场景，决定这批结果怎么计入三池 */
  const [reviewMode, setReviewMode] = useState<ReviewMode>('review');

  useEffect(() => {
    if (view === 'stats') setStatsMounted(true);
  }, [view]);

  const { words, loading, error } = useDictWords(dictId);
  const [state, dispatch] = useReducer(typingReducer, undefined, () => createInitialState([]));

  // ── 复习引擎：掌握态 ───────────────────────────────────────────
  useReviewHydrate();
  const wordStore = useWordStore();
  const dictProgress = useDictProgress(dictId);
  const reviewCounts = useReviewCounts();
  const standbyPool = useReviewPool('standby');
  /** 当前这批结果所属的会话，以及其中哪些词是被混进来的抽查词 */
  const sessionRef = useRef<{ sessionId: string; injected: Set<string> }>({ sessionId: '', injected: new Set() });
  /** 本次会话里偷看过答案的词：这些词的「答对」不计入晋级次数 */
  const peekedRef = useRef<Set<string>>(new Set());

  const isReview = reviewWords !== null;
  const savedRef = useRef(false);

  // 让发音回调保持稳定引用：读 ref 而非闭包里的 state，
  // 避免每次按键都重建回调、进而反复解绑/绑定全局键盘监听
  const stateRef = useRef(state);
  stateRef.current = state;
  const pronunciationTypeRef = useRef(settings.pronunciationType);
  pronunciationTypeRef.current = settings.pronunciationType;

  /**
   * 练习队列。
   * 主线章节里会按 spotCheckMixRatio 混入备用池的词（抽查），
   * 混进来的词在结果回写时标记成 mode='spotcheck'，走另一套计数。
   */
  const queueInfo = useMemo(() => {
    const sessionId = `${dictId}:${chapter}:${isReview ? 'r' : 'p'}:${Date.now()}`;
    const prepared = (list: Word[]) => (settings.isShuffle ? shuffle(list) : list);

    if (isReview) {
      return { queue: prepared(reviewWords).slice(0, CHAPTER_LENGTH), injected: new Set<string>(), sessionId };
    }

    const base = prepared(words ? sliceChapter(words, chapter) : []);
    if (base.length === 0 || settings.spotCheckMixRatio <= 0 || standbyPool.length === 0) {
      return { queue: base, injected: new Set<string>(), sessionId };
    }

    // 备用词要还原成可练习的词条：优先用当前词库里的释义与音标
    const byName = new Map<string, Word>();
    for (const w of words ?? []) byName.set(w.name.trim().toLowerCase(), w);
    const candidates = pickSpotCheck(standbyPool, {
      count: Math.max(2, Math.round(base.length * settings.spotCheckMixRatio) * 2),
      lastCheckAtOf: (s) => s.lastCheckAt,
    });
    const standbyWords = candidates.map(
      (s) => byName.get(s.key) ?? { name: s.key, trans: [], usphone: '', ukphone: '' },
    );

    const mixed = buildMixedQueue({
      main: base,
      standby: standbyWords,
      keyOf: (w) => w.name.trim().toLowerCase(),
      ratio: settings.spotCheckMixRatio,
      mode: settings.spotCheckMixMode,
    });
    return { sessionId, queue: mixed.queue, injected: mixed.injectedKeys };
  }, [
    words,
    chapter,
    isReview,
    reviewWords,
    settings.isShuffle,
    settings.spotCheckMixRatio,
    settings.spotCheckMixMode,
    dictId,
    // standbyPool 刻意不进依赖：每答完一章它都会变，跟着重算会把刚打完的这一章
    // 重置掉，还会把结算弹窗就地关掉。备用池只在「生成队列这一刻」取样。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ]);

  const chapterWords = queueInfo.queue;

  // 换一批练习就换一个会话 id：同一会话内重复命中同一个词只计一次
  useEffect(() => {
    sessionRef.current = { sessionId: queueInfo.sessionId, injected: queueInfo.injected };
    peekedRef.current = new Set();
  }, [queueInfo]);

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

  // 主动看过答案的词，本次答对不计入晋级次数
  useEffect(() => {
    if (!showAnswer) return;
    const w = currentWord(state);
    if (w) peekedRef.current.add(w.name.trim().toLowerCase());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAnswer]);

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

  // ── 章节完成：上报记录 + 写入掌握态 + 弹出结果 ─────────────────
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

    // 把这一章每个词的结果翻译成复习引擎的输入，三池随之流转动
    const { sessionId, injected } = sessionRef.current;
    const inputs: ReviewInput[] = state.wordLogs.map((log) => {
      const key = log.word.trim().toLowerCase();
      return {
        key,
        ok: log.wrongCount === 0,
        sessionId,
        unitId: dictId,
        mode: injected.has(key) ? 'spotcheck' : isReview ? reviewMode : 'practice',
        mistakes: log.mistakes,
        // 看过答案的「答对」不计入晋级，但也不算错
        peeked: log.wrongCount === 0 && peekedRef.current.has(key),
      };
    });
    const summary = wordStore.applyResults(inputs, settings);

    if (summary.promotedToStandby.length > 0 || summary.demotedToWrong.length > 0 || summary.promotedToMastered.length > 0) {
      const parts: string[] = [];
      if (summary.promotedToStandby.length > 0) parts.push(`${summary.promotedToStandby.length} 个进入备用`);
      if (summary.promotedToMastered.length > 0) parts.push(`${summary.promotedToMastered.length} 个毕业`);
      if (summary.demotedToWrong.length > 0) parts.push(`${summary.demotedToWrong.length} 个回到错题`);
      toast.success(`进度已更新：${parts.join('、')}`);
    }

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
    settings.setSelectedDictId(id);
    setChapter(0);
    setReviewWords(null);
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

  const handleLoadPool = (list: Word[], mode: ReviewMode) => {
    if (list.length === 0) return;
    setReviewMode(mode);
    setReviewWords(list);
    setReviewPanelOpen(false);
    toast.success(mode === 'spotcheck' ? `抽查 ${list.length} 个备用词` : `复习 ${list.length} 个错词`);
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

        {/* 本书掌握度：分母是这本书去重后的词数，不是原始词条数 */}
        {view === 'practice' && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="hidden sm:inline">掌握</span>
            <span className="tabular-nums">
              {dictProgress.data ? `${(dictProgress.data.masteredRate * 100).toFixed(1)}%` : '—'}
            </span>
            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all"
                style={{ width: `${Math.round((dictProgress.data?.masteredRate ?? 0) * 100)}%` }}
              />
            </div>
            {dictProgress.data && (
              <span
                className="hidden tabular-nums md:inline"
                title={`已接触 ${dictProgress.data.total - dictProgress.data.untouched} / 去重后 ${dictProgress.data.total} 词`}
              >
                {dictProgress.data.standby + dictProgress.data.mastered}/{dictProgress.data.total}
              </span>
            )}
          </div>
        )}

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

            <Button
              variant={reviewPanelOpen ? 'default' : 'outline'}
              size="sm"
              aria-pressed={reviewPanelOpen}
              onClick={() => setReviewPanelOpen((v) => !v)}
            >
              <BookMarked size={15} className="mr-1.5" />
              错题 {reviewCounts.wrong} · 备用 {reviewCounts.standby}
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

        {reviewPanelOpen && (
          <ReviewPanel
            sourceWords={words ?? []}
            onStartPractice={handleLoadPool}
            onClose={() => setReviewPanelOpen(false)}
          />
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
              {reviewMode === 'spotcheck' ? '抽查备用词' : '错题复习'}
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
