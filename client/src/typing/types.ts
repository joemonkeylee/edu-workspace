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

/** 模块设置（持久化到 localStorage）
 *
 * 按语义分四组，SettingsPanel 按同样的分组渲染：
 * - sound  : 按键音 / 提示音
 * - speech : 发音
 * - drill  : 练习行为（判定、词序、循环）
 * - view   : 显示（字号、释义显隐）
 */
export type TypingSettings = {
  // ── sound ──
  /** 按键音 */
  isKeySoundOpen: boolean;
  keySoundVolume: number;
  /** 按键音类型，对应 KEY_SOUNDS 里的 name */
  keySoundName: string;
  /** 提示音（输错 / 完成单词） */
  isHintSoundOpen: boolean;
  hintSoundVolume: number;

  // ── speech ──
  /** 切到新词时自动朗读（手动发音 Ctrl/Cmd+J 不受此项限制） */
  isPronunciationOpen: boolean;
  pronunciationType: PronunciationType;

  // ── drill ──
  /** 判定时忽略大小写 */
  isIgnoreCase: boolean;
  /** 是否打乱章节内词序（切换会重置本章进度） */
  isShuffle: boolean;
  /** 每个单词重复练习次数：1 = 不循环 */
  loopTimes: number;

  // ── view ──
  /** 单词字号（px），音标与释义按同一比例联动 */
  fontSize: number;
  /** 默认隐藏释义，需点击或按 Tab 才显示 */
  isTransHidden: boolean;
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
