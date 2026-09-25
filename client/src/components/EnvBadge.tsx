/** 构建环境徽章 + TEST 时的 commit hash，放在 header 左侧 logo/title 之后。 */

const APP_ENV = import.meta.env.VITE_APP_ENV || (import.meta.env.DEV ? 'DEV' : 'TEST');
const APP_COMMIT = import.meta.env.VITE_APP_COMMIT || '';

const CLASS = APP_ENV === 'PROD'
  ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
  : APP_ENV === 'TEST'
    ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/30'
    : 'bg-sky-500/20 text-sky-700 dark:text-sky-300 border-sky-500/30';

export default function EnvBadge() {
  return (
    <div className="flex items-center gap-1.5 ml-2">
      <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide ${CLASS}`}>
        {APP_ENV}
      </span>
      {APP_ENV === 'TEST' && APP_COMMIT && (
        <span className="font-mono text-[10px] text-muted-foreground" title={`构建版本 ${APP_COMMIT}`}>
          {APP_COMMIT}
        </span>
      )}
    </div>
  );
}
