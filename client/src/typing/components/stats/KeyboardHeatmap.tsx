import { cn } from '@/lib/utils';
import type { KeyHeat } from '../../stats';

/**
 * QWERTY 键位热力图：在每个键位上叠加「想按它却打错了」的累计次数。
 * 数据来自错词记录的 mistakes（{ 字母下标: [错输字符] }）配合单词本身反推目标键。
 */

const ROWS: { keys: string[]; offset: number }[] = [
  { keys: '1234567890'.split(''), offset: 0 },
  { keys: 'qwertyuiop'.split(''), offset: 0 },
  { keys: 'asdfghjkl'.split(''), offset: 0.25 },
  { keys: 'zxcvbnm'.split(''), offset: 0.75 },
];

/** 热度 → 样式分级。0 无错，1~4 递增 */
function heatClass(count: number): string {
  if (count >= 10) return 'bg-destructive text-white border-destructive';
  if (count >= 5) return 'bg-destructive/70 text-white border-destructive/70';
  if (count >= 2) return 'bg-destructive/40 text-foreground border-destructive/40';
  if (count >= 1) return 'bg-destructive/15 text-foreground border-destructive/25';
  return 'bg-muted text-foreground border-border';
}

function KeyCap({
  label,
  count,
  flex = 1,
}: {
  label: string;
  count: number;
  flex?: number;
}) {
  return (
    <div
      className={cn(
        'flex h-9 min-w-0 flex-col items-center justify-center rounded-md border text-[10px] leading-none transition-colors',
        heatClass(count),
      )}
      style={{ flexGrow: flex }}
      title={count > 0 ? `${label}：打错 ${count} 次` : `${label}：无错输`}
    >
      <span className="font-mono text-[11px] font-medium">{label === 'space' ? '␣' : label}</span>
      {count > 0 && <span className="mt-0.5 tabular-nums opacity-80">{count}</span>}
    </div>
  );
}

export default function KeyboardHeatmap({ heat }: { heat: KeyHeat }) {
  const missed = heat.missed;
  const totalCount = Object.values(missed).reduce((s, n) => s + n, 0);
  const worst = Object.entries(missed).sort((a, b) => b[1] - a[1])[0];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-medium">键位热力</h3>
        <span className="text-xs text-muted-foreground">
          {totalCount > 0
            ? `共打错 ${totalCount} 次${worst ? `，最容易错的是「${worst[0] === 'space' ? '空格' : worst[0]}」` : ''}`
            : '还没有错输记录，继续保持'}
        </span>
      </div>

      <div className="flex flex-col gap-1.5 rounded-xl border border-border bg-card p-3">
        {ROWS.map((row, ri) => (
          <div key={ri} className="flex gap-1.5" style={{ paddingLeft: `${row.offset * 1.75}rem` }}>
            {row.keys.map((k) => (
              <KeyCap key={k} label={k} count={missed[k] ?? 0} />
            ))}
          </div>
        ))}
        <div className="flex gap-1.5" style={{ paddingLeft: '1.5rem' }}>
          <div className="w-9" />
          <div className="flex-grow">
            <KeyCap label="space" count={missed['space'] ?? 0} flex={5} />
          </div>
          <div className="w-9" />
        </div>
      </div>

      <div className="flex items-center justify-end gap-1.5 text-[10px] text-muted-foreground">
        <span>少</span>
        {[0, 1, 2, 5, 10].map((n) => (
          <span
            key={n}
            className={cn('h-3 w-4 rounded-sm border', heatClass(n))}
          />
        ))}
        <span>多</span>
      </div>
    </div>
  );
}
