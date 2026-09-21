import { Sun, Moon, Monitor } from 'lucide-react';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';

export function ThemeSwitcher({ className }: { className?: string }) {
  const { mode, resolvedMode, toggleMode, setMode } = useTheme();

  const cycleMode = () => {
    if (mode === 'system') {
      // system → 当前相反（绕过 system）
      setMode(resolvedMode === 'dark' ? 'light' : 'dark');
    } else if (mode === 'dark') {
      // dark → light
      setMode('light');
    } else {
      // light → dark
      setMode('dark');
    }
  };

  const ModeIcon = resolvedMode === 'dark' ? Moon : Sun;
  const nextModeLabel = mode === 'dark' ? '亮色' : mode === 'light' ? '暗色' : '系统';

  return (
    <div className={cn('flex items-center gap-1', className)}>
      <button
        type="button"
        onClick={cycleMode}
        title={`点击切换：${mode === 'system' ? '跟随系统' : mode === 'dark' ? '暗色' : '亮色'} → ${nextModeLabel}`}
        aria-label="切换明暗模式"
        className="flex h-8 w-8 items-center justify-center rounded-md text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground transition"
      >
        {mode === 'system' ? <Monitor size={15} /> : <ModeIcon size={15} />}
      </button>
    </div>
  );
}
