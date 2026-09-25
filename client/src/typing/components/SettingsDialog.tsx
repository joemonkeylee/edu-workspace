import { RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-5 w-9 shrink-0 rounded-full transition-colors',
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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <span className="text-sm text-foreground">{label}</span>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

function Slider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <input
      type="range"
      min={0}
      max={1}
      step={0.05}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="h-1.5 w-24 cursor-pointer accent-primary"
    />
  );
}

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
};

const LOOP_OPTIONS = [
  { value: '1', label: '不循环' },
  { value: '2', label: '2 次' },
  { value: '3', label: '3 次' },
  { value: '5', label: '5 次' },
];

export default function SettingsDialog({ open, onOpenChange }: Props) {
  const s = useTypingSettings();
  const update = s.update;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>练习设置</DialogTitle>
          <DialogDescription>设置会自动保存在本机。</DialogDescription>
        </DialogHeader>

        <div className="divide-y divide-border">
          <Row label="按键音">
            <Slider value={s.keySoundVolume} onChange={(v) => update({ keySoundVolume: v })} />
            <Toggle checked={s.isKeySoundOpen} onChange={(v) => update({ isKeySoundOpen: v })} />
          </Row>

          <Row label="按键音类型">
            <Select value={s.keySoundName} onValueChange={(v) => update({ keySoundName: v })}>
              <SelectTrigger className="h-8 w-[9.5rem]">
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

          <Row label="提示音">
            <Slider value={s.hintSoundVolume} onChange={(v) => update({ hintSoundVolume: v })} />
            <Toggle checked={s.isHintSoundOpen} onChange={(v) => update({ isHintSoundOpen: v })} />
          </Row>

          <Row label="自动发音">
            <Select
              value={s.pronunciationType}
              onValueChange={(v) => update({ pronunciationType: v as 'us' | 'uk' })}
            >
              <SelectTrigger className="h-8 w-24">
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

          <Row label="忽略大小写">
            <Toggle checked={s.isIgnoreCase} onChange={(v) => update({ isIgnoreCase: v })} />
          </Row>

          <Row label="打乱词序">
            <Toggle checked={s.isShuffle} onChange={(v) => update({ isShuffle: v })} />
          </Row>

          <Row label="隐藏释义（悬停显示）">
            <Toggle checked={s.isTransHidden} onChange={(v) => update({ isTransHidden: v })} />
          </Row>

          <Row label="单词循环次数">
            <Select value={String(s.loopTimes)} onValueChange={(v) => update({ loopTimes: Number(v) })}>
              <SelectTrigger className="h-8 w-24">
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

          <Row label={`字号（${s.fontSize}px）`}>
            <input
              type="range"
              min={28}
              max={72}
              step={2}
              value={s.fontSize}
              onChange={(e) => update({ fontSize: Number(e.target.value) })}
              className="h-1.5 w-24 cursor-pointer accent-primary"
            />
          </Row>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => s.reset()}>
            <RotateCcw size={15} className="mr-1.5" />
            恢复默认
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
