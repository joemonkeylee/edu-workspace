import { useState, useRef, useEffect, useCallback } from 'react'
import WordPopup from './WordPopup'
import SubtitleControls from './SubtitleControls'
import SentenceList from './SentenceList'
import TypePanel from './TypePanel'
import useKeyboardControls from '../useKeyboardControls'
import { loadDictionary, peekDictionary, type DictEntry } from '../dictionary'
import { RESOURCE_BASE_URL } from '../appConfig'
import { SubtitleModes, type SubtitleModeType, WorkModes, type WorkModeType } from '../constants'

interface SentenceItem { Id: string; Start: string | number; End: string | number; Sentence: string; Trans: string }

interface Props {
  audioSrc: string
  title: string
  data: SentenceItem[]
  playbackRate?: number
  setPlaybackRate?: (rate: number) => void
  subtitleMode?: SubtitleModeType
  setSubtitleMode?: (mode: SubtitleModeType) => void
  workMode?: WorkModeType
  setWorkMode?: (mode: WorkModeType) => void
  currentIndex: number
  setCurrentIndex: (index: number) => void
  isDarkMode?: boolean
}

export default function BilingualPage({
  audioSrc, title, data = [], playbackRate: propPlaybackRate, setPlaybackRate: propSetPlaybackRate,
  subtitleMode: propSubtitleMode, setSubtitleMode: propSetSubtitleMode, workMode: propWorkMode, setWorkMode: propSetWorkMode,
  currentIndex, setCurrentIndex, isDarkMode: _isDarkMode = false,
}: Props) {
  const getFullAudioSrc = useCallback((src: string) => /^(https?:)?\/\//.test(src) ? src : RESOURCE_BASE_URL + src, [])
  const [internalAudioSrc, setInternalAudioSrc] = useState(getFullAudioSrc(audioSrc))
  const [loopIndex, setLoopIndex] = useState<number | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [audioError, setAudioError] = useState<string | null>(null)
  const [dictMap, setDictMap] = useState<Map<string, DictEntry> | null>(() => peekDictionary())
  const [dictLoading, setDictLoading] = useState(false)
  const [subtitleMode, setSubtitleModeLocal] = useState<SubtitleModeType>(propSubtitleMode ?? SubtitleModes.BLIND)
  const [workMode, setWorkModeLocal] = useState<WorkModeType>(propWorkMode ?? WorkModes.LISTEN)
  const [playbackRate, setPlaybackRateLocal] = useState(propPlaybackRate ?? 1)
  const [lookupEntry, setLookupEntry] = useState<DictEntry | null>(null)
  const [lookupMiss, setLookupMiss] = useState<string | null>(null)
  const [dictError, setDictError] = useState(false)
  const [loopEndCount, setLoopEndCount] = useState(0)
  const [typeInTimeEnabled, setTypeInTimeEnabled] = useState(false)
  const [typeFocusEnabled, setTypeFocusEnabled] = useState(false)
  const [passedIndexes, setPassedIndexes] = useState<Set<number>>(new Set())
  const [copyActiveIndex, setCopyActiveIndex] = useState<{ [key: string]: number | null }>({ en: null, zh: null, bi: null })

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const sentenceSectionRef = useRef<HTMLDivElement | null>(null)
  const loopIndexRef = useRef<number | null>(loopIndex)
  const currentIndexRef = useRef<number>(currentIndex)
  const workModeRef = useRef<WorkModeType>(workMode)
  const typeInTimeEnabledRef = useRef<boolean>(typeInTimeEnabled)
  const subtitleModeBeforeTypeRef = useRef<SubtitleModeType | null>(null)

  useEffect(() => { loopIndexRef.current = loopIndex }, [loopIndex])
  useEffect(() => { currentIndexRef.current = currentIndex }, [currentIndex])
  useEffect(() => { setLoopEndCount(0) }, [currentIndex])
  useEffect(() => { workModeRef.current = workMode }, [workMode])
  useEffect(() => { typeInTimeEnabledRef.current = typeInTimeEnabled }, [typeInTimeEnabled])

  useEffect(() => {
    setInternalAudioSrc(audioSrc)
    setLoopIndex(null)
    setCurrentIndex(-1)
    setAudioError(null)
    if (audioRef.current) audioRef.current.playbackRate = propPlaybackRate ?? 1
    if (sentenceSectionRef.current) sentenceSectionRef.current.scrollTop = 0
  }, [audioSrc, setCurrentIndex])

  useEffect(() => {
    if (typeof propPlaybackRate === 'number' && propPlaybackRate !== playbackRate) {
      setPlaybackRateLocal(propPlaybackRate)
      if (audioRef.current) audioRef.current.playbackRate = propPlaybackRate
    }
  }, [propPlaybackRate])

  useEffect(() => {
    if (propSubtitleMode && propSubtitleMode !== subtitleMode) setSubtitleModeLocal(propSubtitleMode)
  }, [propSubtitleMode])

  useEffect(() => {
    if (propWorkMode && propWorkMode !== workMode) setWorkModeLocal(propWorkMode)
  }, [propWorkMode])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const onPlay = () => setIsPlaying(true)
    const onPause = () => setIsPlaying(false)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    return () => { audio.removeEventListener('play', onPlay); audio.removeEventListener('pause', onPause) }
  }, [])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !Array.isArray(data) || data.length === 0) return
    let lastIndex = currentIndexRef.current
    let isSeekingLoop = false

    const onTimeUpdate = () => {
      const currentTime = audio.currentTime
      const currentLoopIndex = loopIndexRef.current
      if (currentLoopIndex !== null && data[currentLoopIndex]) {
        const startTime = parseFloat(data[currentLoopIndex].Start.toString())
        const endTime = parseFloat(data[currentLoopIndex].End.toString())
        if (currentTime >= endTime) {
          if (!isSeekingLoop) {
            isSeekingLoop = true
            if (workModeRef.current === WorkModes.Type) {
              setLoopEndCount(c => c + 1)
              if (typeInTimeEnabledRef.current) {
                audio.currentTime = startTime
                setCurrentIndex(currentLoopIndex)
                setTimeout(() => { isSeekingLoop = false }, 100)
                return
              }
            }
            audio.currentTime = startTime
            audio.play()
            setCurrentIndex(currentLoopIndex)
            setTimeout(() => { isSeekingLoop = false }, 100)
          }
          return
        }
      }
      const index = data.findIndex(item => currentTime >= parseFloat(item.Start.toString()) && currentTime < parseFloat(item.End.toString()))
      if (index !== -1 && index !== lastIndex) { lastIndex = index; setCurrentIndex(index) }
      if (audio.ended) { setCurrentIndex(-1); if (sentenceSectionRef.current) sentenceSectionRef.current.scrollTop = 0 }
    }

    audio.addEventListener('timeupdate', onTimeUpdate)
    return () => audio.removeEventListener('timeupdate', onTimeUpdate)
  }, [data, setCurrentIndex])

  useEffect(() => {
    if (!isPlaying) return
    if (!sentenceSectionRef.current) return
    const container = sentenceSectionRef.current
    const activeSentence = container.querySelector('.sentence.active') as HTMLElement | null
    if (!activeSentence) return
    const containerTop = container.scrollTop
    const containerBottom = containerTop + container.clientHeight
    const elemTop = activeSentence.offsetTop
    const elemBottom = elemTop + activeSentence.offsetHeight
    if (elemTop < containerTop || elemBottom > containerBottom) {
      container.scrollTo({ top: elemTop - container.clientHeight / 2 + activeSentence.offsetHeight / 2 })
    }
  }, [currentIndex, isPlaying])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const onEnded = () => { setCurrentIndex(-1); if (sentenceSectionRef.current) sentenceSectionRef.current.scrollTop = 0; setIsPlaying(false) }
    audio.addEventListener('ended', onEnded)
    return () => audio.removeEventListener('ended', onEnded)
  }, [setCurrentIndex])

  const handleSpeakerClick = (index: number) => {
    setCurrentIndex(index)
    setLoopIndex(null)
    const audio = audioRef.current
    if (audio && data[index]) {
      const targetTime = parseFloat(data[index].Start.toString())
      if (Math.abs(audio.currentTime - targetTime) > 0.3) audio.currentTime = targetTime
      audio.play()
      setIsPlaying(true)
    }
  }

  const handleAudioError = useCallback(() => setAudioError('音频加载失败，可能是网络问题或该课程音频缺失'), [])
  const handleRetryAudio = useCallback(() => { setAudioError(null); audioRef.current?.load() }, [])

  const handleLoopToggle = (index: number) => {
    if (loopIndex === index) { setLoopIndex(null); return }
    setLoopIndex(index)
    setCurrentIndex(index)
    const audio = audioRef.current
    if (audio && data[index]) {
      const targetTime = parseFloat(data[index].Start.toString())
      if (Math.abs(audio.currentTime - targetTime) > 0.3) audio.currentTime = targetTime
      audio.play()
      setIsPlaying(true)
    }
  }

  const handleWordClick = useCallback((raw: string) => {
    const key = raw.replace(/[.,!?;:]/g, '').toLocaleLowerCase()
    setLookupEntry(null); setLookupMiss(null); setDictError(false)
    const lookup = (map: Map<string, DictEntry>) => {
      const found = map.get(key)
      if (found) { setLookupEntry(found) } else { setLookupMiss(key) }
    }
    if (dictMap) { lookup(dictMap); return }
    setDictLoading(true)
    loadDictionary().then(map => { setDictMap(map); lookup(map) }).catch(() => { setDictError(true); setLookupMiss(key) }).then(() => setDictLoading(false))
  }, [dictMap])

  const handleChangePlaybackRate = useCallback((rate: number) => {
    if (audioRef.current) { audioRef.current.playbackRate = rate; setPlaybackRateLocal(rate); propSetPlaybackRate?.(rate) }
  }, [propSetPlaybackRate])

  const handleSeekToSentence = useCallback((index: number) => {
    const audio = audioRef.current
    if (!audio || !data[index]) return
    const targetTime = parseFloat(data[index].Start.toString())
    if (Math.abs(audio.currentTime - targetTime) > 0.03) audio.currentTime = targetTime
  }, [data])

  const handleChangeSubtitleMode = (mode: SubtitleModeType) => { setSubtitleModeLocal(mode); propSetSubtitleMode?.(mode) }
  const handleChangeWorkMode = (mode: WorkModeType) => { setWorkModeLocal(mode); propSetWorkMode?.(mode) }
  const handleLineClick = (index: number) => handleSpeakerClick(index)

  const playSentenceWithLoop = useCallback((index: number) => {
    const audio = audioRef.current
    if (!audio || !data[index]) return
    setCurrentIndex(index); setLoopIndex(index); setLoopEndCount(0)
    const targetTime = parseFloat(data[index].Start.toString())
    if (Math.abs(audio.currentTime - targetTime) > 0.03) audio.currentTime = targetTime
    audio.play(); setIsPlaying(true)
  }, [data, setCurrentIndex])

  const handleStopLoop = useCallback(() => { setLoopIndex(null); audioRef.current?.pause(); setIsPlaying(false) }, [])

  useEffect(() => {
    if (workMode === WorkModes.Type) {
      if (subtitleMode !== SubtitleModes.BLIND) {
        subtitleModeBeforeTypeRef.current = subtitleMode
        setSubtitleModeLocal(SubtitleModes.BLIND)
        propSetSubtitleMode?.(SubtitleModes.BLIND)
      }
      playSentenceWithLoop(currentIndex >= 0 ? currentIndex : 0)
    } else {
      setLoopIndex(null)
      if (subtitleModeBeforeTypeRef.current) {
        const restore = subtitleModeBeforeTypeRef.current
        subtitleModeBeforeTypeRef.current = null
        setSubtitleModeLocal(restore)
        propSetSubtitleMode?.(restore)
      }
    }
  }, [workMode])

  useKeyboardControls(playbackRate, subtitleMode, currentIndex, data.length, handleChangePlaybackRate, setSubtitleModeLocal, setCurrentIndex, setLoopIndex, handleSeekToSentence)

  const typeIndex = currentIndex >= 0 ? currentIndex : 0

  return (
    <div className="relative flex h-full flex-col bg-card text-foreground">
        <SubtitleControls
          playbackRate={playbackRate}
          subtitleMode={subtitleMode}
          workMode={workMode}
          onChangePlaybackRate={handleChangePlaybackRate}
          onChangeSubtitleMode={handleChangeSubtitleMode}
          onChangeWorkMode={handleChangeWorkMode}
          audioElement={
            <audio key={internalAudioSrc} style={{ width: 260, zoom: 0.74 }} ref={audioRef} src={internalAudioSrc} preload="metadata" controlsList="nodownload noplaybackrate" controls onError={handleAudioError} />
          }
        />
        {audioError && (
          <div className="mx-4 mt-3 flex items-center gap-3 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <span className="flex-1">{audioError}</span>
            <button type="button" className="shrink-0 rounded-md border border-destructive/50 px-3 py-1 text-xs text-destructive transition-colors hover:bg-destructive hover:text-destructive-foreground" onClick={handleRetryAudio}>重试</button>
          </div>
        )}
        <SentenceList
          ref={sentenceSectionRef}
          data={data}
          currentIndex={currentIndex}
          loopIndex={loopIndex}
          subtitleMode={subtitleMode}
          dimmed={typeFocusEnabled}
          passedIndices={passedIndexes}
          copyActiveIndex={copyActiveIndex}
          onCopy={(text, type, index, extraText) => {
            if (!text) return
            const fullText = extraText ? text + '\n' + extraText : text
            navigator.clipboard.writeText(fullText).then(() => {
              setCopyActiveIndex(prev => ({ ...prev, [type]: index }))
              setTimeout(() => setCopyActiveIndex(prev => ({ ...prev, [type]: null })), 2500)
            })
          }}
          onSpeakerClick={handleSpeakerClick}
          onLoopToggle={handleLoopToggle}
          onWordClick={handleWordClick}
          onLineClick={handleLineClick}
        />
        {workMode === WorkModes.Type && data[typeIndex] && (
          <TypePanel
            lessonName={title}
            currentIndex={typeIndex}
            totalCount={data.length}
            targetText={data[typeIndex].Sentence}
            trans={data[typeIndex].Trans}
            loopEndCount={loopEndCount}
            onPlay={() => playSentenceWithLoop(typeIndex)}
            onPrev={() => playSentenceWithLoop(Math.max(0, typeIndex - 1))}
            onNext={() => playSentenceWithLoop(Math.min(data.length - 1, typeIndex + 1))}
            onStopLoop={handleStopLoop}
            onRedo={() => setLoopEndCount(0)}
            onInTimeChange={setTypeInTimeEnabled}
            onFocusChange={setTypeFocusEnabled}
            onPassedIndexChange={setPassedIndexes}
            isDarkMode={_isDarkMode}
          />
        )}
      {(lookupEntry || dictLoading || lookupMiss) && (
        <WordPopup
          word={lookupEntry}
          loading={dictLoading && !lookupEntry && !lookupMiss}
          miss={lookupMiss}
          error={dictError}
          onClose={() => { setLookupEntry(null); setLookupMiss(null); setDictError(false) }}
        />
      )}
    </div>
  )
}
