import { forwardRef } from 'react'
import { Play, Check, Copy, RotateCcw } from 'lucide-react'
import { SubtitleModes, type SubtitleModeType } from '../constants'
import { cn } from '@/lib/utils'

interface SentenceItem {
  Id: string
  Start: string | number
  End: string | number
  Sentence: string
  Trans: string
}

interface Props {
  data: SentenceItem[]
  currentIndex: number
  loopIndex: number | null
  subtitleMode: SubtitleModeType
  copyActiveIndex: { [key: string]: number | null }
  dimmed?: boolean
  passedIndices?: Set<number>
  onCopy: (text: string, type: 'en' | 'zh' | 'bi', index: number, extraText?: string) => void
  onSpeakerClick: (index: number) => void
  onLoopToggle: (index: number) => void
  onWordClick: (word: string) => void
  onLineClick?: (index: number) => void
}

const SentenceList = forwardRef<HTMLDivElement, Props>(({
  data, currentIndex, loopIndex, subtitleMode, copyActiveIndex, dimmed, passedIndices,
  onCopy, onSpeakerClick, onLoopToggle, onWordClick, onLineClick,
}, ref) => {
  const renderBlindHintWord = (word: string, i: number) => (
    <span key={i} className="relative mr-2.5 mt-2.5 inline-block cursor-default outline-none" tabIndex={0} aria-label={word}>
      <span className="inline-block whitespace-nowrap border-b-2 border-foreground pb-[3px] font-semibold tracking-[0.15ch] text-transparent select-none" style={{ minWidth: `${word.length * 0.9}ch` }}>.</span>
      <span
        className="absolute left-1/2 bottom-[calc(100%-10px)] -translate-x-1/2 rounded bg-primary/80 px-1.5 py-0.5 text-base whitespace-nowrap opacity-0 transition-opacity hover:opacity-100 z-10"
        onClick={(e) => { e.stopPropagation(); onWordClick(word.replace(/[.,!?;:]/g, '')) }}
      >{word}</span>
    </span>
  )

  const renderSentenceText = (sentence: SentenceItem) => {
    if (!sentence) return null
    // 第一行（英文）保持原有字重不变，中文行与英文行同字号，仅用颜色区分主次
    const commonStyle = { lineHeight: '1.6', display: 'inline-block' as const }
    const enStyle = commonStyle
    const zhStyle = { ...commonStyle, marginTop: '4px' }
    const renderEn = () => {
      const wordsArr = sentence.Sentence ? sentence.Sentence.split(' ') : []
      return (
        <span className="font-semibold" style={enStyle}>
          {wordsArr.map((w, i) => (
            <span key={i} className="cursor-pointer" onClick={(e) => { e.stopPropagation(); onWordClick(w.replace(/[.,!?;:]/g, '')) }}>
              {w}{i !== wordsArr.length - 1 ? ' ' : ''}
            </span>
          ))}
        </span>
      )
    }
    switch (subtitleMode) {
      case SubtitleModes.BLIND:
        return null
      case SubtitleModes.BLIND_HINT: {
        const wordsArr = sentence.Sentence ? sentence.Sentence.split(' ') : []
        return <span className="select-none" style={commonStyle}>{wordsArr.map((w, i) => renderBlindHintWord(w.replace(/[.,!?;:]/g, ''), i))}</span>
      }
      case SubtitleModes.CHINESE:
        return <span className="text-muted-foreground" style={enStyle}>{sentence.Trans || '(No translation)'}</span>
      case SubtitleModes.ENGLISH:
        return renderEn()
      case SubtitleModes.FULL:
        return (
          <>
            {renderEn()}
            <br />
            <span className="text-muted-foreground" style={zhStyle}>{sentence.Trans || '(No translation)'}</span>
          </>
        )
      default:
        return null
    }
  }

  const iconBtn = (active = false) =>
    cn(
      'flex h-8 w-8 items-center justify-center rounded-md border text-muted-foreground transition-colors',
      active
        ? 'border-primary/60 bg-primary/10 text-primary'
        : 'border-border bg-background hover:bg-muted hover:text-foreground',
    )

  return (
    <div ref={ref} className={cn('flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin transition-opacity', dimmed && 'opacity-35 pointer-events-none')}>
      {Array.isArray(data) && data.map((sentence, index) => {
        const seconds = Math.floor(parseFloat(sentence.Start.toString()) || 0)
        const mm = String(Math.floor(seconds / 60)).padStart(2, '0')
        const ss = String(seconds % 60).padStart(2, '0')
        const isActive = index === currentIndex
        const isLooping = loopIndex === index
        const isPassed = passedIndices?.has(index)

        return (
          <div
            key={index}
            className={cn(
              'sentence group flex items-center gap-3 border-b border-l-2 border-border px-4 py-3 transition-colors',
              isActive ? 'border-l-primary bg-primary/5 active' : 'border-l-transparent',
              'hover:bg-muted/50',
            )}
            onClick={(e) => { e.stopPropagation(); onLineClick?.(index) }}
            style={{ cursor: 'pointer' }}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onLineClick?.(index) } }}
            aria-current={isActive ? 'true' : undefined}
          >
            {/* 播放按钮 + 时间 */}
            <div className="flex flex-col items-center gap-1 shrink-0">
              <button
                type="button"
                className={cn(iconBtn(isActive), 'active:scale-95')}
                onClick={(e) => { e.stopPropagation(); onSpeakerClick(index) }}
                title="播放此句"
              >
                <Play size={14} className={isActive ? 'fill-current' : ''} />
              </button>
              <span className="text-[11px] font-mono text-muted-foreground">{`${mm}:${ss}`}</span>
              {isPassed && (
                <div className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white shadow-sm">
                  <Check size={12} strokeWidth={3} />
                </div>
              )}
            </div>

            {/* 句子内容 */}
            <div className="flex flex-1 flex-col pr-2">
              {renderSentenceText(sentence)}
            </div>

            {/* 右侧操作按钮 */}
            <div className="flex items-center gap-1 shrink-0 opacity-0 transition-opacity group-hover:opacity-100">
              <button
                type="button"
                className={cn('flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground', copyActiveIndex.bi === index && 'text-emerald-500')}
                onClick={(e) => { e.stopPropagation(); onCopy(sentence.Sentence, 'bi', index, sentence.Trans) }}
                title="复制双语"
              >
                <Copy size={14} />
              </button>
              <button
                type="button"
                className={cn(iconBtn(isLooping), 'hover:bg-primary/10 hover:text-primary')}
                onClick={(e) => { e.stopPropagation(); onLoopToggle(index) }}
                title={isLooping ? '取消循环' : '循环此句'}
              >
                <RotateCcw size={14} />
              </button>
            </div>
          </div>
        )
      })}
      <div className="py-8 text-center text-sm font-medium text-muted-foreground/50 select-none tracking-wider" aria-label="End of article" role="contentinfo">— The End —</div>
    </div>
  )
})

export default SentenceList
