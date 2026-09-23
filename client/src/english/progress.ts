const KEY = 'english-progress'

export interface BookProgress {
  /** 0-based 课索引 */
  lessonIdx: number
  updatedAt: number
}

export type ProgressMap = Record<string, BookProgress>

export function loadProgress(): ProgressMap {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    const out: ProgressMap = {}
    for (const [id, v] of Object.entries(parsed as Record<string, any>)) {
      if (v && typeof v.lessonIdx === 'number' && Number.isFinite(v.lessonIdx)) {
        out[id] = { lessonIdx: Math.max(0, Math.trunc(v.lessonIdx)), updatedAt: Number(v.updatedAt) || 0 }
      }
    }
    return out
  } catch {
    return {}
  }
}

export function recordProgress(bookId: string, lessonIdx: number): void {
  try {
    const all = loadProgress()
    all[bookId] = { lessonIdx: Math.max(0, Math.trunc(lessonIdx)), updatedAt: Date.now() }
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch {}
}

export function clearProgress(bookId?: string): void {
  try {
    if (!bookId) { localStorage.removeItem(KEY); return }
    const all = loadProgress()
    delete all[bookId]
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch {}
}

/** 已学课数（0 表示未开始） */
export function learnedLessons(progress: BookProgress | undefined): number {
  return progress ? progress.lessonIdx + 1 : 0
}
