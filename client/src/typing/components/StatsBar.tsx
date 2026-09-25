import { Clock, Gauge, Target, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

type Props = {
  time: number;
  wpm: number;
  accuracy: number;
  index: number;
  total: number;
  wrongCount: number;
  isTyping: boolean;
};

function Item({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: 'danger';
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5">
      <span className="text-muted-foreground">{icon}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn('text-sm font-medium tabular-nums', tone === 'danger' && 'text-destructive')}>{value}</span>
    </div>
  );
}

export default function StatsBar({ time, wpm, accuracy, index, total, wrongCount, isTyping }: Props) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5">
        <span className="text-xs text-muted-foreground">进度</span>
        <span className="text-sm font-medium tabular-nums">
          {Math.min(index + 1, total)}/{total}
        </span>
        {!isTyping && <span className="text-xs text-muted-foreground">（未开始）</span>}
      </div>
      <Item icon={<Clock size={14} />} label="时间" value={formatTime(time)} />
      <Item icon={<Gauge size={14} />} label="WPM" value={String(wpm)} />
      <Item icon={<Target size={14} />} label="正确率" value={`${accuracy}%`} />
      <Item icon={<XCircle size={14} />} label="错误" value={String(wrongCount)} tone="danger" />
    </div>
  );
}
