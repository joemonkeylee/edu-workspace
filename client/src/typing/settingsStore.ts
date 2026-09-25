import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { DEFAULT_TYPING_SETTINGS, type TypingSettings } from './types';

/**
 * 练习设置的唯一数据源。
 *
 * 设置项本身与「面板是否展开」都放在 store 里，组件只负责渲染，
 * 不持有任何本地副本 —— 这样面板、快捷键、词表计算看到的值永远一致。
 */
export type TypingSettingsState = TypingSettings & {
  /** 设置面板是否展开。一并持久化，下次进来保持用户习惯 */
  panelOpen: boolean;
  /** 合并式更新，只传变化的字段 */
  update: (patch: Partial<TypingSettings>) => void;
  togglePanel: () => void;
  setPanelOpen: (v: boolean) => void;
  /** 恢复默认（面板展开状态保留，属于界面偏好不算练习设置） */
  reset: () => void;
};

/** 需要持久化的字段白名单：update/reset 这类函数不进 localStorage */
const PERSIST_KEYS = [
  'isKeySoundOpen',
  'keySoundVolume',
  'keySoundName',
  'isHintSoundOpen',
  'hintSoundVolume',
  'isPronunciationOpen',
  'pronunciationType',
  'isIgnoreCase',
  'isShuffle',
  'loopTimes',
  'dailyGoalWords',
  'fontSize',
  'isTransHidden',
  'isPhoneticHidden',
  'blindMode',
  'panelOpen',
] as const satisfies readonly (keyof TypingSettingsState)[];

export const useTypingSettings = create<TypingSettingsState>()(
  persist(
    (set, get) => ({
      ...DEFAULT_TYPING_SETTINGS,
      panelOpen: false,

      update: (patch) => set(patch),
      togglePanel: () => set({ panelOpen: !get().panelOpen }),
      setPanelOpen: (v) => set({ panelOpen: v }),
      reset: () => set({ ...DEFAULT_TYPING_SETTINGS }),
    }),
    {
      name: 'typing-settings',
      // 显式指定 storage：persist 的默认 storage 在模块初始化时就取好，
      // 依赖运行环境的全局对象，显式传入可避免环境差异导致的静默失效
      storage: createJSONStorage(() => localStorage),
      // 不声明 version：此前写入的数据没有版本号，加了会被 persist 判定为
      // 版本不匹配而丢弃，导致老设置被清空。缺字段由下面的 merge 用默认值补齐。
      partialize: (s) => {
        const out: Record<string, unknown> = {};
        for (const k of PERSIST_KEYS) out[k] = s[k];
        return out as Partial<TypingSettingsState>;
      },
      // 老版本没有 panelOpen / 新增字段时，用默认值补齐
      merge: (persisted, current) => ({
        ...current,
        ...(persisted as Partial<TypingSettingsState>),
        update: current.update,
        togglePanel: current.togglePanel,
        setPanelOpen: current.setPanelOpen,
        reset: current.reset,
      }),
    },
  ),
);
