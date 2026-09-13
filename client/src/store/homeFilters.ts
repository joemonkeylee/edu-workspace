/**
 * 首页「每个 Tab 一套筛选/排序/关键字」的状态存储。
 *
 * 三个 Tab（视频课程 / 必刷题 / 全部书籍）各自独立记忆：
 * 学科/学期/分类/关键字（含"草稿 → 已生效"两态）、排序字段、只看收藏/只看配对、当前页码。
 * 切换 Tab 时保存当前这套、载入目标 Tab 那套，互不干扰；同时写进 localStorage，刷新后仍保留。
 */

/** 资源类型视图：all = 全部书籍；course = 视频课程；exercise = 必刷题（预留） */
export type ResourceKind = 'all' | 'course' | 'exercise';

export const RESOURCE_KINDS: ResourceKind[] = ['course', 'exercise', 'all'];

/** 可排序字段；favoriteAt = 添加收藏时间（按 BookFavorite.createdAt 排序） */
export type SortFieldName = 'subject' | 'grade' | 'category' | 'title' | 'totalPages' | 'favoriteAt';
export type SortFieldDef = { field: SortFieldName; dir: 'asc' | 'desc' | null };

export interface AppliedFilters {
  subject: string;
  grade: string;
  category: string;
  search: string;
}

export interface KindFilterState {
  /** 下拉与输入框的「草稿」值（点了搜索才生效） */
  subject: string;
  grade: string;
  category: string;
  search: string;
  /** 已生效并用于查询的条件 */
  applied: AppliedFilters;
  sortFields: SortFieldDef[];
  favoritesOnly: boolean;
  pairsOnly: boolean;
  page: number;
}

const STORAGE_KEY = 'edu-home-kind-filters-v2';
// 旧的「三个 Tab 共用一套筛选」的键，仅用于一次性迁移
const LEGACY_KEY = 'edu-home-filters';
const LEGACY_FAV = 'edu-home-favorites-only';
const LEGACY_PAIRS = 'edu-home-pairs-only';

export const defaultBookSort = (): SortFieldDef[] => [
  { field: 'subject', dir: null },
  { field: 'grade', dir: null },
  { field: 'category', dir: null },
  { field: 'title', dir: null },
  { field: 'totalPages', dir: null },
  { field: 'favoriteAt', dir: null },
];

/** 只看收藏时的默认排序：按「添加收藏时间」倒序（最新收藏在前） */
export const defaultFavSort = (): SortFieldDef[] => [
  { field: 'favoriteAt', dir: 'desc' },
  { field: 'subject', dir: null },
  { field: 'grade', dir: null },
  { field: 'category', dir: null },
  { field: 'title', dir: null },
  { field: 'totalPages', dir: null },
];

export function defaultKindState(favoritesOnly = false): KindFilterState {
  return {
    subject: '',
    grade: '',
    category: '',
    search: '',
    applied: { subject: '', grade: '', category: '', search: '' },
    sortFields: favoritesOnly ? defaultFavSort() : defaultBookSort(),
    favoritesOnly,
    pairsOnly: false,
    page: 1,
  };
}

/** 补齐老数据里缺失的排序字段（favoriteAt 是后加的），并保证字段完整 */
function normalizeSortFields(fields: unknown, favoritesOnly: boolean): SortFieldDef[] {
  if (!Array.isArray(fields) || fields.length === 0) {
    return favoritesOnly ? defaultFavSort() : defaultBookSort();
  }
  const known: SortFieldName[] = ['subject', 'grade', 'category', 'title', 'totalPages', 'favoriteAt'];
  const cleaned = fields.filter(
    (f): f is SortFieldDef => !!f && typeof f === 'object' && known.includes((f as SortFieldDef).field),
  );
  if (cleaned.length === 0) return favoritesOnly ? defaultFavSort() : defaultBookSort();
  if (!cleaned.some((f) => f.field === 'favoriteAt')) {
    cleaned.push({ field: 'favoriteAt', dir: null });
  }
  return cleaned;
}

function normalizeState(raw: any): KindFilterState {
  const favoritesOnly = !!raw?.favoritesOnly;
  const base = defaultKindState(favoritesOnly);
  const subject = typeof raw?.subject === 'string' ? raw.subject : '';
  const grade = typeof raw?.grade === 'string' ? raw.grade : '';
  const category = typeof raw?.category === 'string' ? raw.category : '';
  const search = typeof raw?.search === 'string' ? raw.search : '';
  return {
    subject,
    grade,
    category,
    search,
    applied: {
      subject: typeof raw?.applied?.subject === 'string' ? raw.applied.subject : subject,
      grade: typeof raw?.applied?.grade === 'string' ? raw.applied.grade : grade,
      category: typeof raw?.applied?.category === 'string' ? raw.applied.category : category,
      search: typeof raw?.applied?.search === 'string' ? raw.applied.search : search,
    },
    sortFields: normalizeSortFields(raw?.sortFields, favoritesOnly),
    favoritesOnly,
    pairsOnly: !!raw?.pairsOnly,
    page: Number.isFinite(raw?.page) && raw.page > 0 ? Math.floor(raw.page) : 1,
  };
}

/** 从旧版「共用一套筛选」迁移：三个 Tab 都先继承这套条件，之后各自独立演化 */
function migrateLegacy(): void {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    const fav = localStorage.getItem(LEGACY_FAV) === '1';
    const pairs = localStorage.getItem(LEGACY_PAIRS) === '1';
    if (!raw && !fav && !pairs) return;
    const parsed = raw ? JSON.parse(raw) : {};
    const state = normalizeState({
      subject: parsed.subject,
      grade: parsed.grade,
      category: parsed.category,
      search: parsed.search,
      applied: {
        subject: parsed.subject,
        grade: parsed.grade,
        category: parsed.category,
        search: parsed.search,
      },
      sortFields: parsed.sortFields,
      favoritesOnly: fav,
      pairsOnly: pairs,
      page: 1,
    });
    const all: Partial<Record<ResourceKind, KindFilterState>> = {};
    for (const k of RESOURCE_KINDS) all[k] = { ...state };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    localStorage.removeItem(LEGACY_KEY);
    localStorage.removeItem(LEGACY_FAV);
    localStorage.removeItem(LEGACY_PAIRS);
  } catch { /* 迁移失败就退回默认值 */ }
}

let memo: Partial<Record<ResourceKind, KindFilterState>> | null = null;

function readAll(): Partial<Record<ResourceKind, KindFilterState>> {
  if (memo) return memo;
  let parsed: Partial<Record<ResourceKind, KindFilterState>> = {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      migrateLegacy();
      const migrated = localStorage.getItem(STORAGE_KEY);
      parsed = migrated ? JSON.parse(migrated) : {};
    } else {
      parsed = JSON.parse(raw);
    }
  } catch {
    parsed = {};
  }
  memo = parsed ?? {};
  return memo;
}

export function loadKindFilters(kind: ResourceKind): KindFilterState {
  const stored = readAll()[kind];
  return stored ? normalizeState(stored) : defaultKindState();
}

export function saveKindFilters(kind: ResourceKind, state: KindFilterState): void {
  const all = readAll();
  all[kind] = state;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch { /* 隐私模式等场景下忽略 */ }
}

/** 当前默认打开哪个 Tab（持久化；非法值回落到视频课程） */
const STORAGE_KEY_KIND = 'edu-home-resource-kind';

export function loadResourceKind(): ResourceKind {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_KIND);
    if (raw === 'all' || raw === 'course' || raw === 'exercise') return raw;
  } catch { /* ignore */ }
  return 'course';
}

export function saveResourceKind(kind: ResourceKind): void {
  try { localStorage.setItem(STORAGE_KEY_KIND, kind); } catch { /* ignore */ }
}
