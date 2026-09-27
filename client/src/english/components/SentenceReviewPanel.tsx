import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Settings2,
  Sparkles,
  Trash2,
  Undo2,
  Volume2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useConfirm } from '@/components/ConfirmDialog';
import { cn } from '@/lib/utils';
import { judge, judgeMistakes, type WordDiff } from '../judge';
import { useListeningReviewSettings } from '../reviewSettings';
import { fetchSentence, useSentenceSources, type SentenceSource } from '../sentenceSource';
import { pickSpotCheck } from '../../review/queue.ts';
import { parseSentenceKey } from '../../review/sentenceKeys.ts';
import { useSentenceCounts, useSentencePool, useSentenceStore } from '../../review/sentence.ts';
import type { ReviewItemState, ReviewMode } from '../../review/types.ts';

const LIST_LIMIT = 60;

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
};

type Session = {
  mode: Exclude<ReviewMode, 'practice'>;
  items: ReviewItemState[];
  index: number;
  /** 一轮唯一 id，用于给每条记录造会话 id */
  roundId: string;
  results: Record<string, boolean>;
};

/**
 * 听力单句的错题本。
 *
 * 与主线练习（TypePanel）的区别：
 * 主线是按音频时间轴推进的整节课，这里是从错句/备用池里抽出来的一轮询，
 * 每一句都单独播它自己的 [Start, End] 区间。判卷逻辑两边共用 judge.ts。
 */
export default function SentenceReviewPanel({ open, onOpenChange }: Props) {
  const settings = useListeningReviewSettings();
  const store = useSentenceStore();
  const confirm = useConfirm();
  const wrong = useSentencePool('wrong');
  const standby = useSentencePool('standby');
  const counts = useSentenceCounts();
  const [tab, setTab] = useState<'wrong' | 'standby'>('wrong');
  const [showSettings, setShowSettings] = useState(false);
  const [session, setSession] = useState<Session | null>(null);

  const list = tab === 'wrong' ? wrong : standby;
  const visibleKeys = useMemo(() => list.slice(0, LIST_LIMIT).map((i) => i.key), [list]);
  const { map: sources, loading: sourcesLoading } = useSentenceSources(visibleKeys);

  const startBatch = (mode: Exclude<ReviewMode, 'practice'>) => {
    const pool = mode === 'review' ? wrong : pickSpotCheck(standby, { count: settings.reviewBatchSize, lastCheckAtOf: (s) => s.lastCheckAt });
    if (pool.length === 0) {
      toast.info(mode === 'review' ? '错题池是空的' : '备用池还没有句子');
      return;
    }
    setSession({
      mode,
      items: pool.slice(0, settings.reviewBatchSize),
      index: 0,
      roundId: `round-${Date.now()}`,
      results: {},
    });
  };

  const closeSession = () => setSession(null);

  const handleClearAll = async () => {
    const ok = await confirm({
      title: '清空全部掌握态',
      message: '会删掉本机与云端的听错句 / 备用 / 毕业记录，书和系列的进度一起归零。\n课本的学习记录（判卷次数、正确率）不受影响。',
      confirmText: '清空',
      confirmClass: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
    });
    if (!ok) return;
    await store.clearAll();
    toast.success('掌握态已清空');
  };

  const handleDialogChange = (v: boolean) => {
    if (!v) closeSession();
    onOpenChange(v);
  };

  return (
    <Dialog open={open} onOpenChange={handleDialogChange}>
      <DialogContent className="flex max-h-[88vh] w-[min(46rem,94vw)] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b border-border px-5 py-3 pr-12">
          <DialogTitle className="text-base">听力错句本</DialogTitle>
          <DialogDescription className="text-xs">
            {session
              ? `${session.mode === 'review' ? '复习' : '抽查'} · ${session.items.length} 句`
              : '答错进错题池，连答对达标后进备用，备用被抽查再错就回到错题'}
          </DialogDescription>
        </DialogHeader>

        {session ? (
          <ReviewSession
            session={session}
            onExit={closeSession}
            onMove={(delta) =>
              setSession((s) => (s ? { ...s, index: Math.min(s.items.length - 1, Math.max(0, s.index + delta)) } : s))
            }
            onResult={(key, ok) =>
              setSession((s) => (s ? { ...s, results: { ...s.results, [key]: ok } } : s))
            }
          />
        ) : (
          <>
            <div className="grid shrink-0 grid-cols-3 gap-1 border-b border-border px-5 py-3 text-center">
              {(
                [
                  ['错题', counts.wrong, 'text-rose-600 dark:text-rose-400'],
                  ['备用', counts.standby, 'text-amber-600 dark:text-amber-400'],
                  ['毕业', counts.mastered, 'text-emerald-600 dark:text-emerald-400'],
                ] as const
              ).map(([label, value, tone]) => (
                <div key={label} className="rounded-md bg-muted/40 py-1.5">
                  <div className={cn('text-lg tabular-nums', tone)}>{value}</div>
                  <div className="text-[11px] text-muted-foreground">{label}</div>
                </div>
              ))}
            </div>

            <div className="flex shrink-0 items-center gap-1 border-b border-border px-4 py-2">
              {(
                [
                  ['wrong', `错题 ${counts.wrong}`],
                  ['standby', `备用 ${counts.standby}`],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  className={cn(
                    'rounded-md px-2.5 py-1 text-xs transition',
                    tab === key ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-muted',
                  )}
                >
                  {label}
                </button>
              ))}
              <div className="ml-auto flex items-center gap-1.5">
                {tab === 'wrong' ? (
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => startBatch('review')}>
                    <Sparkles size={13} className="mr-1" />
                    复习 {Math.min(settings.reviewBatchSize, wrong.length)}
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => startBatch('spotcheck')}>
                    <CheckCheck size={13} className="mr-1" />
                    抽查一轮
                  </Button>
                )}
                <button
                  type="button"
                  onClick={() => setShowSettings((v) => !v)}
                  title="复习设置"
                  className={cn(
                    'flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground',
                    showSettings && 'bg-muted text-foreground',
                  )}
                >
                  <Settings2 size={14} />
                </button>
                <button
                  type="button"
                  onClick={handleClearAll}
                  title="清空全部掌握态"
                  className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-destructive"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>

            {showSettings && <SettingsRows />}

            {list.length > LIST_LIMIT && (
              <p className="shrink-0 border-b border-border bg-muted/30 px-5 py-1.5 text-[11px] text-muted-foreground">
                只显示前 {LIST_LIMIT} 条，其余 {list.length - LIST_LIMIT} 条按当前排序排在后面
              </p>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
              {list.length === 0 ? (
                <p className="px-2 py-10 text-center text-sm text-muted-foreground">
                  {tab === 'wrong' ? '还没有听错的句子' : '备用池是空的'}
                </p>
              ) : (
                <ul className="space-y-1">
                  {list.slice(0, LIST_LIMIT).map((item) => {
                    const src = sources[item.key];
                    return (
                      <li key={item.key} className="flex items-start gap-2 rounded-md px-2 py-2 hover:bg-muted/60">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm text-foreground">
                            {src?.text ?? (sourcesLoading ? '加载中…' : '（句子已不可读）')}
                          </div>
                          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                            <span className="truncate">
                              {src?.bookName ?? parseSentenceKey(item.key)?.bookId}
                              {src?.lessonTitle ? ` · ${src.lessonTitle}` : ''}
                              {src && src.lessonIdx >= 0 ? ` · 第${src.lessonIdx + 1}课` : ''}
                            </span>
                            <span className="tabular-nums">错 {item.wrongTotal}</span>
                            <span className="tabular-nums">{item.reviewStreak}/{settings.reviewPassCount}</span>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          {item.status === 'wrong' ? (
                            <button
                              type="button"
                              title="认识了：移出错题池（仍会被抽查验证）"
                              onClick={() => {
                                store.markKnownMany([item.key], settings);
                                toast.success('已移出错题池');
                              }}
                              className="flex h-6 items-center gap-0.5 rounded-md border border-border px-1.5 text-[11px] text-muted-foreground transition hover:border-emerald-500/40 hover:text-emerald-600"
                            >
                              <Undo2 size={11} />
                              认识了
                            </button>
                          ) : (
                            <button
                              type="button"
                              title="放回错题池"
                              onClick={() => {
                                store.reopenMany([item.key]);
                                toast.success('已放回错题池');
                              }}
                              className="flex h-6 items-center gap-0.5 rounded-md border border-border px-1.5 text-[11px] text-muted-foreground transition hover:border-rose-500/40 hover:text-rose-600"
                            >
                              <RotateCcw size={11} />
                              放回
                            </button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <footer className="shrink-0 border-t border-border px-5 py-2 text-[11px] leading-relaxed text-muted-foreground">
              {tab === 'wrong'
                ? `连答对 ${settings.reviewPassCount} 次自动进入备用；也可手动标记认识。每次「造访」同一句只认第一次判卷，Redo 重听才算新机会。`
                : `抽查累计错 ${settings.spotCheckFailLimit} 次退回错题；通过 ${settings.graduateAfterCheckPass || '∞'} 次毕业归档`}
            </footer>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── 练习会话 ─────────────────────────────────────────────────────

type SessionProps = {
  session: Session;
  onExit: () => void;
  onMove: (delta: number) => void;
  onResult: (key: string, ok: boolean) => void;
};

function ReviewSession({ session, onExit, onMove, onResult }: SessionProps) {
  const settings = useListeningReviewSettings();
  const store = useSentenceStore();
  const item = session.items[session.index];
  const ref = item ? parseSentenceKey(item.key) : null;
  const [source, setSource] = useState<SentenceSource | null>(null);
  const [draft, setDraft] = useState('');
  const [result, setResult] = useState<{ passed: boolean; diff: WordDiff[]; total: number; correct: number } | null>(null);
  const [loop, setLoop] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const loopRef = useRef(loop);

  useEffect(() => {
    loopRef.current = loop;
  }, [loop]);

  // 换句子时复位输入与判卷结果
  useEffect(() => {
    setDraft('');
    setResult(null);
    setSource(null);
    if (!ref) return;
    let cancelled = false;
    void fetchSentence(ref).then((s) => {
      if (!cancelled) setSource(s);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.key]);

  /** 播这一句的区间：到 End 就停（或回头重播），不让它顺到下一句 */
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !source) return;
    const onTime = () => {
      if (audio.currentTime >= source.end) {
        if (loopRef.current) {
          audio.currentTime = source.start;
          return;
        }
        audio.pause();
      }
    };
    audio.addEventListener('timeupdate', onTime);
    return () => audio.removeEventListener('timeupdate', onTime);
  }, [source]);

  const playSlice = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !source) return;
    audio.currentTime = source.start;
    void audio.play().catch(() => toast.error('音频播放失败'));
  }, [source]);

  // 落到新句子自动播一遍，省一次点击
  useEffect(() => {
    if (source) playSlice();
  }, [source, playSlice]);

  /**
   * 会话 id 按「每一句在本次轮次里的第一次机会」生成。
   * 同一句反复提交只会采纳第一次 —— 否则对着对比结果改几遍就能把
   * 「连答对 N 次」刷满。往前翻回去也不给新机会（那只是在复查），
   * 只有点「重听」才是真的又听了一遍。
   */
  const sessionMapRef = useRef<Map<string, string>>(new Map());
  const visitSeq = useRef(0);
  const sessionFor = (key: string) => {
    const map = sessionMapRef.current;
    const hit = map.get(key);
    if (hit) return hit;
    visitSeq.current += 1;
    const id = `${session.roundId}#${visitSeq.current}`;
    map.set(key, id);
    return id;
  };

  const submit = () => {
    if (!item || !source || result) return;
    const graded = judge(draft, source.text, false);
    setResult({ passed: graded.passed, diff: graded.diff, total: graded.totalWords, correct: graded.correctCount });
    store.applyResults(
      [
        {
          key: item.key,
          ok: graded.passed,
          sessionId: sessionFor(item.key),
          unitId: ref?.bookId,
          mode: session.mode,
          mistakes: graded.passed ? undefined : judgeMistakes(graded.diff),
        },
      ],
      settings,
    );
    onResult(item.key, graded.passed);
  };

  const go = (delta: number) => {
    onMove(delta);
  };

  if (!item || !ref) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
        这一轮没有句子
      </div>
    );
  }

  const done = Object.keys(session.results).length;
  const hits = Object.values(session.results).filter(Boolean).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-5 py-2 text-xs text-muted-foreground">
        <Badge variant={session.mode === 'review' ? 'secondary' : 'outline'} className="text-[11px]">
          {session.mode === 'review' ? '复习' : '抽查'}
        </Badge>
        <span className="tabular-nums">
          {session.index + 1} / {session.items.length}
        </span>
        <span className="tabular-nums">
          已答 {done} · 对 {hits}
        </span>
        <span className="ml-auto truncate">{source?.bookName}{source?.lessonTitle ? ` · ${source.lessonTitle}` : ''}</span>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onExit}>
          结束
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
        {!source ? (
          <p className="py-10 text-center text-sm text-muted-foreground">加载句子…</p>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={playSlice}>
                <Volume2 size={13} className="mr-1" />
                播放
              </Button>
              <label className="flex cursor-pointer items-center gap-1 text-xs text-muted-foreground">
                <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} />
                循环
              </label>
              <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">
                {source.start.toFixed(1)}s – {source.end.toFixed(1)}s
              </span>
            </div>

            {result ? (
              <div className={cn('rounded-md border p-3 text-[15px] leading-relaxed', result.passed ? 'border-emerald-500' : 'border-rose-500')}>
                <div className="mb-2 text-[13px]">
                  {result.passed ? `✅ ${result.correct}/${result.total} 全对` : `❌ ${result.correct}/${result.total} 正确`}
                </div>
                <div className="flex flex-wrap gap-0.5">
                  {result.diff.map((d, i) => {
                    if (d.status === 'correct') return <span key={i} className="text-emerald-600">{d.typed}</span>;
                    if (d.status === 'wrong') return <span key={i} className="text-rose-600"><del>{d.typed}</del><em className="not-italic text-emerald-600">{d.expected}</em></span>;
                    if (d.status === 'missing') return <span key={i} className="text-muted-foreground underline decoration-dashed underline-offset-4">{d.expected}</span>;
                    return <span key={i} className="text-rose-600/75"><del>{d.typed}</del></span>;
                  })}
                </div>
                {source.trans && <div className="mt-2 text-[13px] text-muted-foreground">{source.trans}</div>}
              </div>
            ) : (
              <textarea
                className="h-28 w-full resize-none rounded-md border border-border bg-transparent p-3 text-[15px] leading-relaxed outline-none focus:border-primary"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    submit();
                  }
                }}
                placeholder="type what you hear..."
                spellCheck={false}
              />
            )}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-border px-5 py-3">
        <Button size="sm" variant="outline" className="h-8" disabled={session.index <= 0} onClick={() => go(-1)}>
          <ChevronLeft size={14} className="mr-1" />
          上一句
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-8"
          title="重新听一遍，并开一次新的判卷机会"
          onClick={() => {
            sessionMapRef.current.delete(item.key);
            setDraft('');
            setResult(null);
            playSlice();
          }}
        >
          <RotateCcw size={14} className="mr-1" />
          重听
        </Button>
        {session.index >= session.items.length - 1 ? (
          <Button size="sm" className="h-8" onClick={onExit}>
            完成这一轮
          </Button>
        ) : (
          <Button size="sm" className="h-8" onClick={() => go(1)}>
            下一句
            <ChevronRight size={14} className="ml-1" />
          </Button>
        )}
        <audio ref={audioRef} src={source?.audioSrc} preload="metadata" className="ml-auto w-[190px]" controls controlsList="nodownload" />
      </div>
    </div>
  );
}

// ── 设置旋钮 ─────────────────────────────────────────────────────

function SettingsRows() {
  const s = useListeningReviewSettings();
  const rows: { label: string; hint: string; value: number; onChange: (v: number) => void; min: number; max: number }[] = [
    { label: '连答对几次出错题池', hint: '错题 → 备用', value: s.reviewPassCount, onChange: (v) => s.update({ reviewPassCount: v }), min: 1, max: 10 },
    { label: '抽查错几次退回错题', hint: '备用 → 错题', value: s.spotCheckFailLimit, onChange: (v) => s.update({ spotCheckFailLimit: v }), min: 1, max: 10 },
    { label: '抽查通过几次毕业', hint: '0 = 永不毕业', value: s.graduateAfterCheckPass, onChange: (v) => s.update({ graduateAfterCheckPass: v }), min: 0, max: 20 },
    { label: '一轮几句', hint: '一句比一个词费时间', value: s.reviewBatchSize, onChange: (v) => s.update({ reviewBatchSize: v }), min: 1, max: 50 },
  ];

  return (
    <div className="shrink-0 space-y-1 border-b border-border bg-muted/30 px-5 py-2">
      {rows.map((r) => (
        <label key={r.label} className="flex items-center gap-2 text-xs">
          <span className="w-40 shrink-0 text-foreground">{r.label}</span>
          <span className="w-28 text-[11px] text-muted-foreground">{r.hint}</span>
          <input
            type="number"
            min={r.min}
            max={r.max}
            value={r.value}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (!Number.isFinite(n)) return;
              r.onChange(Math.min(r.max, Math.max(r.min, Math.round(n))));
            }}
            className="h-7 w-16 rounded-md border border-border bg-transparent px-2 text-center text-xs outline-none focus:border-primary"
          />
        </label>
      ))}
      <label className="flex items-center gap-2 text-xs">
        <span className="w-40 shrink-0 text-foreground">手动「认识了」去哪</span>
        <span className="w-28 text-[11px] text-muted-foreground">备用=继续被抽查</span>
        <select
          value={s.manualKnowTarget}
          onChange={(e) => s.update({ manualKnowTarget: e.target.value as 'standby' | 'mastered' })}
          className="h-7 rounded-md border border-border bg-transparent px-2 text-xs outline-none focus:border-primary"
        >
          <option value="standby">备用池</option>
          <option value="mastered">直接毕业</option>
        </select>
      </label>
      <label className="flex items-center gap-2 text-xs">
        <span className="w-40 shrink-0 text-foreground">毕业后再答错</span>
        <span className="w-28 text-[11px] text-muted-foreground">主线练习里的失手</span>
        <input
          type="checkbox"
          checked={s.masteredWrongReturnsToPool}
          onChange={(e) => s.update({ masteredWrongReturnsToPool: e.target.checked })}
        />
        <span className="text-[11px] text-muted-foreground">{s.masteredWrongReturnsToPool ? '拽回错题池' : '免疫'}</span>
      </label>
    </div>
  );
}
