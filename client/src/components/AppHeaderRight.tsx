import { Link, useLocation } from 'react-router-dom';
import { BookOpen, FileText, Languages, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ThemeSwitcher } from './ThemeSwitcher';
import WebVitalsInfoPanel from '@/english/components/WebVitalsInfoPanel';
import type { Metric } from '@/english/metrics';
import { convertMetricToVitalInfo, reportWebVitals } from '@/english/metrics';
import { useEffect, useState } from 'react';

const APP_ENV = import.meta.env.VITE_APP_ENV || (import.meta.env.DEV ? 'DEV' : 'TEST');
const APP_COMMIT = import.meta.env.VITE_APP_COMMIT || '';
const APP_ENV_CLASS = APP_ENV === 'PROD'
  ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
  : APP_ENV === 'TEST'
    ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300'
    : 'bg-primary/15 text-primary dark:text-blue-300';

export default function AppHeaderRight() {
  const location = useLocation();
  const [vitals, setVitals] = useState<ReturnType<typeof convertMetricToVitalInfo>[]>([]);

  useEffect(() => {
    reportWebVitals((metric: Metric) => {
      const info = convertMetricToVitalInfo(metric);
      setVitals((prev) => {
        const filtered = prev.filter((v) => v.name !== metric.name);
        return [...filtered, info];
      });
    });
  }, []);

  const isBookActive = location.pathname.startsWith('/books');
  const isPdfActive = location.pathname.startsWith('/pdf');
  const isEnglishActive = location.pathname.startsWith('/english');

  return (
    <div className="flex items-center gap-2">
      <Link to="/books" className={cn('flex items-center gap-1.5 h-9 px-3 rounded-lg transition text-sm',
        isBookActive ? 'bg-primary text-primary-foreground' : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground')}>
        <BookOpen size={16} />
        <span className="hidden sm:inline">Book</span>
      </Link>
      <Link to="/pdf" className={cn('flex items-center gap-1.5 h-9 px-3 rounded-lg transition text-sm',
        isPdfActive ? 'bg-primary text-primary-foreground' : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground')}>
        <FileText size={16} />
        <span className="hidden sm:inline">PDF</span>
      </Link>
      <Link to="/english" className={cn('flex items-center gap-1.5 h-9 px-3 rounded-lg transition text-sm',
        isEnglishActive ? 'bg-primary text-primary-foreground' : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground')}>
        <Languages size={16} />
        <span className="hidden sm:inline">English</span>
      </Link>
      <div className="mx-1 h-5 w-px bg-sidebar-border" />
      <ThemeSwitcher />
      <WebVitalsInfoPanel vitals={vitals} />
      {/* 环境徽章 + commit hash（TEST 时显示） */}
      <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide ${APP_ENV_CLASS}`}>
        {APP_ENV}
      </span>
      {APP_ENV === 'TEST' && APP_COMMIT && (
        <span className="font-mono text-[10px] text-muted-foreground" title={`构建版本 ${APP_COMMIT}`}>
          {APP_COMMIT}
        </span>
      )}
      <Link to="/admin" title="后台管理"
        className="flex h-8 w-8 items-center justify-center rounded-md text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground transition">
        <Settings size={16} />
      </Link>
    </div>
  );
}
