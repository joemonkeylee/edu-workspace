import { useState, useRef, useEffect, type UIEvent } from 'react'
import CopyTextButton from './CopyTextButton'
import { List, Play, CheckCircle2, Type, AlignLeft, Clock } from 'lucide-react'
import type { VocabWord } from '../constants'
import { cn } from '@/lib/utils'

interface VirtualizedLesson {
  id: string
  title: string
  text: string
  trans: string
  /** 接口数据自带单位，如 "15句" */
  lines: string
  /** 接口数据自带单位，如 "245词" */
  words: string
  time: string
  size: string
  bit: string
  newWords?: VocabWord[]
}

interface Props {
  lessons: VirtualizedLesson[]
  currentLessonIdx: number
  setCurrentLessonIdx: (idx: number) => void
  showVocab: boolean
  onShowVocabChange: (show: boolean) => void
}

/** 与侧栏顶行（教材下拉）、生词表标题行统一为 48px */
const ITEM_HEIGHT = 48
const LAST_ITEM_MARGIN = 8
const SCROLL_THRESHOLD = 16

export default function VirtualizedLessonSelector({
  lessons,
  currentLessonIdx,
  setCurrentLessonIdx,
  showVocab: _showVocab,
  onShowVocabChange,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [containerHeight, setContainerHeight] = useState(0)
  const [copyActiveIndex, setCopyActiveIndex] = useState<{ bi: number | null; en: number | null; zh: number | null }>({ bi: null, en: null, zh: null })
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const [playedLessons, setPlayedLessons] = useState<Set<number>>(() => {
    try {
      const raw = localStorage.getItem('english-played-lessons')
      return new Set(raw ? JSON.parse(raw) : [])
    } catch { return new Set() }
  })

  useEffect(() => {
    const updateHeight = () => {
      if (containerRef.current) setContainerHeight(containerRef.current.clientHeight)
    }
    updateHeight()
    window.addEventListener('resize', updateHeight)
    return () => window.removeEventListener('resize', updateHeight)
  }, [])

  const adjustedScrollTop = scrollTop - (scrollTop % ITEM_HEIGHT)
  const startIndex = Math.max(
    Math.floor(adjustedScrollTop / ITEM_HEIGHT) - (scrollTop % ITEM_HEIGHT >= SCROLL_THRESHOLD ? 1 : 0),
    0,
  )
  const visibleCount = Math.ceil(containerHeight / ITEM_HEIGHT) + 2
  const endIndex = Math.min(startIndex + visibleCount, lessons.length)
  const paddingTop = startIndex * ITEM_HEIGHT
  const remainingItems = lessons.length - endIndex
  let paddingBottom = remainingItems > 0 ? remainingItems * ITEM_HEIGHT : 0
  const contentHeight = lessons.length * ITEM_HEIGHT + LAST_ITEM_MARGIN
  const scrollBottomDistance = contentHeight - (scrollTop + containerHeight)
  if (scrollBottomDistance < 0) paddingBottom = Math.max(0, paddingBottom + scrollBottomDistance)

  useEffect(() => {
    if (!containerRef.current) return
    const targetScrollPosition = currentLessonIdx * ITEM_HEIGHT
    containerRef.current.scrollTop = targetScrollPosition
    setScrollTop(containerRef.current.scrollTop)
  }, [currentLessonIdx, lessons, containerHeight])

  const onScroll = (e: UIEvent<HTMLDivElement>) => setScrollTop(e.currentTarget.scrollTop)

  const copyToClipboard = (text: string, type: 'en' | 'zh' | 'bi', index: number, extraText?: string) => {
    if (!text) return
    const fullText = extraText ? text + '\n' + extraText : text
    navigator.clipboard.writeText(fullText).then(() => {
      setCopyActiveIndex((prev) => ({ ...prev, [type]: index }))
      setTimeout(() => setCopyActiveIndex((prev) => ({ ...prev, [type]: null })), 2500)
    })
  }

  const handleSelect = (idx: number) => {
    setCurrentLessonIdx(idx)
    setPlayedLessons(prev => {
      if (prev.has(idx)) return prev
      const next = new Set(prev)
      next.add(idx)
      try { localStorage.setItem('english-played-lessons', JSON.stringify(Array.from(next))) } catch {}
      return next
    })
  }

  return (
    <div
      ref={containerRef}
      className="scrollbar-thin outline-none flex-1 min-h-0"
      style={{ overflowY: 'auto' }}
      onScroll={onScroll}
      tabIndex={0}
      aria-label="Virtualized lesson list"
    >
      <ul className="m-0 list-none px-1 py-1" style={{ paddingTop: Math.max(paddingTop, 1), paddingBottom }}>
        {lessons.slice(startIndex, endIndex).map((lesson, idx) => {
          const realIdx = startIndex + idx
          const isActive = realIdx === currentLessonIdx
          const isHovered = hoverIdx === realIdx
          const hasNewWords = lesson.newWords && lesson.newWords.length > 0
          const isPlayed = playedLessons.has(realIdx)

          return (
            <li
              key={lesson.id}
              className="px-2 py-0.5"
              style={{
                height: ITEM_HEIGHT,
                marginBottom: realIdx === lessons.length - 1 ? LAST_ITEM_MARGIN : undefined,
              }}
            >
              <div
                className={cn(
                  'group relative flex h-full w-full cursor-pointer items-center gap-2.5 overflow-hidden rounded-lg border px-2.5 transition-colors',
                  isActive
                    ? 'border-primary/60 bg-primary/10'
                    : 'border-transparent bg-transparent hover:bg-sidebar-accent',
                )}
                onClick={() => handleSelect(realIdx)}
                onMouseEnter={() => setHoverIdx(realIdx)}
                onMouseLeave={() => setHoverIdx(null)}
                title={lesson.title}
              >
                {/* 序号 / 播放状态 */}
                <div
                  className={cn(
                    'flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-normal tabular-nums',
                    isActive
                      ? 'bg-primary text-primary-foreground'
                      : isPlayed
                        ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                        : 'bg-muted text-muted-foreground',
                  )}
                >
                  {isActive ? <Play size={11} className="ml-px" /> : isPlayed ? <CheckCircle2 size={14} /> : realIdx + 1}
                </div>

                {/* 主信息 */}
                <div className="flex min-w-0 flex-1 flex-col justify-center">
                  <div className={cn(
                    'truncate text-[13px] font-normal leading-tight',
                    isActive ? 'text-foreground' : 'text-sidebar-foreground',
                  )}>
                    {lesson.title}
                  </div>
                  {/* 词数 / 句数 / 时长：正常排列，各项前带图标 */}
                  <div className="mt-1 flex items-center gap-2.5 text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-1 whitespace-nowrap tabular-nums">
                      <Type size={11} className="flex-shrink-0 opacity-70" />
                      {lesson.words}
                    </span>
                    <span className="flex items-center gap-1 whitespace-nowrap tabular-nums">
                      <AlignLeft size={11} className="flex-shrink-0 opacity-70" />
                      {lesson.lines}
                    </span>
                    <span className="flex items-center gap-1 whitespace-nowrap tabular-nums">
                      <Clock size={11} className="flex-shrink-0 opacity-70" />
                      {lesson.time}
                    </span>
                  </div>
                </div>

                {/* 悬停操作区：浮层覆盖，不挤压主信息 */}
                <div
                  className={cn(
                    'absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-1 rounded-md border border-border bg-sidebar/95 px-1 py-1 shadow-sm backdrop-blur-sm transition-opacity',
                    isHovered ? 'opacity-100' : 'pointer-events-none opacity-0',
                  )}
                  onClick={(e) => e.stopPropagation()}
                >
                  <CopyTextButton
                    onClick={(e) => { e.stopPropagation(); copyToClipboard(lesson.text + '\n' + lesson.trans, 'bi', realIdx) }}
                    title="复制双语"
                    label="Bi"
                    active={copyActiveIndex.bi === realIdx}
                  />
                  <CopyTextButton
                    onClick={(e) => { e.stopPropagation(); copyToClipboard(lesson.text, 'en', realIdx) }}
                    title="复制英文"
                    label="En"
                    active={copyActiveIndex.en === realIdx}
                  />
                  <CopyTextButton
                    onClick={(e) => { e.stopPropagation(); copyToClipboard(lesson.trans, 'zh', realIdx) }}
                    title="复制中文"
                    label="Zh"
                    active={copyActiveIndex.zh === realIdx}
                  />
                  {hasNewWords && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onShowVocabChange(true) }}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
                      title="生词表"
                    >
                      <List size={14} />
                    </button>
                  )}
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
