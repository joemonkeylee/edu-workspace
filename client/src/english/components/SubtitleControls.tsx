import type { ReactNode } from 'react'
import WorkModeToggle from './WorkModeToggle'
import { SubtitleModes, type SubtitleModeType, type WorkModeType } from '../constants'
import { cn } from '@/lib/utils'

interface Props {
  playbackRate: number
  subtitleMode: SubtitleModeType
  workMode: WorkModeType
  onChangePlaybackRate: (rate: number) => void
  onChangeSubtitleMode: (mode: SubtitleModeType) => void
  onChangeWorkMode: (mode: WorkModeType) => void
  audioElement?: ReactNode
}

const presetRates = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]

export default function SubtitleControls({
  playbackRate,
  subtitleMode,
  workMode,
  onChangePlaybackRate,
  onChangeSubtitleMode,
  onChangeWorkMode,
  audioElement,
}: Props) {
  const handleDecrease = () => onChangePlaybackRate(Math.max(0.5, +(playbackRate - 0.1).toFixed(1)))
  const handleIncrease = () => onChangePlaybackRate(Math.min(2, +(playbackRate + 0.1).toFixed(1)))

  // segmented control 通用样式
  const segGroup = 'flex items-center rounded-md border border-border bg-muted p-0.5'
  const segBtn = (active: boolean) =>
    cn(
      'h-7 px-2.5 text-xs font-normal rounded-sm transition-all',
      active
        ? 'bg-background text-foreground shadow-sm'
        : 'text-muted-foreground hover:text-foreground hover:bg-background/50',
    )

  const subtitleOptions: { value: SubtitleModeType; label: string; title: string }[] = [
    { value: SubtitleModes.BLIND, label: 'Blind', title: '盲听模式：无字幕' },
    { value: SubtitleModes.BLIND_HINT, label: 'Hint', title: '提示模式：首字母提示' },
    { value: SubtitleModes.CHINESE, label: '中', title: '仅中文字幕' },
    { value: SubtitleModes.ENGLISH, label: '英', title: '仅英文字幕' },
    { value: SubtitleModes.FULL, label: '双语', title: '双语字幕' },
  ]

  return (
    // 三分组：左（听写/打字）· 中（播放控制 + 倍速）· 右（播放模式）
    <div className="flex h-[60px] flex-shrink-0 items-center justify-between gap-4 border-b border-border bg-card px-4 pl-14">
      {/* 左侧：模式切换 */}
      <WorkModeToggle workMode={workMode} onChangeWorkMode={onChangeWorkMode} />

      {/* 中间：播放控制 + 倍速 */}
      <div className="flex items-center gap-3">
        {audioElement && <div className="flex items-center">{audioElement}</div>}

        <div className="flex items-center gap-1">
          <button
            className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-40"
            onClick={handleDecrease}
            aria-label="减速"
            type="button"
            disabled={playbackRate <= 0.5}
          >
            −
          </button>
          <select
            value={playbackRate.toFixed(2)}
            onChange={(e) => onChangePlaybackRate(Number(e.target.value))}
            className="h-7 rounded-md border border-border bg-background px-2 text-xs font-normal text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            aria-label="倍速"
          >
            {presetRates.map(r => (
              <option key={r} value={r.toFixed(2)}>{r.toFixed(1)}×</option>
            ))}
          </select>
          <button
            className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-40"
            onClick={handleIncrease}
            aria-label="加速"
            type="button"
            disabled={playbackRate >= 2}
          >
            +
          </button>
        </div>
      </div>

      {/* 右侧：播放模式 */}
      <div className={segGroup}>
        {subtitleOptions.map(opt => (
          <button
            key={opt.value}
            className={segBtn(subtitleMode === opt.value)}
            onClick={() => onChangeSubtitleMode(opt.value)}
            title={opt.title}
            type="button"
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}
