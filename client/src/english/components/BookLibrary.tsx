import { useMemo, useState } from 'react'
import { Search, X, Layers, BookOpen, Clock } from 'lucide-react'
import { BOOKS } from '../constants'
import { loadProgress, learnedLessons, type ProgressMap } from '../progress'
import { cn } from '@/lib/utils'

type BookEntry = (typeof BOOKS)[number]

interface Member {
  book: BookEntry
  idx: number
}

interface Series {
  key: string
  name: string
  tag?: string
  members: Member[]
  total: number
  learned: number
  lastAt: number
  difficulty: number
}

const TAG_COLORS: Record<string, string> = {
  '新概念英音': 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
  '新概念美音': 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300',
  '经典教材': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  '口译练习': 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  '英音': 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  '美音': 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
  'PTE': 'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300',
  'IELTS': 'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300',
  'TOFEL': 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-500/15 dark:text-fuchsia-300',
  '剑桥商务英语': 'bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300',
  '美剧': 'bg-pink-100 text-pink-700 dark:bg-pink-500/15 dark:text-pink-300',
  '罗尔德达尔': 'bg-lime-100 text-lime-700 dark:bg-lime-500/15 dark:text-lime-300',
  '高中听力': 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
  '大学听力': 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
}

const getTagColor = (tag?: string) => {
  if (!tag) return 'bg-muted text-muted-foreground'
  return TAG_COLORS[tag] || 'bg-secondary text-secondary-foreground'
}

/** 难度 1-10 的颜色标签 */
const getDifficultyColor = (d: number) => {
  if (d <= 3) return 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
  if (d <= 5) return 'bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30'
  if (d <= 7) return 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30'
  return 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30'
}

const ALL = 'all'
const CONTINUE = 'continue'
const UNTAGGED = 'untagged'

/** 子项贴片默认显示数量，超出折叠为 +N */
const TILE_LIMIT = 8

const tileCols = (n: number) => (n <= 4 ? 2 : n <= 9 ? 3 : 4)

export default function BookLibrary({ onSelect }: { onSelect: (idx: number) => void }) {
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<string>(ALL)
  const [sort, setSort] = useState<'default' | 'recent' | 'lessons' | 'difficulty_asc' | 'difficulty_desc'>('default')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [progress] = useState<ProgressMap>(() => loadProgress())

  // 系列骨架：按 series 字段聚合，单本教材自成一个系列
  const seriesBase = useMemo<Series[]>(() => {
    const map = new Map<string, { name: string; tag?: string; members: Member[] }>()
    BOOKS.forEach((book, idx) => {
      const key = book.series || book.name
      const hit = map.get(key)
      if (hit) {
        hit.members.push({ book, idx })
        if (!hit.tag) hit.tag = book.tag
      } else {
        map.set(key, { name: key, tag: book.tag, members: [{ book, idx }] })
      }
    })
    return Array.from(map, ([key, v]) => ({
      key,
      name: v.name,
      tag: v.tag,
      members: v.members,
      total: 0,
      learned: 0,
      lastAt: 0,
      difficulty: 0,
    }))
  }, [])

  const categoryCounts = useMemo(() => {
    const byTag = new Map<string, number>()
    let untagged = 0
    let started = 0
    BOOKS.forEach(b => {
      if (b.tag) byTag.set(b.tag, (byTag.get(b.tag) || 0) + 1)
      else untagged += 1
      if (progress[b.id]) started += 1
    })
    return { byTag, tags: Array.from(byTag.entries()), untagged, started, total: BOOKS.length }
  }, [progress])

  const visibleSeries = useMemo<Series[]>(() => {
    const q = search.trim().toLowerCase()
    const list: Series[] = []

    seriesBase.forEach(s => {
      let members = s.members

      if (category === CONTINUE) {
        members = members.filter(m => !!progress[m.book.id])
      } else if (category === UNTAGGED) {
        if (s.members.some(m => m.book.tag)) return
      } else if (category !== ALL) {
        if (!s.members.some(m => m.book.tag === category)) return
      }

      if (q) {
        const seriesHit = s.name.toLowerCase().includes(q)
        if (!seriesHit) members = members.filter(m => m.book.name.toLowerCase().includes(q))
      }

      if (members.length === 0) return

      const total = members.reduce((a, m) => a + m.book.count, 0)
      const learned = members.reduce((a, m) => a + Math.min(learnedLessons(progress[m.book.id]), m.book.count), 0)
      const lastAt = members.reduce((a, m) => Math.max(a, progress[m.book.id]?.updatedAt || 0), 0)
      const avgDifficulty = members.reduce((a, m) => a + (m.book.difficulty ?? 5), 0) / members.length
      list.push({ ...s, members, total, learned, lastAt, difficulty: Math.round(avgDifficulty * 10) / 10 })
    })

    if (sort === 'recent') {
      list.sort((a, b) => (b.lastAt && !a.lastAt ? 1 : !b.lastAt && a.lastAt ? -1 : b.lastAt - a.lastAt))
    } else if (sort === 'lessons') {
      list.sort((a, b) => b.total - a.total)
    } else if (sort === 'difficulty_asc') {
      list.sort((a, b) => a.difficulty - b.difficulty)
    } else if (sort === 'difficulty_desc') {
      list.sort((a, b) => b.difficulty - a.difficulty)
    }
    return list
  }, [seriesBase, category, progress, search, sort])

  const navItem = (key: string, label: string, count: number, icon?: React.ReactNode) => (
    <button
      type="button"
      onClick={() => setCategory(key)}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition',
        category === key
          ? 'bg-primary/10 font-normal text-primary'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      {icon}
      <span className="truncate">{label}</span>
      <span className="ml-auto tabular-nums opacity-70">{count}</span>
    </button>
  )

  const categoryLabel =
    category === ALL ? '全部教材'
      : category === CONTINUE ? '继续学习'
        : category === UNTAGGED ? '未分类'
          : category

  return (
    <div className="flex gap-4">
      {/* 左侧分类导航 */}
      <nav className="sticky top-0 w-44 flex-shrink-0 self-start">
        <div className="relative mb-3">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" size={13} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索教材..."
            className="w-full rounded-lg border border-border bg-card py-1.5 pl-7 pr-6 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-1.5 top-1/2 flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded-full bg-muted-foreground/30 text-white hover:bg-muted-foreground/50"
            >
              <X size={10} strokeWidth={3} />
            </button>
          )}
        </div>

        <div className="space-y-0.5">
          {navItem(ALL, '全部教材', categoryCounts.total, <Layers size={13} className="flex-shrink-0" />)}
          {navItem(CONTINUE, '继续学习', categoryCounts.started, <Clock size={13} className="flex-shrink-0" />)}
        </div>

        <div className="my-2 h-px bg-border" />
        <div className="mb-1 px-2 text-[11px] text-muted-foreground">分类</div>
        <div className="space-y-0.5">
          {categoryCounts.tags.map(([tag, count]) => navItem(tag, tag, count))}
          {categoryCounts.untagged > 0 && navItem(UNTAGGED, '未分类', categoryCounts.untagged)}
        </div>
      </nav>

      {/* 右侧系列区 */}
      <section className="min-w-0 flex-1">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-normal">{categoryLabel}</h2>
          <span className="text-xs text-muted-foreground">
            {visibleSeries.length} 个系列 · {visibleSeries.reduce((a, s) => a + s.members.length, 0)} 套
          </span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
            className="ml-auto rounded-lg border border-border bg-card px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="default">默认顺序</option>
            <option value="difficulty_asc">难度从低到高</option>
            <option value="difficulty_desc">难度从高到低</option>
            <option value="recent">最近学习</option>
            <option value="lessons">课数从多到少</option>
          </select>
        </div>

        {visibleSeries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <BookOpen size={40} className="mb-3 opacity-40" />
            <p className="text-sm">没有匹配的教材</p>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3">
            {visibleSeries.map(s => {
              const percent = s.total > 0 ? Math.min(100, (s.learned / s.total) * 100) : 0
              const single = s.members.length === 1
              const isExpanded = !!expanded[s.key]
              const shown = isExpanded ? s.members : s.members.slice(0, TILE_LIMIT)
              const hidden = s.members.length - shown.length

              return (
                <div
                  key={s.key}
                  className="flex flex-col rounded-lg border border-border bg-card p-3 transition hover:border-primary/40"
                >
                  {/* 标题行 */}
                  <div className="flex items-baseline gap-2">
                    <h3 className="min-w-0 flex-1 truncate text-sm font-normal" title={s.name}>{s.name}</h3>
                    <span className={cn('rounded border px-1.5 py-0.5 text-[10px] font-medium tabular-nums', getDifficultyColor(s.difficulty))}>
                      难度 {s.difficulty}
                    </span>
                    <span className="flex-shrink-0 text-[11px] tabular-nums text-muted-foreground">
                      {single ? `${s.total} 课` : `${s.members.length} 套 · ${s.total} 课`}
                    </span>
                  </div>

                  {/* 分类标签行：与子项分区独立 */}
                  {s.tag && (
                    <div className="mt-1.5">
                      <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-normal', getTagColor(s.tag))}>
                        {s.tag}
                      </span>
                    </div>
                  )}

                  {/* 系列整体进度 */}
                  <div className="mt-2.5 flex items-center gap-2">
                    <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${percent}%` }} />
                    </div>
                    <span className="flex-shrink-0 text-[11px] tabular-nums text-muted-foreground">
                      {s.learned > 0 ? `已学 ${s.learned} 课` : '未开始'}
                    </span>
                  </div>

                  <div className="my-3 h-px bg-border" />

                  {/* 子项区 */}
                  {single ? (
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => onSelect(s.members[0].idx)}
                        className="rounded-md bg-primary px-3 py-1.5 text-xs font-normal text-primary-foreground transition hover:opacity-90"
                      >
                        {learnedLessons(progress[s.members[0].book.id]) > 0
                          ? `继续 第 ${learnedLessons(progress[s.members[0].book.id])} 课`
                          : '开始学习'}
                      </button>
                    </div>
                  ) : (
                    <div
                      className="grid gap-1.5"
                      style={{ gridTemplateColumns: `repeat(${tileCols(s.members.length)}, minmax(0, 1fr))` }}
                    >
                      {shown.map(({ book, idx }) => {
                        const done = learnedLessons(progress[book.id])
                        const pct = book.count > 0 ? Math.min(100, (done / book.count) * 100) : 0
                        const bd = book.difficulty ?? 5
                        return (
                          <button
                            key={book.id}
                            type="button"
                            onClick={() => onSelect(idx)}
                            title={`${book.name} · ${book.count} 课 · 难度 ${bd}${done > 0 ? ` · 上次第 ${done} 课` : ''}`}
                            className={cn(
                              'flex flex-col rounded-md border px-2 py-1.5 text-left transition',
                              done > 0
                                ? 'border-primary/40 bg-primary/5'
                                : 'border-border bg-muted/40 hover:border-primary hover:bg-accent',
                            )}
                          >
                            <span className="flex items-start gap-1">
                              <span className={cn('line-clamp-2 flex-1 text-[11px] leading-tight', done > 0 && 'text-primary')}>
                                {book.name}
                              </span>
                              <span
                                className={cn('flex-shrink-0 mt-0.5 h-1.5 w-1.5 rounded-full border', getDifficultyColor(bd))}
                                title={`难度 ${bd}`}
                              />
                            </span>
                            <span className="mt-1 text-[11px] tabular-nums text-muted-foreground">
                              {done > 0 ? `${done} / ${book.count}` : `${book.count} 课`}
                            </span>
                            <span className="mt-1 h-[3px] w-full overflow-hidden rounded-full bg-border">
                              <span className="block h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                            </span>
                          </button>
                        )
                      })}
                      {hidden > 0 && (
                        <button
                          type="button"
                          onClick={() => setExpanded(prev => ({ ...prev, [s.key]: true }))}
                          className="flex items-center justify-center rounded-md border border-dashed border-border px-2 py-1.5 text-[11px] text-muted-foreground transition hover:border-primary hover:text-primary"
                        >
                          +{hidden} 套
                        </button>
                      )}
                      {isExpanded && s.members.length > TILE_LIMIT && (
                        <button
                          type="button"
                          onClick={() => setExpanded(prev => ({ ...prev, [s.key]: false }))}
                          className="flex items-center justify-center rounded-md border border-dashed border-border px-2 py-1.5 text-[11px] text-muted-foreground transition hover:border-primary hover:text-primary"
                        >
                          收起
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
