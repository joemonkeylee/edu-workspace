/**
 * 泛型复习引擎 —— 类型定义。
 *
 * 设计目标：同一套引擎同时服务「单词拼写」与「听力单句」两个领域。
 * 领域差异全部收敛到 adapter（见 ../review/domains 与各模块下的注册），
 * 引擎只认识「条目 key + 所属 unit（二级）+ 所属 group（一级）」。
 *
 * 领域映射：
 *   word     → unit = 词库(dictId)        group = 一级分类(category)     key = 单词小写
 *   sentence → unit = 书籍(bookId)        group = 系列(series)           key = bookId::lessonId::句序
 */

/** 复习引擎支持的领域 */
export type ReviewDomain = 'word' | 'sentence';

/**
 * 一个条目的池状态：
 * - none     ：练过但从没错过（不进池，只算「已接触」）
 * - wrong    ：错题池，需要复习
 * - standby  ：备用池，连续答对达标后移出错题，但仍会被抽查点名
 * - mastered ：毕业归档，退出抽查（主线练习答错仍可能被拽回）
 */
export type ReviewStatus = 'none' | 'wrong' | 'standby' | 'mastered';

/** 触发这次结果的场景，决定计数落在哪个 streak 上 */
export type ReviewMode =
  /** 主线章节练习 */
  | 'practice'
  /** 错题专项复习 */
  | 'review'
  /** 抽查（含混进主线练习的备用词） */
  | 'spotcheck';

export type ReviewItemState = {
  /** 归一化后的条目键（见 normalizeItemKey） */
  key: string;
  status: ReviewStatus;
  /** 错题池内的连续答对次数，达到 reviewPassCount 晋级备用 */
  reviewStreak: number;
  /** 备用池内连续通过抽查次数，达到 graduateAfterCheckPass 毕业 */
  checkStreak: number;
  /** 备用池内累计抽查答错次数，达到 spotCheckFailLimit 退回错题 */
  checkFailStreak: number;
  /** 历史答错总次数，只增不清（排序「最该复习」用） */
  wrongTotal: number;
  rightTotal: number;
  firstWrongAt: number;
  lastResultAt: number;
  /** 最近一次进入抽查的时间，用于「最久没抽查过」排序 */
  lastCheckAt: number;
  /** 同一会话内重复命中只计一次，避免 loopTimes 把 streak 灌水 */
  lastSessionId: string;
  /** 曾在哪些 unit 里遇到过（最多保留 MAX_SOURCE_UNITS 个） */
  units: string[];
  /** 字母级错输明细，仅 word 领域且 status==='wrong' 时保留，出池即丢 */
  mistakes?: Record<number, string[]>;
  /** 最后一次变更时间，跨端合并时做 last-write-wins */
  updatedAt: number;
};

export type ReviewTransition = 'none' | 'dup' | 'peeked' | 'to-wrong' | 'to-standby' | 'to-mastered';

export type ReviewInput = {
  /** 原始文本，内部会 normalizeItemKey */
  key: string;
  /** 本次是否答对 */
  ok: boolean;
  /** 会话 id：同一 id 内重复命中同一个 key 只生效一次 */
  sessionId: string;
  /** 所属 unit（二级容器），用于沉淀 units 归属 */
  unitId?: string;
  mode?: ReviewMode;
  /** 偷看答案（Tab 展开释义 / 显示首字母）：不算对也不算错 */
  peeked?: boolean;
  mistakes?: Record<number, string[]>;
  now?: number;
};

export type ReviewOutcome = {
  state: ReviewItemState;
  transition: ReviewTransition;
};

/** 单个容器（书 / 听力课本）或一个一级分类的进度 */
export type ReviewProgress = {
  /** 去重后的条目总数，永远是该口径的分母 */
  total: number;
  /** 练过但没错过（status==='none'） */
  ungraded: number;
  wrong: number;
  standby: number;
  mastered: number;
  /** 掌握率 = (standby + mastered) / total，主进度条 */
  masteredRate: number;
  /** 覆盖率 = 已接触过的 / total，副指标 */
  coveredRate: number;
};

export type ReviewConfig = {
  /** 错题 → 备用：需要连续答对几次（默认 2） */
  reviewPassCount: number;
  /** 备用 → 错题：抽查累计答错几次才退（默认 2，错一次只是扣：checkStreak 清零） */
  spotCheckFailLimit: number;
  /** 备用 → 毕业：连续通过几次抽查（0 = 永不毕业，永远留在备用池被抽查） */
  graduateAfterCheckPass: number;
  /** 毕业的词在主线练习里答错是否仍然拽回错题池（默认 true：毕业不免疫） */
  masteredWrongReturnsToPool: boolean;
  /** 手动点「认识了」把词移到哪个池：standby 会继续被抽查，mastered 直接归档 */
  manualKnowTarget: 'standby' | 'mastered';
  /** 主线练习里混入备用词的比例（0 表示不混） */
  spotCheckMixRatio: number;
  /** 混入方式：tail 塞在章节末尾 / interleave 隔几个穿插在章节中间 */
  spotCheckMixMode: 'tail' | 'interleave';
};

export const DEFAULT_REVIEW_CONFIG: ReviewConfig = {
  reviewPassCount: 2,
  spotCheckFailLimit: 2,
  graduateAfterCheckPass: 3,
  masteredWrongReturnsToPool: true,
  manualKnowTarget: 'standby',
  spotCheckMixRatio: 0.2,
  spotCheckMixMode: 'interleave',
};

/** units 归属最多记录的容器数，防止 sourceBooks 无限膨胀 */
export const MAX_SOURCE_UNITS = 12;
