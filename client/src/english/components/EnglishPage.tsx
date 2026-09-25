import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import VocabListWrapper from './VocabListWrapper'
import BilingualPage from './BilingualPage'
import SidebarToggle from './SidebarToggle'
import Loading from './Loading'
import BookLibrary from './BookLibrary'
import { type BookMeta, BOOKS, type VocabWord, WorkModes, type WorkModeType } from '../constants'
import { recordProgress } from '../progress'
import { RESOURCE_BASE_URL } from '../appConfig'
import { loadBookData, loadLessonData } from '../data'

const STORAGE_KEY = 'nc-last-selection'

/** 侧栏宽度 */
const SIDEBAR_WIDTH = 320

const parseIdx = (raw: string | undefined): number | null => {
  if (raw === undefined) return null
  const n = Number(raw)
  return Number.isInteger(n) && n >= 0 ? n : null
}

// ---- 学习视图 ----
function LearningView() {
  const params = useParams<'bookIdx' | 'lessonIdx'>()
  const navigate = useNavigate()

  const [currentBookIdx, setCurrentBookIdx] = useState(() => {
    const fromUrl = parseIdx(params.bookIdx)
    if (fromUrl !== null) return fromUrl
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) { const p = JSON.parse(stored); if (typeof p.currentBookIdx === 'number') return p.currentBookIdx }
    } catch {}
    return 0
  })

  const [currentLessonIdx, setCurrentLessonIdx] = useState(() => {
    const fromUrl = parseIdx(params.lessonIdx)
    if (fromUrl !== null) return fromUrl
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) { const p = JSON.parse(stored); if (typeof p.currentLessonIdx === 'number') return p.currentLessonIdx }
    } catch {}
    return 0
  })

  const [sidebarVisible, setSidebarVisible] = useState(true)
  const [lessonData, setLessonData] = useState<{ id: string; title: string; data: any[]; words: VocabWord[]; mp3?: string } | null>(null)
  const [book, setBook] = useState<BookMeta | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [lessonError, setLessonError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [subtitleMode, setSubtitleMode] = useState<'blind' | 'blind_hint' | 'chinese' | 'english' | 'full'>('blind')
  const [workMode, setWorkMode] = useState<WorkModeType>(WorkModes.LISTEN)
  const [currentIndex, setCurrentIndex] = useState(-1)

  const toggleSidebar = () => setSidebarVisible(v => !v)

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ currentBookIdx, currentLessonIdx })) } catch {}
  }, [currentBookIdx, currentLessonIdx])

  // 记录每套教材学到第几课（本地进度，用于列表页展示）
  useEffect(() => {
    const meta = BOOKS[currentBookIdx]
    if (!meta) return
    recordProgress(meta.id, currentLessonIdx)
  }, [currentBookIdx, currentLessonIdx])

  useEffect(() => {
    const bookIdx = parseIdx(params.bookIdx)
    const lessonIdx = parseIdx(params.lessonIdx)
    if (bookIdx !== null) setCurrentBookIdx(Math.min(bookIdx, BOOKS.length - 1))
    if (lessonIdx !== null) setCurrentLessonIdx(lessonIdx)
  }, [params.bookIdx, params.lessonIdx])

  useEffect(() => {
    const target = `/english/${currentBookIdx}/${currentLessonIdx}`
    if (window.location.pathname === target) return
    navigate(target, { replace: params.bookIdx === undefined })
  }, [currentBookIdx, currentLessonIdx, params.bookIdx, navigate])

  useEffect(() => {
    if (BOOKS.length === 0) { setBook(null); setLoading(false); return }
    let cancelled = false
    setLoading(true)
    const safeBookIdx = Math.min(Math.max(currentBookIdx, 0), BOOKS.length - 1)
    const bookId = BOOKS[safeBookIdx].id

    loadBookData(bookId)
      .then((mod) => {
        if (cancelled) return
        setBook({ name: bookId, data: mod.data, count: mod.data.length })
        setLoadError(null)
      })
      .catch((e) => {
        console.error(`Failed to load book ${bookId}:`, e)
        if (cancelled) return
        setBook(null)
        setLoadError(`教材加载失败：${BOOKS[safeBookIdx]?.name || bookId}`)
      })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [currentBookIdx, reloadKey])

  useEffect(() => { setCurrentIndex(-1) }, [currentLessonIdx])

  useEffect(() => {
    if (!book?.data) return
    if (currentLessonIdx >= book.data.length || currentLessonIdx < 0) setCurrentLessonIdx(0)
  }, [book, currentLessonIdx])

  useEffect(() => {
    if (!book?.data) return
    const lesson = book.data[currentLessonIdx]
    if (!lesson) return
    if (lesson.id === null) { setLessonData(null); return }
    let cancelled = false

    loadLessonData(lesson.id)
      .then((res) => {
        if (cancelled) return
        const words: VocabWord[] = res.newWords || []
        lesson.newWords = words
        setLessonData({ id: lesson.id, title: lesson.title, data: res.data, words, mp3: res.mp3 })
        setLessonError(null)
      })
      .catch(() => {
        if (cancelled) return
        setLessonData(null)
        setLessonError(`课程加载失败：${lesson.title || '未知课程'}`)
      })

    return () => { cancelled = true }
  }, [book, currentBookIdx, currentLessonIdx, reloadKey])

  const handleRetry = () => { setLoadError(null); setLessonError(null); setReloadKey(k => k + 1) }

  const errorBlock = (message: string) => (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-10 text-center">
      <p className="m-0 text-base text-muted-foreground">{message}</p>
      <button type="button" className="px-6 py-2 text-sm text-primary-foreground bg-primary rounded font-normal hover:opacity-85 transition" onClick={handleRetry}>重试</button>
    </div>
  )

  if (BOOKS.length === 0) return <div className="flex flex-1 items-center justify-center text-muted-foreground text-lg p-5">No books available.</div>
  if (loading) return <Loading text="Loading book" />
  if (loadError) return <div className="flex h-full">{errorBlock(loadError)}</div>
  if (!book) return <div className="flex flex-1 items-center justify-center text-muted-foreground text-lg p-5">No book data.</div>

  return (
    <div className="flex h-full overflow-hidden relative bg-background text-foreground">
      {/* 侧栏收起时才需要浮动的展开按钮 */}
      {!sidebarVisible && <SidebarToggle sidebarVisible={sidebarVisible} toggleSidebar={toggleSidebar} />}

      <div
        className="border-r border-border bg-sidebar transition-all"
        style={{
          width: sidebarVisible ? SIDEBAR_WIDTH : 0,
          opacity: sidebarVisible ? 1 : 0,
          pointerEvents: sidebarVisible ? 'auto' : 'none',
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          position: 'relative',
          zIndex: 100,
        }}
        aria-hidden={!sidebarVisible}
      >
        <VocabListWrapper
          books={BOOKS}
          currentBookIdx={currentBookIdx}
          setCurrentBookIdx={setCurrentBookIdx}
          lessons={book.data!}
          currentLessonIdx={currentLessonIdx}
          setCurrentLessonIdx={setCurrentLessonIdx}
          vocabWords={lessonData?.words && Array.isArray(lessonData.words) ? lessonData.words.map(item => typeof item === 'string' ? { word: item } : item) : []}
          onToggleSidebar={toggleSidebar}
        />
      </div>

      <div className="flex-1 overflow-y-auto relative flex flex-col bg-card">
        {lessonError ? errorBlock(lessonError) : lessonData ? (
          <BilingualPage
            key={`${currentBookIdx}-${currentLessonIdx}`}
            audioSrc={`${RESOURCE_BASE_URL}/lt/${lessonData.mp3}`}
            title={lessonData.title}
            data={lessonData.data}
            bookId={book.name}
            lessonId={lessonData.id}
            lessonIdx={currentLessonIdx}
            playbackRate={playbackRate}
            setPlaybackRate={setPlaybackRate}
            subtitleMode={subtitleMode}
            setSubtitleMode={setSubtitleMode}
            workMode={workMode}
            setWorkMode={setWorkMode}
            currentIndex={currentIndex}
            setCurrentIndex={setCurrentIndex}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center text-muted-foreground text-lg p-5">请从左侧列表选择一课</div>
        )}
      </div>
    </div>
  )
}

// ---- 主组件：根据路由判断展示 landing 还是 learning ----
export default function EnglishPage() {
  const params = useParams<'bookIdx' | 'lessonIdx'>()
  const hasBookIdx = params.bookIdx !== undefined
  const hasLessonIdx = params.lessonIdx !== undefined

  // 学习详情在新标签页打开，列表页保持不动
  const handleSelectBook = (idx: number) => {
    window.open(`/english/${idx}/0`, '_blank', 'noopener')
  }

  if (hasBookIdx && hasLessonIdx) {
    return <LearningView />
  }

  return <BookLibrary onSelect={handleSelectBook} />
}
