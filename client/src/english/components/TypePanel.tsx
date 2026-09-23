import { useState, useEffect, useRef, useCallback } from 'react'
import { cn } from '@/lib/utils'

const STORAGE_KEY = 'type-panel-settings'
const DEFAULT_CHECKBOXES = { compare: true, live: false, inTime: false, focus: false, strict: false }
const DEFAULT_CONFIG = { fontSize: 16, inputHeight: 100, inTimeRounds: 5 }

const loadSettings = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { checkboxes: DEFAULT_CHECKBOXES, config: DEFAULT_CONFIG }
    const parsed = JSON.parse(raw)
    return {
      checkboxes: { ...DEFAULT_CHECKBOXES, ...(parsed.checkboxes ?? {}) },
      config: { ...DEFAULT_CONFIG, ...(parsed.config ?? {}) },
    }
  } catch {
    return { checkboxes: DEFAULT_CHECKBOXES, config: DEFAULT_CONFIG }
  }
}

interface WordDiff { expected: string; typed?: string; status: 'correct' | 'wrong' | 'missing' | 'extra' }
interface JudgeResult { passed: boolean; correctCount: number; totalWords: number; diff: WordDiff[] }

interface Props {
  lessonName: string
  currentIndex: number
  totalCount: number
  targetText: string
  trans?: string
  loopEndCount?: number
  onPlay?: () => void
  onPrev?: () => void
  onNext?: () => void
  onStopLoop?: () => void
  onRedo?: () => void
  onInTimeChange?: (enabled: boolean) => void
  onFocusChange?: (enabled: boolean) => void
  onPassedIndexChange?: (passedIndices: Set<number>) => void
  isDarkMode?: boolean
}

const normalizeToken = (token: string, strict: boolean): string => {
  if (strict) return token
  return token.toLowerCase().replace(/[.,!?;:'"""''(){}[\]…—–·-]/g, '')
}

const toTokens = (text: string, strict: boolean) =>
  text.trim().split(/\s+/).filter(Boolean).map(raw => ({ raw, norm: normalizeToken(raw, strict) })).filter(t => t.norm.length > 0)

const diffTokens = (typed: { norm: string; raw: string }[], expected: { norm: string; raw: string }[]): WordDiff[] => {
  const n = typed.length, m = expected.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = typed[i].norm === expected[j].norm ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const result: WordDiff[] = []
  let i = 0, j = 0
  while (i < n && j < m) {
    if (typed[i].norm === expected[j].norm) { result.push({ expected: expected[j].raw, typed: typed[i].raw, status: 'correct' }); i++; j++ }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { result.push({ expected: '', typed: typed[i].raw, status: 'extra' }); i++ }
    else { result.push({ expected: expected[j].raw, status: 'missing' }); j++ }
  }
  while (i < n) { result.push({ expected: '', typed: typed[i].raw, status: 'extra' }); i++ }
  while (j < m) { result.push({ expected: expected[j].raw, status: 'missing' }); j++ }
  return result
}

const mergeWrong = (diff: WordDiff[]): WordDiff[] => {
  const result: WordDiff[] = []
  let i = 0
  while (i < diff.length) {
    const cur = diff[i], next = diff[i + 1]
    if (cur.status === 'extra' && next?.status === 'missing') { result.push({ expected: next.expected, typed: cur.typed, status: 'wrong' }); i += 2; continue }
    if (cur.status === 'missing' && next?.status === 'extra') { result.push({ expected: cur.expected, typed: next.typed, status: 'wrong' }); i += 2; continue }
    result.push(cur); i++
  }
  return result
}

const judge = (typedText: string, targetText: string, strict: boolean): JudgeResult => {
  const typedTokens = toTokens(typedText, strict)
  const expectedTokens = toTokens(targetText, strict)
  const diff = mergeWrong(diffTokens(typedTokens, expectedTokens))
  return { passed: diff.every(d => d.status === 'correct'), correctCount: diff.filter(d => d.status === 'correct').length, totalWords: expectedTokens.length, diff }
}

export default function TypePanel({
  lessonName, currentIndex, totalCount, targetText, trans, loopEndCount = 0,
  onPlay, onPrev, onNext, onStopLoop, onRedo, onInTimeChange, onFocusChange, onPassedIndexChange, isDarkMode: _isDarkMode = true,
}: Props) {
  const loaded = loadSettings()
  const [checkboxes, setCheckboxes] = useState<typeof DEFAULT_CHECKBOXES>(loaded.checkboxes)
  const [openHelp, setOpenHelp] = useState<string | null>(null)
  const [state, setState] = useState<{ drafts: Record<number, string>; results: Record<number, JudgeResult> }>({ drafts: {}, results: {} })
  const [fontSize, setFontSize] = useState(loaded.config.fontSize)
  const [inputHeight, setInputHeight] = useState(loaded.config.inputHeight)
  const [inTimeRounds, setInTimeRounds] = useState(loaded.config.inTimeRounds)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const loopEndCountRef = useRef(loopEndCount)

  const { drafts, results } = state
  const currentDraft = drafts[currentIndex] ?? ''
  const currentResult: JudgeResult | undefined = results[currentIndex]
  const isFocus = checkboxes.focus
  const showCompare = checkboxes.compare && !!currentResult && !isFocus

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ checkboxes, config: { fontSize, inputHeight, inTimeRounds } }))
  }, [checkboxes, fontSize, inputHeight, inTimeRounds])

  useEffect(() => {
    const passed = new Set<number>()
    Object.entries(results).forEach(([idx, r]) => { if ((r as JudgeResult).passed) passed.add(Number(idx)) })
    onPassedIndexChange?.(passed)
  }, [results])

  useEffect(() => {
    if (!openHelp) return
    const onDocClick = () => setOpenHelp(null)
    document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  }, [openHelp])

  const toggleCheckbox = (key: keyof typeof checkboxes) => {
    setCheckboxes(prev => {
      const next = { ...prev, [key]: !prev[key] }
      if (key === 'live' && next.live) next.inTime = false
      if (key === 'inTime' && next.inTime) next.live = false
      return next
    })
  }

  useEffect(() => { if (checkboxes.live && checkboxes.inTime) setCheckboxes(prev => ({ ...prev, inTime: false })) }, [])

  useEffect(() => { setState({ drafts: {}, results: {} }) }, [lessonName])
  useEffect(() => { onInTimeChange?.(checkboxes.inTime) }, [checkboxes.inTime])
  useEffect(() => { onFocusChange?.(checkboxes.focus) }, [checkboxes.focus])

  useEffect(() => {
    if (!checkboxes.live || !targetText) return
    const timer = setTimeout(() => {
      const result = judge(currentDraft, targetText, checkboxes.strict)
      setState(prev => ({ ...prev, results: { ...prev.results, [currentIndex]: result } }))
    }, 300)
    return () => clearTimeout(timer)
  }, [currentDraft, checkboxes.live, checkboxes.strict, currentIndex, targetText])

  useEffect(() => { textareaRef.current?.focus() }, [currentIndex])

  const setDraft = (index: number, text: string) => setState(prev => ({ ...prev, drafts: { ...prev.drafts, [index]: text } }))

  const handleSubmit = useCallback(() => {
    if (!targetText) return
    const result = judge(drafts[currentIndex] ?? '', targetText, checkboxes.strict)
    setState(prev => ({ ...prev, results: { ...prev.results, [currentIndex]: result } }))
  }, [drafts, currentIndex, targetText, checkboxes.strict])

  const handleRedo = () => {
    setState(prev => {
      const nd = { ...prev.drafts }, nr = { ...prev.results }
      delete nd[currentIndex]; delete nr[currentIndex]
      return { drafts: nd, results: nr }
    })
    onRedo?.()
    textareaRef.current?.focus()
  }

  const handleTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter') return
    if (e.metaKey || e.ctrlKey) { e.preventDefault(); e.shiftKey ? onPrev?.() : onNext?.(); return }
    if (!e.shiftKey) { e.preventDefault(); handleSubmit() }
  }

  useEffect(() => {
    const increased = loopEndCount > loopEndCountRef.current
    loopEndCountRef.current = loopEndCount
    if (!increased || !checkboxes.inTime) return
    if (currentResult?.passed) return
    if (loopEndCount % inTimeRounds !== 0) return
    const result = judge(drafts[currentIndex] ?? '', targetText, checkboxes.strict)
    setState(prev => ({ ...prev, results: { ...prev.results, [currentIndex]: result } }))
    onStopLoop?.()
  }, [loopEndCount])

  const submittedCount = Object.keys(results).length

  const checkboxLabels: { key: keyof typeof checkboxes; label: string; tip: string; disabled?: boolean }[] = [
    { key: 'compare', label: 'Text Compare', tip: '提交/判卷后，在输入框下方显示每个词的对错对比。关闭则只显示最终统计。' },
    { key: 'live', label: 'Live Check', tip: '输入后停顿 300ms 自动判卷，实时看到每个词的对错。与 In Time 互斥。', disabled: checkboxes.inTime },
    { key: 'inTime', label: 'In Time', tip: '音频循环播放当前句，每轮播完你还没提交就自动判卷并暂停。与 Live Check 互斥。', disabled: checkboxes.live },
    { key: 'focus', label: 'Focus Mode', tip: '打字面板撑满屏幕，句子列表降成半透明且不可点击。' },
    { key: 'strict', label: 'Strict', tip: '严格判卷：大小写和标点符号都算错。默认宽松模式下只比对单词本身。' },
  ]

  return (
    <div className={cn('flex flex-col rounded border-[1.5px] border-border bg-muted/50 p-3 px-5 pb-5 my-3 mx-[15px] ml-2.5 text-foreground shadow-sm transition-all', isFocus && 'flex-grow')}>
      <div className={cn('flex items-center justify-between gap-3 mb-3 flex-nowrap', isFocus && 'shrink-0')}>
        <div className="flex gap-[18px] flex-nowrap" onClick={e => e.stopPropagation()}>
          {checkboxLabels.map(({ key, label, tip, disabled }) => (
            <label key={key} className={cn('relative flex cursor-pointer items-center gap-1.5 text-sm whitespace-nowrap text-foreground', disabled && 'opacity-45 cursor-not-allowed line-through decoration-muted-foreground/50')}>
              <input type="checkbox" className="sr-only" checked={checkboxes[key]} disabled={disabled} onChange={() => toggleCheckbox(key)} />
              <span className={cn('h-5 w-5 rounded border-[1.5px] border-border bg-muted transition-colors relative', checkboxes[key] && 'bg-primary border-primary', 'hover:border-primary')}>
                {checkboxes[key] && <span className="absolute left-[6px] top-[2px] h-3 w-1.5 rotate-45 border-r-2 border-b-2 border-white" />}
              </span>
              {label}
              <span
                className={cn('ml-0.5 flex h-4 w-4 items-center justify-center rounded-full border border-border text-[11px] font-bold text-muted-foreground cursor-help shrink-0 transition-colors hover:border-primary hover:bg-primary/10 hover:text-primary')}
                data-tip={tip}
                onClick={(e) => { e.stopPropagation(); setOpenHelp(openHelp === key ? null : key) }}
                onMouseEnter={() => setOpenHelp(key)}
                onMouseLeave={() => setOpenHelp(h => h === key ? null : h)}
              >?</span>
            </label>
          ))}
        </div>
        <div className="flex gap-5 items-center whitespace-nowrap">
          <label className="flex items-center gap-1.5 text-sm text-foreground">Textarea Height
            <input type="number" min={100} max={600} value={inputHeight} onChange={e => setInputHeight(Number(e.target.value))} className="w-14 h-7 rounded border border-border bg-transparent px-2 text-center text-sm outline-none focus:border-primary" />
          </label>
          <label className="flex items-center gap-1.5 text-sm text-foreground">Char Size
            <input type="number" min={10} max={36} value={fontSize} onChange={e => setFontSize(Number(e.target.value))} className="w-14 h-7 rounded border border-border bg-transparent px-2 text-center text-sm outline-none focus:border-primary" />
          </label>
          <label className="flex items-center gap-1.5 text-sm text-foreground" title="In Time 下循环多少轮后自动判卷">In Time Rounds
            <input type="number" min={1} max={20} value={inTimeRounds} onChange={e => setInTimeRounds(Math.max(1, Math.min(20, Number(e.target.value) || 1)))} className="w-14 h-7 rounded border border-border bg-transparent px-2 text-center text-sm outline-none focus:border-primary" />
          </label>
          <button type="button" className="text-[11px] px-2.5 py-0.5 border border-muted-foreground rounded bg-transparent text-muted-foreground cursor-pointer whitespace-nowrap hover:text-foreground hover:border-foreground hover:bg-muted transition-colors" onClick={() => { setCheckboxes(DEFAULT_CHECKBOXES); setFontSize(DEFAULT_CONFIG.fontSize); setInputHeight(DEFAULT_CONFIG.inputHeight); setInTimeRounds(DEFAULT_CONFIG.inTimeRounds) }} title="恢复默认设置">↺ Reset</button>
        </div>
      </div>

      <div className={cn('flex flex-grow gap-3 mb-3', isFocus && 'focus')}>
        <textarea
          ref={textareaRef}
          className="w-full resize-none flex-grow rounded p-3 leading-relaxed text-foreground outline-none bg-transparent border border-border"
          style={{ fontSize: fontSize + 'px', height: isFocus ? undefined : inputHeight + 'px', flexGrow: isFocus ? 1 : undefined }}
          value={currentDraft}
          onChange={e => setDraft(currentIndex, e.target.value)}
          onKeyDown={handleTextareaKeyDown}
          placeholder="type what you hear..."
          spellCheck={false}
        />
        {currentResult && (
          <div className={cn('mt-2.5 rounded border p-2.5 px-4 text-[15px] leading-relaxed', currentResult.passed ? 'border-green-500' : 'border-red-500')}>
            <div className="text-[13px] font-semibold mb-1.5 text-foreground">
              {currentResult.passed ? `✅ Passed ${currentResult.correctCount}/${currentResult.totalWords} — Cmd+Enter 下一句` : `❌ ${currentResult.correctCount}/${currentResult.totalWords} 正确 — 修改后 Enter 重新判卷`}
            </div>
            {showCompare && (
              <div className="flex flex-wrap gap-1 gap-x-2">
                {currentResult.diff.map((d, idx) => {
                  if (d.status === 'correct') return <span key={idx} className="text-green-500">{d.typed}</span>
                  if (d.status === 'wrong') return <span key={idx} className="text-red-500"><del>{d.typed}</del> <em className="not-italic font-semibold text-green-500">{d.expected}</em></span>
                  if (d.status === 'missing') return <span key={idx} className="text-muted-foreground underline decoration-dashed underline-offset-4">{d.expected}</span>
                  return <span key={idx} className="text-red-500/75"><del>{d.typed}</del></span>
                })}
              </div>
            )}
            {trans && showCompare && <div className="mt-2 text-[13px] text-muted-foreground">{trans}</div>}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 flex-nowrap mb-1">
        <div className="flex gap-3 shrink-0">
          <button type="button" className="min-w-[72px] rounded border border-border bg-transparent px-3.5 py-1.5 text-sm font-semibold text-muted-foreground hover:bg-secondary hover:border-secondary hover:text-foreground transition-colors" onClick={() => onPrev?.()} disabled={currentIndex <= 0}>Prev</button>
          <button type="button" className="min-w-[72px] rounded border border-primary bg-primary px-3.5 py-1.5 text-sm font-semibold text-primary-foreground hover:bg-primary/80 transition-colors" onClick={() => onPlay?.()}>Play</button>
          <button type="button" className="min-w-[72px] rounded border border-border bg-transparent px-3.5 py-1.5 text-sm font-semibold text-muted-foreground hover:bg-secondary hover:border-secondary hover:text-foreground transition-colors" onClick={() => onNext?.()} disabled={currentIndex >= totalCount - 1}>Next</button>
        </div>
        <div className="flex flex-1 flex-col items-center gap-1 min-w-[160px]">
          <div className="text-base font-semibold text-foreground">{lessonName}</div>
          <progress className="w-4/5 h-2 rounded overflow-hidden appearance-none bg-secondary [&::-webkit-progress-bar]:rounded [&::-webkit-progress-bar]:bg-secondary [&::-webkit-progress-value]:rounded [&::-webkit-progress-value]:bg-primary [&::-moz-progress-bar]:bg-primary" value={submittedCount} max={totalCount} aria-label="progress bar" />
          <div className="text-sm text-foreground">{`${currentIndex + 1} / ${totalCount} · 已提交 ${submittedCount}`}</div>
        </div>
        <div className="flex gap-3 shrink-0">
          <button type="button" className="min-w-[72px] rounded border border-border bg-transparent px-3.5 py-1.5 text-sm font-semibold text-muted-foreground hover:bg-secondary hover:border-secondary hover:text-foreground transition-colors" onClick={handleRedo}>Redo</button>
          <button type="button" className="min-w-[72px] rounded border border-primary bg-primary px-3.5 py-1.5 text-sm font-semibold text-primary-foreground hover:bg-primary/80 transition-colors" onClick={handleSubmit}>Submit</button>
        </div>
      </div>
      <div className={cn('text-center text-[11px] text-muted-foreground py-1 opacity-70 transition-opacity', isFocus && 'opacity-25')}>
        Enter 判卷 · Shift+Enter 换行 · Cmd/Ctrl+Enter 下一句 · Cmd/Ctrl+Shift+Enter 上一句
      </div>
    </div>
  )
}
