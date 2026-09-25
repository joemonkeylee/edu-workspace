/**
 * 单词发音（有道公开 dictvoice 接口，无需 key）。
 * 用 <audio> 直接播放，媒体资源不受 CORS 限制，无需自建代理。
 */

import type { PronunciationType } from './types';

const DICTVOICE_API = 'https://dict.youdao.com/dictvoice?audio=';

export function pronunciationUrl(word: string, type: PronunciationType): string {
  return `${DICTVOICE_API}${encodeURIComponent(word)}&type=${type === 'uk' ? 1 : 2}`;
}

let sharedAudio: HTMLAudioElement | null = null;

export function playPronunciation(word: string, type: PronunciationType, volume = 1) {
  if (!word) return;
  try {
    if (!sharedAudio) {
      sharedAudio = new Audio();
      sharedAudio.preload = 'auto';
    }
    sharedAudio.volume = Math.min(1, Math.max(0, volume));
    sharedAudio.src = pronunciationUrl(word, type);
    void sharedAudio.play().catch(() => undefined);
  } catch {
    /* 发音失败不影响练习 */
  }
}
