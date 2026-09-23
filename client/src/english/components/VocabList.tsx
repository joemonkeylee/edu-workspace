import { useState, useEffect, useRef } from 'react'
import { ArrowLeft, Check, Copy } from 'lucide-react'
import type { VocabWord } from '../constants'
import { cn } from '@/lib/utils'

interface VocabListProps {
  words: VocabWord[]
  toggle: (show?: boolean) => void
}

export default function VocabList({ words, toggle }: VocabListProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const timeoutRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [])

  const handleClick = (index: number) => {
    const wordObj = words[index]
    if (!wordObj) return
    let textToCopy = wordObj.word
    if (wordObj.phonetic) textToCopy += ` [${wordObj.phonetic}]`
    if (wordObj.meaning && wordObj.meaning.length > 0) textToCopy += '\n' + wordObj.meaning

    navigator.clipboard.writeText(textToCopy).then(() => {
      setActiveIndex(index)
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      timeoutRef.current = window.setTimeout(() => setActiveIndex(null), 2500)
    })
  }

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground" role="list" aria-label="生词表">
      <div className="flex items-center justify-between border-b border-sidebar-border px-3 py-2.5">
        <h3 className="text-sm font-semibold">生词表</h3>
        <button
          type="button"
          aria-label="返回课程列表"
          title="返回课程列表"
          onClick={() => toggle(false)}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
        >
          <ArrowLeft size={15} />
        </button>
      </div>
      <ul className="flex-1 overflow-auto scrollbar-thin p-1.5">
        {words.map((wordObj: VocabWord, i) => {
          const isActive = activeIndex === i
          return (
            <li
              key={`nw-${i}`}
              className={cn(
                'mb-1 cursor-pointer rounded-md border px-3 py-2 text-sm transition-colors',
                isActive
                  ? 'border-primary/60 bg-primary/10'
                  : 'border-transparent hover:bg-sidebar-accent',
              )}
              tabIndex={0}
              aria-label={`生词：${wordObj.word}`}
              role="listitem"
              onClick={() => handleClick(i)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  handleClick(i)
                }
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-baseline gap-2 min-w-0">
                  <span className="text-sm font-semibold text-foreground truncate">{wordObj.word || ''}</span>
                  {wordObj.phonetic && (
                    <span className="text-xs italic text-muted-foreground shrink-0">{wordObj.phonetic}</span>
                  )}
                </div>
                <span className={cn(
                  'shrink-0',
                  isActive ? 'text-emerald-500' : 'text-muted-foreground/0 group-hover:text-muted-foreground',
                )}>
                  {isActive ? <Check size={13} /> : <Copy size={12} />}
                </span>
              </div>
              {wordObj.meaning && wordObj.meaning.length > 0 && (
                <div className="mt-0.5 flex items-baseline gap-1 text-xs text-muted-foreground">
                  {wordObj.pos && <span className="text-muted-foreground">{wordObj.pos}</span>}
                  <span className="truncate">{wordObj.meaning}</span>
                </div>
              )}
            </li>
          )
        })}
        {words.length === 0 && (
          <li className="py-8 text-center text-xs text-muted-foreground">本课暂无生词</li>
        )}
      </ul>
    </div>
  )
}
