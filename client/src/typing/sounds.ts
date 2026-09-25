/**
 * 按键音 / 提示音播放。
 *
 * 用原生 HTMLAudioElement 实现，不引入 howler / use-sound：
 * 按键音需要在极短间隔内连续触发，所以预建一个实例池轮转播放，
 * 避免同一个 Audio 元素被反复 play() 打断导致声音发闷。
 */

const POOL_SIZE = 8;

export type KeySoundOption = { name: string; file: string };

export const KEY_SOUNDS: KeySoundOption[] = [
  { name: 'Default', file: 'Default.wav' },
  { name: 'Cherry MX Browns', file: 'Cherry MX Browns.mp3' },
  { name: 'Cherry MX Blues', file: 'Cherry MX Blues.mp3' },
  { name: 'Holy Pandas', file: 'Holy Pandas.mp3' },
  { name: 'Topre', file: 'Topre.mp3' },
];

class SoundPool {
  private pool: HTMLAudioElement[] | null = null;
  private cursor = 0;
  private src = '';

  private ensure(src: string) {
    if (this.pool && this.src === src) return;
    this.src = src;
    this.cursor = 0;
    this.pool = Array.from({ length: POOL_SIZE }, () => {
      const el = new Audio(src);
      el.preload = 'auto';
      return el;
    });
  }

  play(src: string, volume: number) {
    if (volume <= 0) return;
    try {
      this.ensure(src);
      if (!this.pool) return;
      const el = this.pool[this.cursor];
      this.cursor = (this.cursor + 1) % POOL_SIZE;
      el.volume = Math.min(1, Math.max(0, volume));
      el.currentTime = 0;
      // 浏览器可能因为无用户交互而拒绝播放，静默忽略即可
      void el.play().catch(() => undefined);
    } catch {
      /* 音频不可用时不影响打字 */
    }
  }
}

const keySoundPool = new SoundPool();
const hintSoundPool = new SoundPool();

const SOUND_BASE = '/sounds';

export function keySoundSrc(name: string): string {
  const opt = KEY_SOUNDS.find((s) => s.name === name) ?? KEY_SOUNDS[0];
  return `${SOUND_BASE}/key-sound/${encodeURIComponent(opt.file)}`;
}

export function playKeySound(name: string, volume: number) {
  keySoundPool.play(keySoundSrc(name), volume);
}

/** 输错提示音 */
export function playWrongSound(volume: number) {
  hintSoundPool.play(`${SOUND_BASE}/beep.wav`, volume);
}

/** 完成单词提示音 */
export function playCorrectSound(volume: number) {
  hintSoundPool.play(`${SOUND_BASE}/correct.wav`, volume);
}
