/**
 * english 模块的学习记录（纯前端，localStorage）。
 *
 * 记录两件事：
 *   1. 每句话判过几次、错了几次 —— 用于「错句复习」和正确率统计。
 *   2. 整课是否做完（所有句子都通过过一次）—— 用于进度统计。
 *
 * 设计要点：
 *   · 主键用 bookId + lessonId（lesson.id 是稳定 hash），lessonIdx 只是下标，
 *     教材 JSON 中间插入一课就会错位，不能当主键。
 *   · 只存句子前 60 字符的 preview，不存全文。一课 30 句 × 4 册上百课，
 *     全文足以把 localStorage 顶到 5MB 上限。复习时按 bookId/lessonId/idx
 *     回 lesson JSON 取原文即可。
 *   · errors 是独立计数器（每次判卷 !passed 就 +1），不能由 attempts 反推 ——
 *     「错→对→错→对」真实错 2 次，而 attempts-1 会算成 3。
 *   · 只有手动判卷（Submit / 回车）才记录。Live Check 每停顿 300ms 就判一次，
 *     In Time 是超时后自动判卷，两者都不是「我提交了一份答案」，
 *     记进去只会让 attempts/errors 变成噪音。
 */

const KEY = 'english-study-record'

/** preview 截断长度 */
const PREVIEW_LEN = 60

export interface SentenceStat {
  idx: number
  /** 句子原文前 60 字符，仅用于复习列表展示 */
  preview: string
  /** 判卷次数 */
  attempts: number
  /** 判错次数（每次判卷未通过就 +1） */
  errors: number
  firstSubmittedAt: number
  lastSubmittedAt: number
  /** 是否曾经通过过 —— 整课完成的判定依据 */
  passed: boolean
  /** 最后一次判卷是否通过 */
  lastPassed: boolean
  /** 第一次判卷就通过了 —— 排除「改到对为止」，比 bestCorrectRatio 更能反映真实水平 */
  firstPassed: boolean
  /** 历史最佳正确率 correctCount / totalWords */
  bestCorrectRatio: number
}

export interface LessonRecord {
  bookId: string
  lessonId: string
  /** 课在书本数组里的下标，仅用于展示与跳转，不作为主键 */
  lessonIdx: number
  title: string
  totalSentences: number
  /** 整课完成时间戳，未完成为 null */
  completedAt: number | null
  /** key = 句子下标 */
  sentenceStats: Record<string, SentenceStat>
  updatedAt: number
}

/** key = `${bookId}::${lessonId}` */
export type StudyRecordMap = Record<string, LessonRecord>

export interface JudgeLike {
  passed: boolean
  correctCount: number
  totalWords: number
}

export const lessonKey = (bookId: string, lessonId: string) => `${bookId}::${lessonId}`

function safeParse(raw: string | null): StudyRecordMap {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed as StudyRecordMap
  } catch {
    return {}
  }
}

export function loadStudyRecord(): StudyRecordMap {
  try {
    return safeParse(localStorage.getItem(KEY))
  } catch {
    return {}
  }
}

export function getLessonRecord(bookId: string, lessonId: string): LessonRecord | null {
  return loadStudyRecord()[lessonKey(bookId, lessonId)] || null
}

function write(all: StudyRecordMap): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch {
    // localStorage 写满（QuotaExceededError）时不该影响打字练习本身
  }
}

export interface RecordAttemptArgs {
  bookId: string
  lessonId: string
  lessonIdx: number
  title: string
  idx: number
  targetText: string
  result: JudgeLike
  totalSentences: number
  /** manual = 点 Submit / 回车；auto = Live Check / In Time 自动判卷 */
  source: 'manual' | 'auto'
  now?: number
}

export interface RecordAttemptOutcome {
  record: LessonRecord
  /** 本次判卷是否计入了 attempts */
  counted: boolean
  /** 本次是否让这一课首次达成「全部句子通过」 */
  justCompleted: boolean
}

/**
 * 记录一次判卷。
 *
 * 计数口径：只有 manual（点 Submit / 回车）才算数，一次算一次 attempt，
 * 未通过就给 errors +1。auto（Live Check / In Time 自动判卷）直接跳过，
 * 连盘都不写 —— 想改成自动判卷也计入，只需放开下面那一行判断。
 */
export function recordAttempt(args: RecordAttemptArgs): RecordAttemptOutcome {
  const {
    bookId, lessonId, lessonIdx, title, idx, targetText, result,
    totalSentences, source, now = Date.now(),
  } = args

  const all = loadStudyRecord()
  const key = lessonKey(bookId, lessonId)
  const prevLesson: LessonRecord = all[key] ?? {
    bookId, lessonId, lessonIdx, title, totalSentences,
    completedAt: null, sentenceStats: {}, updatedAt: now,
  }

  const statKey = String(idx)
  const prevStat = prevLesson.sentenceStats[statKey]
  const ratio = result.totalWords > 0 ? result.correctCount / result.totalWords : 0

  // 自动判卷直接跳过：不计数、不写盘
  if (source !== 'manual') return { record: prevLesson, counted: false, justCompleted: false }

  const nextStat: SentenceStat = {
    idx,
    preview: prevStat?.preview ?? targetText.slice(0, PREVIEW_LEN),
    attempts: (prevStat?.attempts ?? 0) + 1,
    errors: (prevStat?.errors ?? 0) + (result.passed ? 0 : 1),
    firstSubmittedAt: prevStat?.firstSubmittedAt ?? now,
    lastSubmittedAt: now,
    passed: (prevStat?.passed ?? false) || result.passed,
    lastPassed: result.passed,
    firstPassed: prevStat ? prevStat.firstPassed : result.passed,
    bestCorrectRatio: Math.max(prevStat?.bestCorrectRatio ?? 0, ratio),
  }

  const sentenceStats = { ...prevLesson.sentenceStats, [statKey]: nextStat }
  // 句子数可能被教材更新过，以最新的为准
  const nextLesson: LessonRecord = {
    ...prevLesson,
    lessonIdx,
    title,
    totalSentences,
    sentenceStats,
    updatedAt: now,
  }

  const passedCount = Object.values(sentenceStats).filter((s) => s.passed).length
  const wasCompleted = prevLesson.completedAt !== null
  const isCompleted = totalSentences > 0 && passedCount >= totalSentences
  const justCompleted = !wasCompleted && isCompleted
  if (isCompleted && nextLesson.completedAt === null) nextLesson.completedAt = now

  all[key] = nextLesson
  write(all)

  return { record: nextLesson, counted: true, justCompleted }
}

/** 错过的句子（errors > 0），按错误次数降序 */
export function getWrongSentences(bookId?: string): (SentenceStat & { bookId: string; lessonId: string; lessonIdx: number; title: string })[] {
  const all = loadStudyRecord()
  const out: (SentenceStat & { bookId: string; lessonId: string; lessonIdx: number; title: string })[] = []
  for (const rec of Object.values(all)) {
    if (bookId && rec.bookId !== bookId) continue
    for (const stat of Object.values(rec.sentenceStats)) {
      if (stat.errors > 0) out.push({ ...stat, bookId: rec.bookId, lessonId: rec.lessonId, lessonIdx: rec.lessonIdx, title: rec.title })
    }
  }
  return out.sort((a, b) => b.errors - a.errors || b.lastSubmittedAt - a.lastSubmittedAt)
}

export interface Dashboard {
  /** 已完成课数 */
  completedLessons: number
  /** 练过的课数（至少判过一句） */
  startedLessons: number
  /** 判卷总次数 */
  totalAttempts: number
  /** 判错总次数 */
  totalErrors: number
  /** 通过句子数 / 练过句子数 */
  passedSentences: number
  practicedSentences: number
  /** 平均最佳正确率（按句子取各自最好一次再平均，会偏乐观） */
  avgBestRatio: number
  /** 错句数（errors > 0） */
  wrongSentences: number
  /** 首次判卷即通过的句子数 / 比例 —— 最能反映真实水平 */
  firstPassSentences: number
  firstPassRate: number
}

export function getDashboard(bookId?: string): Dashboard {
  const all = loadStudyRecord()
  const d: Dashboard = {
    completedLessons: 0, startedLessons: 0, totalAttempts: 0, totalErrors: 0,
    passedSentences: 0, practicedSentences: 0, avgBestRatio: 0, wrongSentences: 0,
    firstPassSentences: 0, firstPassRate: 0,
  }
  let ratioSum = 0

  for (const rec of Object.values(all)) {
    if (bookId && rec.bookId !== bookId) continue
    const stats = Object.values(rec.sentenceStats)
    if (stats.length === 0) continue
    d.startedLessons += 1
    if (rec.completedAt !== null) d.completedLessons += 1
    for (const s of stats) {
      d.totalAttempts += s.attempts
      d.totalErrors += s.errors
      d.practicedSentences += 1
      if (s.passed) d.passedSentences += 1
      if (s.errors > 0) d.wrongSentences += 1
      if (s.firstPassed) d.firstPassSentences += 1
      ratioSum += s.bestCorrectRatio
    }
  }

  d.avgBestRatio = d.practicedSentences > 0 ? ratioSum / d.practicedSentences : 0
  d.firstPassRate = d.practicedSentences > 0 ? d.firstPassSentences / d.practicedSentences : 0
  return d
}

/** 按书聚合：完成课数、平均正确率、错句数 */
export function getBookStats(): Record<string, Dashboard> {
  const all = loadStudyRecord()
  const bookIds = Array.from(new Set(Object.values(all).map((r) => r.bookId)))
  const out: Record<string, Dashboard> = {}
  for (const id of bookIds) out[id] = getDashboard(id)
  return out
}

export function clearStudyRecord(bookId?: string): void {
  try {
    if (!bookId) { localStorage.removeItem(KEY); return }
    const all = loadStudyRecord()
    for (const [key, rec] of Object.entries(all)) {
      if (rec.bookId === bookId) delete all[key]
    }
    write(all)
  } catch {}
}
