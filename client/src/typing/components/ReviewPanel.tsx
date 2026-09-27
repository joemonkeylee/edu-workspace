import { useMemo, useState } from 'react';
import { CheckCheck, RotateCcw, Sparkles, Trash2, Undo2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ConfirmDialog';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { pickSpotCheck } from '../../review/queue.ts';
import { useReviewCounts, useReviewPool, useWordStore } from '../../review/word.ts';
import { useTypingSettings } from '../settingsStore';
import type { ReviewItemState } from '../../review/types.ts';
import type { Word } from '../types';

const REVIEW_BATCH = 20;
const LIST_LIMIT = 80;

type Props = {
  /** 当前词库词条，用于给错词回填释义与音标 */
  sourceWords: Word[];
  /** 载入一批条目进入练习（mode 决定这次结果是「复习」还是「抽查」） */
  onStartPractice: (words: Word[], mode: 'review' | 'spotcheck') => void;
  onClose: () => void;
};

/**
 * 错题 / 备用池面板。
 *
 * 两条出池路径：
 * 1. 自动：错题专项复习里连答对 N 次 → 备用；备用被抽查累计错 M 次 → 回错题
 * 2. 手动：这里点「认识了」直接移出错题池（默认进备用，仍会被抽查验证）
 */
export default function ReviewPanel({ sourceWords, onStartPractice, onClose }: Props) {
  const settings = useTypingSettings();
  const store = useWordStore();
  const confirm = useConfirm();
  const wrong = useReviewPool('wrong');
  const standby = useReviewPool('standby');
  const counts = useReviewCounts();
  const [tab, setTab] = useState<'wrong' | 'standby'>('wrong');

  const byName = useMemo(() => {
    const m = new Map<string, Word>();
    for (const w of sourceWords) m.set(w.name.trim().toLowerCase(), w);
    return m;
  }, [sourceWords]);

  /** 词不在当前词库里时退化成只有拼写的词条 —— 打字练习只需要 name */
  const toWord = (item: ReviewItemState): Word =>
    byName.get(item.key) ?? { name: item.key, trans: [], usphone: '', ukphone: '' };

  const list = tab === 'wrong' ? wrong : standby;

  const startBatch = (mode: 'review' | 'spotcheck') => {
    const pool = mode === 'review' ? wrong : pickSpotCheck(standby, {
      count: REVIEW_BATCH,
      lastCheckAtOf: (s) => s.lastCheckAt,
    });
    if (pool.length === 0) {
      toast.info(mode === 'review' ? '错题池是空的' : '备用池还没有词');
      return;
    }
    onStartPractice(pool.map(toWord), mode);
  };

  const handleClearAll = async () => {
    const ok = await confirm({
      title: '清空全部掌握态',
      message: '会删掉本机与云端的错题 / 备用 / 毕业记录，书和分类的进度一起归零。\n练习历史（章节记录）不受影响。',
      confirmText: '清空',
      confirmClass: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
    });
    if (!ok) return;
    await store.clearAll();
    toast.success('掌握态已清空');
  };

  return (
    <aside
      data-typing-panel
      className="flex max-h-[60vh] w-full shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-card lg:max-h-none lg:w-80"
    >
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className="text-sm font-medium">错题 / 备用</span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={handleClearAll}
            title="清空全部掌握态"
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-destructive"
          >
            <Trash2 size={14} />
          </button>
          <button
            type="button"
            onClick={onClose}
            title="收起"
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <X size={15} />
          </button>
        </div>
      </header>

      <div className="grid grid-cols-3 gap-1 border-b border-border px-3 py-2 text-center">
        {(
          [
            ['错题', counts.wrong, 'text-rose-600 dark:text-rose-400'],
            ['备用', counts.standby, 'text-amber-600 dark:text-amber-400'],
            ['毕业', counts.mastered, 'text-emerald-600 dark:text-emerald-400'],
          ] as const
        ).map(([label, value, tone]) => (
          <div key={label} className="rounded-md bg-muted/40 py-1">
            <div className={cn('text-base tabular-nums', tone)}>{value}</div>
            <div className="text-[11px] text-muted-foreground">{label}</div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-1 border-b border-border px-2 py-2">
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
              'rounded-md px-2 py-1 text-xs transition',
              tab === key ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-muted',
            )}
          >
            {label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1">
          {tab === 'wrong' ? (
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => startBatch('review')}>
              <Sparkles size={13} className="mr-1" />
              复习 {Math.min(REVIEW_BATCH, wrong.length)}
            </Button>
          ) : (
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => startBatch('spotcheck')}>
              <CheckCheck size={13} className="mr-1" />
              抽查一轮
            </Button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1">
        {list.length === 0 ? (
          <p className="px-2 py-8 text-center text-sm text-muted-foreground">
            {tab === 'wrong' ? '还没有错词' : '备用池是空的'}
          </p>
        ) : (
          <ul className="space-y-0.5">
            {list.slice(0, LIST_LIMIT).map((item) => (
              <li key={item.key} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/60">
                <span className="min-w-0 flex-1 truncate text-sm">{item.key}</span>
                <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                  错 {item.wrongTotal}
                </span>
                {item.status === 'wrong' ? (
                  <>
                    <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                      {item.reviewStreak}/{settings.reviewPassCount}
                    </span>
                    <button
                      type="button"
                      title="认识了：移出错题池（仍会被抽查验证）"
                      onClick={() => {
                        store.markKnownMany([item.key], settings);
                        toast.success(`「${item.key}」已移出错题`);
                      }}
                      className="flex h-6 items-center gap-0.5 rounded-md border border-border px-1.5 text-[11px] text-muted-foreground transition hover:border-emerald-500/40 hover:text-emerald-600"
                    >
                      <Undo2 size={11} />
                      认识了
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    title="放回错题池"
                    onClick={() => {
                      store.reopenMany([item.key]);
                      toast.success(`「${item.key}」已放回错题`);
                    }}
                    className="flex h-6 items-center gap-0.5 rounded-md border border-border px-1.5 text-[11px] text-muted-foreground transition hover:border-rose-500/40 hover:text-rose-600"
                  >
                    <RotateCcw size={11} />
                    放回错题
                  </button>
                )}
              </li>
            ))}
            {list.length > LIST_LIMIT && (
              <li className="px-2 py-1.5 text-center text-[11px] text-muted-foreground">
                还有 {list.length - LIST_LIMIT} 个未显示
              </li>
            )}
          </ul>
        )}
      </div>

      <footer className="border-t border-border px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
        {tab === 'wrong'
          ? `连答对 ${settings.reviewPassCount} 次自动进入备用；也可手动标记认识`
          : `抽查累计错 ${settings.spotCheckFailLimit} 次退回错题；通过 ${settings.graduateAfterCheckPass || '∞'} 次毕业`}
      </footer>
    </aside>
  );
}
