/**
 * 构建期注入的环境标识。
 *
 * 由根目录 package.json 注入：
 *   - `npm run build`      → VITE_APP_ENV=TEST（默认，LAN 自动部署走这条）
 *   - `npm run build:prod` → VITE_APP_ENV=PROD
 *   - `npm run dev` / 直接 vite build（未注入）→ 视为 DEV
 *
 * 用途：给网页标题加前缀，避免测试环境和生产环境在浏览器标签页里长得一样。
 */

export type AppEnv = 'DEV' | 'TEST' | 'PROD';

const RAW = import.meta.env.VITE_APP_ENV;

/** 当前环境。未注入或值非法一律按 DEV 处理，避免误当生产环境 */
export const APP_ENV: AppEnv = RAW === 'PROD' || RAW === 'TEST' || RAW === 'DEV' ? RAW : 'DEV';

/** 构建时的 git 短 hash，未注入时为空串 */
export const APP_COMMIT: string = import.meta.env.VITE_APP_COMMIT ?? '';

export const APP_NAME = 'edu-workspace';

/** 标题前缀。生产环境保持干净，不做任何打扰 */
const ENV_PREFIX: Record<AppEnv, string> = {
  DEV: '[本地]',
  TEST: '[测试]',
  PROD: '',
};

/** 环境的中文名，供 UI 展示 */
export const ENV_LABEL: Record<AppEnv, string> = {
  DEV: '本地开发',
  TEST: '测试环境',
  PROD: '生产环境',
};

export const IS_PROD: boolean = APP_ENV === 'PROD';

/**
 * 给任意页面标题加上环境前缀。
 * 生产环境原样返回，其余形如 `[测试] 三年级 数学 某某书`。
 */
export function withEnvPrefix(title: string): string {
  if (!title) return title;
  const prefix = ENV_PREFIX[APP_ENV];
  return prefix ? `${prefix} ${title}` : title;
}

/** 默认标题（已含环境前缀） */
export const DEFAULT_TITLE: string = withEnvPrefix(APP_NAME);

/**
 * 在 React 挂载前调用一次：设置默认标题，并把环境写到 <html> 上。
 * `data-app-env` / `data-app-commit` 方便 devtools 排查，也可用 CSS 区分样式。
 */
export function applyAppEnvMeta(): void {
  document.title = DEFAULT_TITLE;
  document.documentElement.dataset.appEnv = APP_ENV;
  if (APP_COMMIT) document.documentElement.dataset.appCommit = APP_COMMIT;
}
