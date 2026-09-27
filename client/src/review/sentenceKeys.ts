/**
 * 听力单句的条目键。
 *
 * 单独成文件、不 import 任何 React / 存储依赖，好处是可以直接被
 * scripts/verify-review-engine.ts 拿去做断言。
 *
 * 键为什么带 bookId：
 *   bookId 是「书」这个二级容器的 id。带进去之后，同一个系列下的不同版本
 *   （比如《新概念第一册》的英音版和美音版，句子文本一模一样）各自一条掌握态，
 *   各自一本进度 —— 换了一版音频重新练是用户主动的选择，不该被另一版「连带」。
 *   这与 StudyRecord 的主键口径（bookId::lessonId + 句序）保持一致。
 *
 * 为什么不按「句子文本」去重：
 *   单词那边按文本去重是因为「abandon 会了就是会了」，而听力的对象是
 *   「某课某一句的那段音频」——同一个 'Yes it is.' 在一课里出现三次，
 *   是三次听辨，不该共享一条状态。座位号（idx）就是它的身份。
 */

export const SENTENCE_KEY_SEP = '::';

export function sentenceKey(bookId: string, lessonId: string, idx: number): string {
  return `${bookId}${SENTENCE_KEY_SEP}${lessonId}${SENTENCE_KEY_SEP}${idx}`;
}

export type SentenceRef = {
  bookId: string;
  lessonId: string;
  /** 句在课内的下标，与 lesson JSON 里 data 的下标一致 */
  idx: number;
};

export function parseSentenceKey(key: string): SentenceRef | null {
  const parts = String(key ?? '').split(SENTENCE_KEY_SEP);
  if (parts.length !== 3) return null;
  const [bookId, lessonId, rawIdx] = parts;
  if (!bookId || !lessonId) return null;
  const idx = Number(rawIdx);
  if (!Number.isInteger(idx) || idx < 0) return null;
  return { bookId, lessonId, idx };
}

/** 索引里一课的形态：稳定 id + 句子数 */
export type LessonSize = { id: string; count: number; title?: string };

/**
 * 逐条生成某本书（或若干课）的全部句子键。
 *
 * 用 generator 而不是一次性拼出数组：最大的一册有几万句，
 * 而 computeProgress 只管 for...of 迭代，没必要为它物化几万个字符串。
 */
export function* sentenceKeys(bookId: string, lessons: Iterable<LessonSize>): Generator<string> {
  for (const lesson of lessons) {
    if (!lesson?.id) continue;
    const n = Number(lesson.count) || 0;
    for (let i = 0; i < n; i += 1) {
      yield sentenceKey(bookId, lesson.id, i);
    }
  }
}
