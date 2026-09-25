/**
 * PDF 书库首页的筛选/排序状态存储。
 *
 * 与 src/store/homeFilters.ts 同构，但完全独立：<u>不导入、不修改</u>既有那份，
 * localStorage 也用独立键，两条流程互不干扰。
 *
 * PDF 域的「资源类型」语义与图片模式不同：
 *   all        = 全部 PDF 书
 *   searchable = 有文本层、可全文搜索
 *   scan       = 纯扫描件（无文本层）
 * 每个 Tab 各自记忆一套筛选/排序/关键字/页码。
 */

export type PdfResourceKind = 'searchable' | 'scan' | 'all';

export const PDF_RESOURCE_KINDS: PdfResourceKind[] = ['searchable', 'scan', 'all'];

export type SortFieldName = 'subject' | 'grade' | 'category' | 'title' | 'totalPages' | 'favoriteAt';
export type SortFieldDef = { field: SortFieldName; dir: 'asc' | 'desc' | null };

export interface AppliedFilters {
  subject: string;
  grade: string;
  category: string;
  search: string;
}

export interface KindFilterState {
  subject: string;
  grade: string;
  category: string;
  search: string;
  applied: AppliedFilters;
  sortFields: SortFieldDef[];
  favoritesOnly: boolean;
  missingOnly: boolean;
  page: number;
}

const STORAGE_KEY = 'edu-pdf-home-kind-filters-v1';
const STORAGE_KEY_KIND = 'edu-pdf-home-resource-kind';
const STORAGE_KEY_VIEW = 'edu-pdf-home-view-mode';
const STORAGE_KEY_LIST_PS = 'edu-pdf-home-list-page-size';

export const defaultBookSort = (): SortFieldDef[] => [
  { field: 'subject', dir: null },
  { field: 'grade', dir: null },
  { field: 'category', dir: null },
  { field: 'title', dir: null },
  { field: 'totalPages', dir: null },
  { field: 'favoriteAt', dir: null },
];

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
    missingOnly: false,
    page: 1,
  };
}

function normalizeSortFields(fields: unknown, favoritesOnly: boolean): SortFieldDef[] {
  if (!Array.isArray(fields) || fields.length === 0) {
    return favoritesOnly ? defaultFavSort() : defaultBookSort();
  }
  const known: SortFieldName[] = ['subject', 'grade', 'category', 'title', 'totalPages', 'favoriteAt'];
  const cleaned = fields.filter(
    (f): f is SortFieldDef => !!f && typeof f === 'object' && known.includes((f as SortFieldDef).field),
  );
  if (cleaned.length === 0) return favoritesOnly ? defaultFavSort() : defaultBookSort();
  if (!cleaned.some((f) => f.field === 'favoriteAt')) cleaned.push({ field: 'favoriteAt', dir: null });
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
    missingOnly: !!raw?.missingOnly,
    page: Number.isFinite(raw?.page) && raw.page > 0 ? Math.floor(raw.page) : 1,
  };
}

let memo: Partial<Record<PdfResourceKind, KindFilterState>> | null = null;

function readAll(): Partial<Record<PdfResourceKind, KindFilterState>> {
  if (memo) return memo;
  let parsed: Partial<Record<PdfResourceKind, KindFilterState>> = {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    parsed = {};
  }
  memo = parsed ?? {};
  return memo;
}

export function loadKindFilters(kind: PdfResourceKind): KindFilterState {
  const stored = readAll()[kind];
  return stored ? normalizeState(stored) : defaultKindState();
}

export function saveKindFilters(kind: PdfResourceKind, state: KindFilterState): void {
  const all = readAll();
  all[kind] = state;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch { /* 隐私模式下忽略 */ }
}

export function loadResourceKind(): PdfResourceKind {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_KIND);
    if (raw === 'all' || raw === 'searchable' || raw === 'scan') return raw;
  } catch { /* ignore */ }
  return 'all';
}

export function saveResourceKind(kind: PdfResourceKind): void {
  try { localStorage.setItem(STORAGE_KEY_KIND, kind); } catch { /* ignore */ }
}

export type ViewMode = 'preview' | 'list';

export function loadViewMode(): ViewMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_VIEW);
    if (raw === 'preview' || raw === 'list') return raw;
  } catch { /* ignore */ }
  return 'preview';
}

export function saveViewMode(mode: ViewMode): void {
  try { localStorage.setItem(STORAGE_KEY_VIEW, mode); } catch { /* ignore */ }
}

export function loadListPageSize(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_LIST_PS);
    if (raw) return Math.max(10, Math.min(50, parseInt(raw, 10) || 20));
  } catch { /* ignore */ }
  return 20;
}

export function saveListPageSize(n: number): void {
  try { localStorage.setItem(STORAGE_KEY_LIST_PS, String(n)); } catch { /* ignore */ }
}
