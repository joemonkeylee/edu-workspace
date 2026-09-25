import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_TYPING_SETTINGS, type TypingSettings } from './types';

type TypingSettingsState = TypingSettings & {
  update: (patch: Partial<TypingSettings>) => void;
  reset: () => void;
};

export const useTypingSettings = create<TypingSettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_TYPING_SETTINGS,
      update: (patch) => set(patch),
      reset: () => set({ ...DEFAULT_TYPING_SETTINGS }),
    }),
    {
      name: 'typing-settings',
      partialize: (s) => ({
        isIgnoreCase: s.isIgnoreCase,
        isPronunciationOpen: s.isPronunciationOpen,
        pronunciationType: s.pronunciationType,
        isKeySoundOpen: s.isKeySoundOpen,
        keySoundVolume: s.keySoundVolume,
        isHintSoundOpen: s.isHintSoundOpen,
        hintSoundVolume: s.hintSoundVolume,
        keySoundName: s.keySoundName,
        fontSize: s.fontSize,
        isShuffle: s.isShuffle,
        isTransHidden: s.isTransHidden,
        loopTimes: s.loopTimes,
      }),
    },
  ),
);
