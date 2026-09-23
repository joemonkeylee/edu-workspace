import { useEffect } from 'react'
import { SubtitleModes, type SubtitleModeType } from './constants'

export default function useKeyboardControls(
  playbackRate: number,
  _subtitleMode: SubtitleModeType,
  currentIndex: number,
  maxIndex: number,
  setPlaybackRate: (rate: number) => void,
  setSubtitleMode: (mode: SubtitleModeType) => void,
  setCurrentIndex: (index: number) => void,
  setLoopIndex: (index: number | null) => void,
  seekToSentence?: (index: number) => void,
) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target && (e.target as HTMLElement).tagName === 'INPUT') return
      if (e.target && (e.target as HTMLElement).tagName === 'TEXTAREA') return

      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault()
          if (playbackRate < 3) {
            setPlaybackRate(+(playbackRate + 0.25).toFixed(2))
          }
          break
        case 'ArrowDown':
          e.preventDefault()
          if (playbackRate > 0.25) {
            setPlaybackRate(+(playbackRate - 0.25).toFixed(2))
          }
          break
        case 'ArrowLeft':
          e.preventDefault()
          if (currentIndex > 0) {
            const newIndex = currentIndex - 1
            setCurrentIndex(newIndex)
            setLoopIndex(null)
            seekToSentence?.(newIndex)
          }
          break
        case 'ArrowRight':
          e.preventDefault()
          if (currentIndex < maxIndex - 1) {
            const newIndex = currentIndex + 1
            setCurrentIndex(newIndex)
            setLoopIndex(null)
            seekToSentence?.(newIndex)
          }
          break
        case '1':
          e.preventDefault()
          setSubtitleMode(SubtitleModes.BLIND)
          break
        case '2':
          e.preventDefault()
          setSubtitleMode(SubtitleModes.BLIND_HINT)
          break
        case '3':
          e.preventDefault()
          setSubtitleMode(SubtitleModes.CHINESE)
          break
        case '4':
          e.preventDefault()
          setSubtitleMode(SubtitleModes.ENGLISH)
          break
        case '5':
          e.preventDefault()
          setSubtitleMode(SubtitleModes.FULL)
          break
        default:
          break
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    playbackRate,
    currentIndex,
    maxIndex,
    setPlaybackRate,
    setSubtitleMode,
    setCurrentIndex,
    setLoopIndex,
    seekToSentence,
  ])
}
