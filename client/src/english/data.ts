import { RESOURCE_BASE_URL } from './appConfig'

const DATA_BASE = `${RESOURCE_BASE_URL}/data`

export async function loadBookData(bookId: string): Promise<any> {
  const res = await fetch(`${DATA_BASE}/lt/books/${bookId}.json`)
  if (!res.ok) throw new Error(`Book not found: ${bookId} (${res.status})`)
  return res.json()
}

export async function loadLessonData(lessonId: string): Promise<any> {
  const res = await fetch(`${DATA_BASE}/lt/${lessonId}.json`)
  if (!res.ok) throw new Error(`Lesson not found: ${lessonId} (${res.status})`)
  return res.json()
}
