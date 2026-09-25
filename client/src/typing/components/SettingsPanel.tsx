import { RotateCcw, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { KEY_SOUNDS } from '../sounds';
import { useTypingSettings } from '../settingsStore';

/**
 * 常驻式练习设置面板。
 *
 * 刻意不用 Dialog：设置项多为「开关 + 即时生效」，摆在界面上可以一边调一边
 * 看到单词区的变化（字号、释义显隐尤其明显），也不需要每次都开关弹窗。
 *
 * 面板整体带 `data-typing-panel`，TypingHome 的全局键盘监听会跳过其中的按键，
 * 避免调节 Select / Slider 时把按键当成打字输入。
 */

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-5 w-9 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        checked ? 'bg-primary' : 'bg-muted',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 h-4 w-4 rounded-full bg-background shadow transition-all',
          checked ? 'left-[1.125rem]' : 'left-0.5',
        )}
      />
    </button>
  );
}

function Slider({
  value,
  onChange,
  min = 0,
  max = 1,
  step = 0.05,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="h-1.5 w-20 cursor-pointer accent-primary"
    />
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="py-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-foreground">{label}</span>
        <div className="flex shrink-0 items-center gap-2">{children}</div>
      </div>
      {hint && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border px-4 py-2 first:border-t-0">
      <h3 className="pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <div className="divide-y divide-border/60">{children}</div>
    </section>
  );
}

const LOOP_OPTIONS = [
  { value: '1', label: '不循环' },
  { value: '2', label: '2 次' },
  { value: '3', label: '3 次' },
  { value: '5', label: '5 次' },
];

const GOAL_OPTIONS = [
  { value: '10', label: '10 词' },
  { value: '20', label: '20 词' },
  { value: '30', label: '30 词' },
  { value: '50', label: '50 词' },
  { value: '100', label: '100 词' },
];

export default function SettingsPanel() {
  const s = useTypingSettings();
  const { update } = s;

  return (
    <aside
      data-typing-panel
      className="flex max-h-[60vh] w-full shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-card lg:max-h-none lg:w-72"
    >
      <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <span className="text-sm font-medium">练习设置</span>
        <button
          type="button"
          onClick={() => s.setPanelOpen(false)}
          title="收起设置"
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
          <X size={15} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <Group title="声音">
          <Row label="按键音" hint="每次输入正确的字母时播放">
            <Slider value={s.keySoundVolume} onChange={(v) => update({ keySoundVolume: v })} />
            <Toggle checked={s.isKeySoundOpen} onChange={(v) => update({ isKeySoundOpen: v })} />
          </Row>

          <Row label="按键音类型">
            <Select value={s.keySoundName} onValueChange={(v) => update({ keySoundName: v })}>
              <SelectTrigger className="h-8 w-[7.5rem]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KEY_SOUNDS.map((k) => (
                  <SelectItem key={k.name} value={k.name}>
                    {k.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>

          <Row label="提示音" hint="输错与完成单词时播放">
            <Slider value={s.hintSoundVolume} onChange={(v) => update({ hintSoundVolume: v })} />
            <Toggle checked={s.isHintSoundOpen} onChange={(v) => update({ isHintSoundOpen: v })} />
          </Row>
        </Group>

        <Group title="发音">
          <Row label="切词自动发音" hint="手动发音（Ctrl/Cmd + J）始终可用">
            <Select
              value={s.pronunciationType}
              onValueChange={(v) => update({ pronunciationType: v === 'uk' ? 'uk' : 'us' })}
            >
              <SelectTrigger className="h-8 w-[4.5rem]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="us">美音</SelectItem>
                <SelectItem value="uk">英音</SelectItem>
              </SelectContent>
            </Select>
            <Toggle
              checked={s.isPronunciationOpen}
              onChange={(v) => update({ isPronunciationOpen: v })}
            />
          </Row>
        </Group>

        <Group title="练习">
          <Row label="忽略大小写" hint="关闭后要求大小写完全一致">
            <Toggle checked={s.isIgnoreCase} onChange={(v) => update({ isIgnoreCase: v })} />
          </Row>

          <Row label="打乱词序" hint="切换后本章会重新开始">
            <Toggle checked={s.isShuffle} onChange={(v) => update({ isShuffle: v })} />
          </Row>

          <Row label="单词循环次数" hint="每个单词重复练习的次数">
            <Select
              value={String(s.loopTimes)}
              onValueChange={(v) => update({ loopTimes: Number(v) })}
            >
              <SelectTrigger className="h-8 w-[5.5rem]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LOOP_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>

          <Row label="每日目标" hint="统计页按此计算打卡进度">
            <Select
              value={String(s.dailyGoalWords)}
              onValueChange={(v) => update({ dailyGoalWords: Number(v) })}
            >
              <SelectTrigger className="h-8 w-[5.5rem]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GOAL_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
        </Group>

        <Group title="显示">
          <Row label={`字号（${s.fontSize}px）`} hint="音标与释义按同一比例联动">
            <Slider
              value={s.fontSize}
              min={28}
              max={72}
              step={2}
              onChange={(v) => update({ fontSize: v })}
            />
          </Row>

          <Row label="默认隐藏释义" hint="隐藏后点击释义区或按 Tab 显示">
            <Toggle checked={s.isTransHidden} onChange={(v) => update({ isTransHidden: v })} />
          </Row>

          <Row label="隐藏音标" hint="喇叭按钮仍在，可手动发音">
            <Toggle checked={s.isPhoneticHidden} onChange={(v) => update({ isPhoneticHidden: v })} />
          </Row>

          <Row label="盲打/听写模式" hint="只隐藏还没打到的字母，已打出的总会显示">
            <Select
              value={s.blindMode}
              onValueChange={(v) => update({ blindMode: v as typeof s.blindMode })}
            >
              <SelectTrigger className="h-8 w-[7rem]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="off">关闭</SelectItem>
                <SelectItem value="all">全隐藏</SelectItem>
                <SelectItem value="vowel">只藏元音</SelectItem>
                <SelectItem value="consonant">只藏辅音</SelectItem>
                <SelectItem value="random">随机隐藏</SelectItem>
              </SelectContent>
            </Select>
          </Row>
        </Group>
      </div>

      <footer className="border-t border-border px-4 py-2.5">
        <Button variant="outline" size="sm" className="w-full" onClick={() => s.reset()}>
          <RotateCcw size={14} className="mr-1.5" />
          恢复默认
        </Button>
      </footer>
    </aside>
  );
}
