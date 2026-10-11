import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useJpStore } from '@/japanese/store/useJpStore';
import { localizeLesson } from '@/japanese/utils/enOverrides';
import { ChevronRight, Check, Play, Filter } from 'lucide-react';

const CAT_LABEL: Record<string, { label: string; icon: string; color: string; darkColor: string }> = {
  characters: {
    label: '五十音', icon: 'あ',
    color: 'bg-emerald-100 text-emerald-700 border-emerald-300',
    darkColor: 'dark:bg-emerald-950/60 dark:text-emerald-400 dark:border-emerald-800',
  },
  vocabulary: {
    label: '词汇', icon: '単',
    color: 'bg-sky-100 text-sky-700 border-sky-300',
    darkColor: 'dark:bg-sky-950/60 dark:text-sky-400 dark:border-sky-800',
  },
  grammar: {
    label: '语法', icon: '文',
    color: 'bg-violet-100 text-violet-700 border-violet-300',
    darkColor: 'dark:bg-violet-950/60 dark:text-violet-400 dark:border-violet-800',
  },
  mixed: {
    label: '综合', icon: '混',
    color: 'bg-amber-100 text-amber-700 border-amber-300',
    darkColor: 'dark:bg-amber-950/60 dark:text-amber-400 dark:border-amber-800',
  },
  reading: {
    label: '阅读', icon: '読',
    color: 'bg-orange-100 text-orange-700 border-orange-300',
    darkColor: 'dark:bg-orange-950/60 dark:text-orange-400 dark:border-orange-800',
  },
};

const LEVEL_LABEL: Record<string, string> = {
  n5: 'N5', n4: 'N4', n3: 'N3', n2: 'N2', n1: 'N1',
};

/** 课程列表页 */
export function JpLessons() {
  const { init, lessons, getLessonStatus, lang, setLang } = useJpStore();
  const [search, setSearch] = useState('');
  const [levelFilter, setLevelFilter] = useState<string>('all');
  const [param, setParam] = useSearchParams();

  useEffect(() => { init(); }, [init]);

  const catFromUrl = param.get('cat') ?? 'all';
  const [catFilter, setCatFilter] = useState(catFromUrl);
  useEffect(() => { setCatFilter(catFromUrl); }, [catFromUrl]);

  const filtered = useMemo(() => {
    return lessons.filter((l) => {
      if (levelFilter !== 'all' && l.level !== levelFilter) return false;
      if (catFilter !== 'all' && l.category !== catFilter) return false;
      if (search && !l.title.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [lessons, levelFilter, catFilter, search]);

  const levels = ['all', 'n5', 'n4', 'n3'];
  const cats = ['all', 'characters', 'mixed', 'vocabulary', 'grammar', 'reading'];

  const n5Count = lessons.filter((l) => l.level === 'n5').length;
  const n4Count = lessons.filter((l) => l.level === 'n4').length;

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
      {/* 顶部 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">课程列表</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {lessons.length} 课已加载 · 序号为推荐学习顺序（全部可学，按习惯自行安排）
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* 语言开关 */}
          <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1">
            <button
              onClick={() => setLang('en')}
              className={cn(
                'rounded-md px-2 py-1 text-xs font-semibold transition-colors',
                lang === 'en' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              🇺🇸 EN
            </button>
            <button
              onClick={() => setLang('es')}
              className={cn(
                'rounded-md px-2 py-1 text-xs font-semibold transition-colors',
                lang === 'es' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              🇪🇸 ES
            </button>
          </div>
          <Link to="/jp">
            <Button variant="outline" size="sm">← 返回首页</Button>
          </Link>
        </div>
      </div>

      {/* 筛选 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1">
          {cats.map((c) => (
            <button
              key={c}
              onClick={() => { setCatFilter(c); setParam(c === 'all' ? {} : { cat: c }); }}
              className={cn(
                'rounded-md px-3 py-1 text-xs font-medium transition-colors',
                catFilter === c
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {c === 'all' ? '全部' : CAT_LABEL[c]?.label ?? c}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1">
          <Filter className="h-3 w-3 text-muted-foreground" />
          {levels.map((l) => (
            <button
              key={l}
              onClick={() => setLevelFilter(l)}
              className={cn(
                'rounded-md px-2 py-1 text-xs font-medium transition-colors',
                levelFilter === l
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {l === 'all' ? '全部' : LEVEL_LABEL[l]}
            </button>
          ))}
        </div>
      </div>

      {/* 推荐顺序区间提示 */}
      {(levelFilter === 'all' || levelFilter === 'n5' || levelFilter === 'n4') && (
        <div className="flex flex-wrap gap-1 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1 rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400">
            1-{n5Count}
          </span> N5
          {n4Count > 0 && (
            <span className="inline-flex items-center gap-1 rounded bg-blue-100 px-1.5 py-0.5 text-blue-700 dark:bg-blue-950/50 dark:text-blue-400">
              {n5Count + 1}-{n5Count + n4Count}
            </span>
          )}
          {n4Count > 0 && <> N4</>}
        </div>
      )}

      {/* 列表 */}
      <div className="space-y-2">
        {filtered.length === 0 && (
          <div className="rounded-lg border border-dashed border-border py-16 text-center text-sm text-muted-foreground">
            没有匹配的课程
          </div>
        )}
        {filtered.map((lesson) => {
          const status = getLessonStatus(lesson.id);
          const done = status === 'completed';
          const catStyle = CAT_LABEL[lesson.category];
          const loc = localizeLesson(lesson, lang);
          return (
            <Link
              key={lesson.id}
              to={`/jp/study/${lesson.id}`}
              className={cn(
                'flex items-center gap-3 rounded-lg border border-border bg-card p-3 shadow-sm transition-colors',
                'hover:border-primary/40 hover:bg-accent/50',
              )}
            >
              {/* 推荐顺序号 — 按 category 上色 */}
              <div
                className={cn(
                  'flex h-8 w-9 flex-shrink-0 items-center justify-center rounded-md border text-xs font-mono font-bold',
                  catStyle?.color ?? 'bg-muted text-muted-foreground',
                  catStyle?.darkColor ?? '',
                )}
              >
                {String(lesson.order ?? '').padStart(2, '0')}
              </div>

              {/* 状态图标 */}
              <div
                className={cn(
                  'flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md',
                  done && 'bg-green-500/10 text-green-600 dark:text-green-400',
                  !done && 'bg-primary/10 text-primary',
                )}
              >
                {done ? <Check className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </div>

              {/* 内容 */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{loc.title}</span>
                  <Badge variant="outline" className="text-xs">{LEVEL_LABEL[lesson.level]}</Badge>
                  <Badge
                    variant="outline"
                    className={cn('text-xs', catStyle?.color, catStyle?.darkColor)}
                  >
                    {catStyle?.label}
                  </Badge>
                </div>
                <p className="mt-1 truncate text-xs text-muted-foreground">{loc.description}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {lesson.items.length} 项 · {lesson.steps.length} 步
                </p>
              </div>

              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
