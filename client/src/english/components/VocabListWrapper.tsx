import { useState } from 'react'
import { PanelLeftClose } from 'lucide-react'
import BookSelector from './BookSelector'
import VirtualizedLessonSelector from './VirtualizedLessonSelector'
import VocabList from './VocabList'
import type { BookMeta, VocabWord } from '../constants'

interface VocabListWrapperProps {
  books: BookMeta[]
  currentBookIdx: number
  setCurrentBookIdx: (idx: number) => void
  lessons: any[]
  currentLessonIdx: number
  setCurrentLessonIdx: (idx: number) => void
  vocabWords: VocabWord[]
  onToggleSidebar?: () => void
}

export default function VocabListWrapper({
  books,
  currentBookIdx,
  setCurrentBookIdx,
  lessons,
  currentLessonIdx,
  setCurrentLessonIdx,
  vocabWords,
  onToggleSidebar,
}: VocabListWrapperProps) {
  const [showVocab, setShowVocab] = useState(false)

  return (
    <>
      <div
        className="flex min-h-0 flex-1 flex-col"
        style={{ display: showVocab ? 'none' : 'flex', transition: 'opacity 0.3s' }}
        aria-hidden={showVocab}
      >
        {/* 一行：教材下拉 + 收起按钮（行高与课程条目、生词表标题一致：48px） */}
        <div className="flex h-12 flex-shrink-0 items-center gap-2 border-b border-sidebar-border px-3">
          <div className="min-w-0 flex-1">
            <BookSelector
              bare
              books={books}
              currentBookIdx={currentBookIdx}
              setCurrentBookIdx={(idx) => {
                if (idx !== currentBookIdx) {
                  setCurrentBookIdx(idx)
                  setCurrentLessonIdx(0)
                }
              }}
            />
          </div>
          {onToggleSidebar && (
            <button
              type="button"
              onClick={onToggleSidebar}
              className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
              title="收起课程列表"
            >
              <PanelLeftClose size={14} />
            </button>
          )}
        </div>
        <VirtualizedLessonSelector
          lessons={lessons}
          currentLessonIdx={currentLessonIdx}
          setCurrentLessonIdx={setCurrentLessonIdx}
          showVocab={showVocab}
          onShowVocabChange={setShowVocab}
        />
      </div>

      <div
        className="flex min-h-0 flex-1 flex-col"
        style={{ display: showVocab ? 'flex' : 'none', position: 'relative' }}
        aria-hidden={!showVocab}
      >
        <VocabList words={vocabWords} toggle={() => setShowVocab(false)} />
      </div>
    </>
  )
}
