import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';

export type Mode = 'light' | 'dark' | 'system';

export interface ThemeState {
  mode: Mode;
  resolvedMode: 'light' | 'dark';
  setMode: (m: Mode) => void;
  toggleMode: () => void;
}

const MODE_KEY = 'ui-theme-mode';

function getSystemMode(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function readStoredMode(): Mode {
  if (typeof localStorage === 'undefined') return 'system';
  const v = localStorage.getItem(MODE_KEY) as Mode | null;
  return v && ['light', 'dark', 'system'].includes(v) ? v : 'system';
}

function applyMode(resolvedMode: 'light' | 'dark') {
  if (typeof document === 'undefined') return;
  const html = document.documentElement;
  html.removeAttribute('data-theme'); // 清理旧的多主题残留
  if (resolvedMode === 'dark') html.classList.add('dark');
  else html.classList.remove('dark');
}

interface ThemeContextValue extends ThemeState {}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<Mode>(() => readStoredMode());
  const [resolvedMode, setResolvedMode] = useState<'light' | 'dark'>(() => {
    const m = readStoredMode();
    return m === 'system' ? getSystemMode() : m;
  });

  useEffect(() => { applyMode(resolvedMode); }, [resolvedMode]);
  useEffect(() => { localStorage.setItem(MODE_KEY, mode); }, [mode]);

  // 监听 system 模式变化
  useEffect(() => {
    if (mode !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setResolvedMode(mq.matches ? 'dark' : 'light');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [mode]);

  useEffect(() => {
    setResolvedMode(mode === 'system' ? getSystemMode() : mode);
  }, [mode]);

  const setMode = useCallback((m: Mode) => setModeState(m), []);
  const toggleMode = useCallback(() => {
    setModeState(prev => {
      const next = prev === 'dark' ? 'light' : 'dark';
      setResolvedMode(next);
      return next;
    });
  }, []);

  const value: ThemeContextValue = { mode, resolvedMode, setMode, toggleMode };
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
