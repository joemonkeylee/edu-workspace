/** 单词打字练习模块的类型定义 */

/** 词库中的一个词条（与 qwerty-learner 的 Word 结构保持一致，便于直接复用其词库 JSON） */
export type Word = {
  name: string;
  trans: string[];
  usphone: string;
  ukphone: string;
  /** 在原词库中的下标，切词/统计时用于回查 */
  index?: number;
};

/** 词库元数据 */
export type DictMeta = {
  id: string;
  name: string;
  description: string;
  /** 分组标签，用于选择器归类 */
  category: string;
  /** 词库 JSON 的静态资源路径 */
  url: string;
  /** 词条总数 */
  length: number;
};

/** 单个字母的显示状态 */
export type LetterState = 'normal' | 'correct' | 'wrong';

/** 字母级错输记录：{ 字母下标: 错输过的字符列表 } */
export type LetterMistakes = Record<number, string[]>;

/** 发音口音 */
export type PronunciationType = 'us' | 'uk';

/** 模块设置（持久化到 localStorage） */
export type TypingSettings = {
  /** 判定时忽略大小写 */
  isIgnoreCase: boolean;
  /** 自动发音 */
  isPronunciationOpen: boolean;
  pronunciationType: PronunciationType;
  /** 按键音 */
  isKeySoundOpen: boolean;
  keySoundVolume: number;
  /** 提示音（正确 / 错误） */
  isHintSoundOpen: boolean;
  hintSoundVolume: number;
  /** 按键音类型 */
  keySoundName: string;
  /** 单词字号（px） */
  fontSize: number;
  /** 是否打乱章节内词序 */
  isShuffle: boolean;
  /** 是否默认隐藏释义（鼠标悬停显示） */
  isTransHidden: boolean;
  /** 循环次数：1 = 不循环 */
  loopTimes: number;
};

export const DEFAULT_TYPING_SETTINGS: TypingSettings = {
  isIgnoreCase: true,
  isPronunciationOpen: true,
  pronunciationType: 'us',
  isKeySoundOpen: true,
  keySoundVolume: 0.6,
  isHintSoundOpen: true,
  hintSoundVolume: 0.6,
  keySoundName: 'Default',
  fontSize: 48,
  isShuffle: false,
  isTransHidden: false,
  loopTimes: 1,
};
