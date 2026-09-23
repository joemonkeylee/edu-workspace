import { ChevronDown } from 'lucide-react'
import type { BookMeta } from '../constants'

interface BookSelectorProps {
  books: BookMeta[]
  currentBookIdx: number
  setCurrentBookIdx: (idx: number) => void
  /** 嵌在别的行里时不带外层的边框与内边距 */
  bare?: boolean
}

export default function BookSelector({ books, currentBookIdx, setCurrentBookIdx, bare = false }: BookSelectorProps) {
  const groupedBooks: Record<string, { book: BookMeta; idx: number }[]> = books.reduce(
    (groups, book, idx) => {
      const tag = book.tag?.trim() || '未分组'
      if (!groups[tag]) groups[tag] = []
      groups[tag].push({ book, idx })
      return groups
    },
    {} as Record<string, { book: BookMeta; idx: number }[]>,
  )

  return (
    <div className={bare ? '' : 'border-b border-sidebar-border px-3 py-2.5'}>
      <div className="relative">
        <select
          className="w-full appearance-none truncate rounded-md border border-border bg-background py-2 pl-3 pr-7 text-sm font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-primary cursor-pointer"
          value={currentBookIdx}
          onChange={(e) => {
            setCurrentBookIdx(Number(e.target.value))
            e.currentTarget.blur()
          }}
          aria-label="选择教材"
        >
          {Object.entries(groupedBooks).map(([tag, booksInTag]) => (
            <optgroup key={tag} label={tag}>
              {booksInTag.map(({ book, idx }) => (
                <option key={idx} value={idx}>
                  {book.name} ({book.count}课)
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <ChevronDown size={14} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
      </div>
    </div>
  )
}
