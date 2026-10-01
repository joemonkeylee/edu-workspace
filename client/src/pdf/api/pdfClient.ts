import { apiClient } from '../../api/client';

/**
 * PDF 模块的 API 客户端。
 * 全部走 /api/pdf/* 命名空间，与既有 /api/* 完全隔离。
 */

export type Searchable = 'ok' | 'no_text' | 'garbled' | 'watermark_only';

export interface PdfBookSummary {
  id: number;
  title: string;
  category: string;
  grade: string;
  subject: string;
  totalPages: number;
  coverPage: number;
  searchable: Searchable;
  missing: boolean;
  pdfKind: string;
  fileSize: number;
  batchId: string;
  createdAt: string;
  isFavorite?: boolean;
  favoriteAt?: string | null;
}

export interface PairSummary {
  role: 'textbook' | 'answer' | null;
  partnerCount: number;
  partners: Array<{ id: number; title: string }>;
}

export interface PdfBookDetail extends PdfBookSummary {
  filePath: string;
  rootPath: string;
  relPath: string;
  fileHash: string | null;
  pageSizes: { w: number; h: number }[] | null;
  textStats: Record<string, number> | null;
  textExtracted: boolean;
  tocSource: string;
  tocJson: { title: string; page: number | null }[];
  attributes: Record<string, unknown>;
  fileUrl: string;
  coverUrl: string;
  pairSummary?: PairSummary | null;
}

export interface PageTextItem {
  t: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SearchHit {
  pageNumber: number;
  snippet: string;
  matchIndex: number;
}

export interface ListParams {
  page?: number;
  pageSize?: number;
  q?: string;
  grade?: string;
  subject?: string;
  category?: string;
  searchable?: string;
  missing?: '0' | '1';
  /** 资源类型：pdf（可搜索）/ scan（纯扫描件） */
  kind?: string;
  /** 多字段排序，格式 "title:asc,totalPages:desc" */
  sort?: string;
  favoritesOnly?: boolean;
}

export async function listBooks(params: ListParams = {}) {
  const { sort, favoritesOnly, kind, ...rest } = params;
  const query: Record<string, unknown> = { ...rest };
  if (sort) query.sort = sort;
  if (kind) query.kind = kind;
  if (favoritesOnly) query.favoritesOnly = '1';
  const { data } = await apiClient.get('/pdf/books', { params: query });
  return data as { data: PdfBookSummary[]; total: number; page: number; pageSize: number };
}

// ─────────────────────────────────────────────────────────────
// 用户态：收藏 / 阅读进度
// ─────────────────────────────────────────────────────────────

export async function toggleFavorite(bookId: number) {
  const { data } = await apiClient.post(`/pdf/favorites/${bookId}`);
  return data.data as { bookId: number; favorited: boolean; favoriteAt?: string };
}

export async function listFavorites() {
  const { data } = await apiClient.get('/pdf/favorites');
  return data.data as { bookId: number; createdAt: string }[];
}

export interface PdfReadProgress {
  bookId?: number;
  pageNumber: number;
  pageLayout: 'single' | 'double';
  fitMode: 'page' | 'width';
  scale: number;
  rotation: number;
}

export async function getReadingProgress(bookId: number) {
  const { data } = await apiClient.get(`/pdf/reading-progress/${bookId}`);
  return data.data as PdfReadProgress | null;
}

export async function saveReadingProgress(bookId: number, patch: Partial<PdfReadProgress>) {
  const { data } = await apiClient.put(`/pdf/reading-progress/${bookId}`, patch);
  return data.data as PdfReadProgress;
}

// ─────────────────────────────────────────────────────────────
// 批注 / 错题
// ─────────────────────────────────────────────────────────────

export interface PdfAnnotation {
  id: number;
  bookId: number;
  pageNumber: number;
  type: string;
  contentJson: Record<string, unknown>;
  tags: string | null;
  createdAt: string;
  mistakes?: PdfMistakeItem[];
}

export interface PdfMistakeItem {
  id: number;
  annotationId: number;
  bookId: number;
  pageNumber: number;
  imagePath: string;
  imageUrl: string;
  subject: string;
  tags: string | null;
  reviewStatus: number;
  createdAt: string;
}

export async function listAnnotations(bookId: number) {
  const { data } = await apiClient.get('/pdf/annotations', { params: { bookId } });
  return data.data as PdfAnnotation[];
}

/** 新建批注。crop 类型附带裁图 blob 时会同步生成一条错题。 */
export async function createAnnotation(formData: FormData) {
  const { data } = await apiClient.post('/pdf/annotations', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data.data as { annotation: PdfAnnotation; mistake: PdfMistakeItem | null };
}

export async function deleteAnnotation(id: number) {
  await apiClient.delete(`/pdf/annotations/${id}`);
}

export async function updateMistake(
  id: number,
  patch: { reviewStatus?: number; subject?: string; tags?: string },
) {
  const { data } = await apiClient.patch(`/pdf/mistakes/${id}`, patch);
  return data.data as PdfMistakeItem;
}

export async function deleteMistake(id: number) {
  await apiClient.delete(`/pdf/mistakes/${id}`);
}

// ─────────────────────────────────────────────────────────────
// 作业 / 笔迹 / 批改
// ─────────────────────────────────────────────────────────────

export interface PdfAssignmentStroke {
  id: number;
  assignmentId: number;
  pageNumber: number;
  layer: 'student' | 'teacher';
  tool: 'pen' | 'highlighter';
  color: string;
  width: number;
  points: { x: number; y: number; p?: number }[];
  createdAt: string;
}

export interface PdfAssignment {
  id: number;
  bookId: number;
  userId: number | null;
  title: string;
  subject: string;
  status: 'draft' | 'submitted' | 'graded' | 'returned';
  gradedBy: number | null;
  createdAt: string;
  updatedAt: string;
  submittedAt?: string | null;
  gradedAt: string | null;
  /** 预估用时（分钟），0 表示未设，默认 30 */
  estimatedMinutes?: number;
  /** 批改结论：'' 未下结论 | perfect 全正确 | wrong 有错误 | issue 有问题 */
  gradeResult?: string | null;
  gradeIssues?: unknown;
  gradeComment?: string | null;
  _count?: { strokes: number };
  pages: number[];
  book?: { id: number; title: string; totalPages: number; pageSizes: { w: number; h: number }[] | null };
}

export async function listAssignments(bookId: number, params: { page?: number; pageSize?: number } = {}) {
  const { data } = await apiClient.get('/pdf/assignments', { params: { bookId, ...params } });
  return data as { data: PdfAssignment[]; total: number; page: number; pageSize: number };
}

export interface MyPdfAssignment {
  id: number;
  bookId: number;
  userId: number | null;
  title: string;
  subject: string;
  status: 'draft' | 'submitted' | 'graded' | 'returned';
  gradedBy: number | null;
  createdAt: string;
  updatedAt: string;
  submittedAt?: string | null;
  gradedAt: string | null;
  estimatedMinutes?: number;
  gradeResult?: string | null;
  gradeIssues?: unknown;
  gradeComment?: string | null;
  _count?: { strokes: number };
  pages: number[];
  book: {
    id: number;
    title: string;
    subject: string;
    category: string;
    coverPage: number;
    totalPages: number;
  } | null;
}

/**
 * 跨书的「我的 PDF 作业」，概览页右半部分用。
 * 结构与既有 /assignments/mine 对齐，方便两侧共用展示组件。
 */
export async function getMyPdfAssignments(limit = 60, bookId?: number) {
  const { data } = await apiClient.get('/pdf/assignments/mine', {
    params: { limit, ...(bookId ? { bookId } : {}) },
  });
  return data as {
    data: MyPdfAssignment[];
    counts: { all: number; draft: number; submitted: number; graded: number; returned: number };
    books: { id: number; title: string; subject: string; count: number }[];
    limit: number;
  };
}

export async function getAssignment(id: number) {
  const { data } = await apiClient.get(`/pdf/assignments/${id}`);
  return data.data as PdfAssignment;
}

export async function createAssignment(bookId: number, title?: string, subject?: string, estimatedMinutes?: number) {
  const { data } = await apiClient.post('/pdf/assignments', { bookId, title, subject, estimatedMinutes });
  return data.data as PdfAssignment;
}

export async function updateAssignment(
  id: number,
  patch: {
    title?: string;
    subject?: string;
    status?: string;
    estimatedMinutes?: number;
    /** 仅教师标记 graded 时生效：perfect | wrong | issue */
    gradeResult?: string;
    gradeIssues?: string[];
    gradeComment?: string;
  },
) {
  const { data } = await apiClient.put(`/pdf/assignments/${id}`, patch);
  return data.data as PdfAssignment;
}

export async function deleteAssignment(id: number) {
  await apiClient.delete(`/pdf/assignments/${id}`);
}

export async function getAssignmentStrokes(id: number, pageNumber?: number) {
  const { data } = await apiClient.get(`/pdf/assignments/${id}/strokes`, {
    params: pageNumber ? { pageNumber } : {},
  });
  return data.strokes as PdfAssignmentStroke[];
}

/** 整页替换式保存：服务端先删该页该 layer，再写入新的一批 */
export async function saveAssignmentStrokes(
  id: number,
  pageNumber: number,
  layer: 'student' | 'teacher',
  strokes: { tool: string; color: string; width: number; points: { x: number; y: number; p?: number }[] }[],
) {
  const { data } = await apiClient.post(`/pdf/assignments/${id}/strokes`, {
    pageNumber,
    layer,
    strokes,
  });
  return data as { success: boolean; count: number };
}

export async function deleteAssignmentStroke(assignmentId: number, strokeId: number) {
  await apiClient.delete(`/pdf/assignments/${assignmentId}/strokes/${strokeId}`);
}

export async function exportAssignmentPage(id: number, pageNumber: number) {
  const { data } = await apiClient.post(`/pdf/assignments/${id}/export`, { pageNumber });
  return data.data as {
    fileUrl: string;
    bookId: number;
    bookTitle: string;
    pageNumber: number;
    strokes: PdfAssignmentStroke[];
    assignment: { id: number; title: string; status: string };
  };
}

export async function getBook(id: number) {
  const { data } = await apiClient.get(`/pdf/books/${id}`);
  return data.data as PdfBookDetail;
}

export async function getMeta(id: number, refresh = false) {
  const { data } = await apiClient.get(`/pdf/books/${id}/meta`, { params: refresh ? { refresh: 1 } : {} });
  return data.data;
}

export async function updateBook(id: number, patch: Partial<PdfBookDetail>) {
  const { data } = await apiClient.patch(`/pdf/books/${id}`, patch);
  return data.data as PdfBookDetail;
}

export async function deleteBook(id: number) {
  const { data } = await apiClient.delete(`/pdf/books/${id}`);
  return data;
}

export async function getPageText(id: number, page: number) {
  const { data } = await apiClient.get(`/pdf/books/${id}/text/${page}`);
  return data.data as { pageNumber: number; items: PageTextItem[]; plainText: string; cached: boolean };
}

export async function searchInBook(id: number, q: string, auto = true) {
  const { data } = await apiClient.get(`/pdf/books/${id}/search`, { params: { q, auto: auto ? 1 : 0 } });
  return data.data as {
    hits: SearchHit[];
    searchable: Searchable;
    textExtracted?: boolean;
    message?: string;
    query?: string;
  };
}

export async function getFacets() {
  const { data } = await apiClient.get('/pdf/books/facets');
  return data.data as {
    grades: { value: string; count: number }[];
    subjects: { value: string; count: number }[];
    categories: { value: string; count: number }[];
    searchable: { value: string; count: number }[];
    kinds: Record<string, number>;
    missing: number;
  };
}

// ── 管理端 ───────────────────────────────────────────────────────

export async function scanPreview(payload: {
  rootPath: string;
  recursive?: boolean;
  max?: number;
  hash?: boolean;
}) {
  const { data } = await apiClient.post('/pdf/admin/scan/preview', payload);
  return data.data;
}

export async function scanCommit(payload: { items: any[]; batchId?: string; generateCovers?: boolean }) {
  const { data } = await apiClient.post('/pdf/admin/scan/commit', payload);
  return data.data;
}

export async function seedFromBooks(payload: { dryRun?: boolean; limit?: number; generateCovers?: boolean }) {
  const { data } = await apiClient.post('/pdf/admin/seed-from-books', payload);
  return data.data;
}

export async function recheckSearchable(limit = 50) {
  const { data } = await apiClient.post('/pdf/admin/recheck-searchable', { limit });
  return data.data;
}

// ── 专栏预分析（外部资料盘 collect-scan.py 产物） ──────────────

export interface CollectFile {
  name: string;
  relPath: string;
  absPath: string;
  sizeMB: number;
  dir: string;
  kind: string;
  subject: string;
  subjectConf: number;
  grade: string;
  gradeConf: number;
  series: string;
  seriesConf: number;
  docType: string;
  noise: boolean;
  noiseReason: string;
  pending: boolean;
  dupOf: string | null;
  sha256: string | null;
}

export interface CollectTreeNode {
  name: string;
  relPath: string;
  isDir: true;
  isNoise: boolean;
  noiseReason: string;
  hasNoise: boolean;
  fileCount: number;
  noiseCount: number;
  files: CollectFile[];
  children: CollectTreeNode[];
}

export interface CollectMeta {
  root: string;
  scannedAt: string;
  totalWalked: number;
  pdfCount: number;
  pendingCount: number;
  noiseDirCount: number;
  dupGroups: number;
  subjectFilter: string | null;
  hashed: boolean;
  subjectDist: Record<string, number>;
  gradeDist: Record<string, number>;
  noiseDist: Record<string, number>;
}

export interface CollectPreviewData {
  meta: CollectMeta;
  files: CollectFile[];
  tree: CollectTreeNode;
  /** 源盘绝对路径 → 已入库记录（拷贝式入库后源文件仍在，靠它标「已迁移」） */
  migrated: Record<string, { id: string; title: string; batchId: string; at: string }>;
  paths: { tree: string; files: string; src: string; out: string; target: string };
}

export async function collectPreview() {
  const { data } = await apiClient.get('/pdf/admin/collect/preview');
  return data.data as CollectPreviewData;
}

export async function collectScan(payload: { subject?: string; noHash?: boolean; src?: string }) {
  const { data } = await apiClient.post('/pdf/admin/collect/scan', payload);
  return data.data as CollectPreviewData & { ran: boolean; logTail: string; src?: string };
}

export interface CollectCommitItem {
  filePath: string;
  title?: string;
  subject?: string;
  grade?: string;
  series?: string;
  totalPages?: number;
  searchable?: string;
  fileSize?: number;
  fileHash?: string | null;
}

export interface CollectCommitResult {
  created: { id: string; title: string; relPath: string }[];
  skipped: { filePath: string; reason: string }[];
  videoCount: number;
  mode: 'copy' | 'move';
}

/** 入库：把勾选+校正后的文件搬到目标盘并写入 column_book（默认拷贝，源文件保留） */
export async function collectCommit(payload: {
  items: CollectCommitItem[];
  targetRoot?: string;
  batchId?: string;
  mode?: 'copy' | 'move';
}) {
  const { data } = await apiClient.post('/pdf/admin/collect/commit', payload);
  return data.data as CollectCommitResult;
}

export interface DiskInfo {
  path: string;
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
}

/** 目标盘（或任意路径所在盘）剩余空间 */
export async function collectDisk(path?: string) {
  const { data } = await apiClient.get('/pdf/admin/collect/disk', { params: path ? { path } : {} });
  return data.data as DiskInfo;
}

export interface FsStatItem {
  path: string;
  exists: boolean;
  isDir: boolean;
  sizeBytes: number;
  fileCount: number;
  dirCount: number;
}

/** 路径体积统计（删除前预估「几个文件 / 多大」） */
export async function collectFsStat(paths: string[]) {
  const { data } = await apiClient.post('/pdf/admin/collect/fs/stat', { paths });
  return data.data as { items: FsStatItem[]; totalBytes: number; totalFiles: number; totalDirs: number };
}

export interface FsDeleteResult {
  results: { path: string; ok: boolean; error?: string; sizeBytes?: number; fileCount?: number }[];
  okCount: number;
  failCount: number;
  freedBytes: number;
  deletedFiles: number;
}

/** 批量物理删除文件 / 文件夹（仅允许白名单根目录之下；echo 必须为 'DELETE'） */
export async function collectFsDelete(paths: string[]) {
  const { data } = await apiClient.post('/pdf/admin/collect/fs/delete', { paths, echo: 'DELETE' });
  return data.data as FsDeleteResult;
}

export interface PurgeResult {
  db: { booksBefore: number; booksAfter: number } | null;
  files:
    | { skipped: true; reason: string; targetRoot: string; columnRoot?: string }
    | { targetRoot: string; filePattern: 'pdf' | 'all'; deletedFiles: number; freedBytes: number; prunedDirs: number; sample: string[] }
    | null;
}

/** 一键清空：column_* 表 与 / 或 目标盘 PDF（echo 必须为 'PURGE'） */
export async function collectPurge(payload: { db: boolean; files: boolean; targetRoot?: string; filePattern?: 'pdf' | 'all' }) {
  const { data } = await apiClient.post('/pdf/admin/collect/purge', { ...payload, echo: 'PURGE' });
  return data.data as PurgeResult;
}

// ── 管理端：书籍 / 批注 / 错题 / 作业 ─────────────────────────

export interface PdfAdminBook {
  id: number;
  title: string;
  category: string;
  grade: string;
  subject: string;
  totalPages: number;
  coverPage: number;
  searchable: string;
  missing: boolean;
  pdfKind: string;
  fileSize: number;
  batchId: string;
  createdAt: string;
  updatedAt: string;
  coverUrl: string;
  tocJson?: any[];
  attributes?: Record<string, unknown>;
}

export async function adminListPdfBooks(params: Record<string, any> = {}) {
  const { data } = await apiClient.get('/pdf/admin/books', { params });
  return data as { data: PdfAdminBook[]; total: number; page: number; pageSize: number };
}

export async function adminGetPdfBookBatches() {
  const { data } = await apiClient.get('/pdf/admin/books/batches');
  return data.data as string[];
}

export async function adminGetPdfBookFacets() {
  const { data } = await apiClient.get('/pdf/admin/books/facets');
  return data.data as {
    grades: { value: string; count: number }[];
    subjects: { value: string; count: number }[];
    categories: { value: string; count: number }[];
    searchables: { value: string; count: number }[];
    missing: number;
  };
}

export async function adminUpdatePdfBook(
  id: number,
  body: { title?: string; category?: string; grade?: string; subject?: string; coverPage?: number; tocJson?: any[]; attributes?: Record<string, any> },
) {
  const { data } = await apiClient.patch(`/pdf/admin/books/${id}`, body);
  return data.data as PdfAdminBook;
}

export async function adminSoftDeletePdfBook(id: number) {
  const { data } = await apiClient.delete(`/pdf/admin/books/${id}`);
  return data as { success: boolean };
}

export async function adminRestorePdfBook(id: number) {
  const { data } = await apiClient.post(`/pdf/admin/books/${id}/restore`);
  return data as { success: boolean };
}

export async function adminSoftDeletePdfBooksBatch(ids: number[]) {
  const { data } = await apiClient.post('/pdf/admin/books/batch-delete', { ids });
  return data as { success: boolean; deleted: number; skipped: number };
}

export async function adminRestorePdfBooksBatch(ids: number[]) {
  const { data } = await apiClient.post('/pdf/admin/books/batch-restore', { ids });
  return data as { success: boolean; restored: number; skipped: number };
}

export async function adminListPdfDeletedBooks(params: Record<string, any> = {}) {
  const { data } = await apiClient.get('/pdf/admin/books/deleted/list', { params });
  return data as { data: PdfAdminBook[]; total: number; page: number; pageSize: number };
}

// ── 管理端：批注 ─────────────────────────────────────────────

export interface PdfAdminAnnotation {
  id: number;
  bookId: number;
  pageNumber: number;
  type: string;
  contentJson: any;
  tags: string | null;
  createdAt: string;
  book: { id: number; title: string } | null;
}

export async function adminListPdfAnnotations(params: Record<string, any> = {}) {
  const { data } = await apiClient.get('/pdf/admin/annotations', { params });
  return data as { data: PdfAdminAnnotation[]; total: number; page: number; pageSize: number };
}

export async function adminDeletePdfAnnotation(id: number) {
  const { data } = await apiClient.delete(`/pdf/admin/annotations/${id}`);
  return data as { success: boolean };
}

// ── 管理端：错题 ─────────────────────────────────────────────

export interface PdfAdminMistake {
  id: number;
  annotationId: number;
  bookId: number;
  pageNumber: number;
  imagePath: string;
  imageUrl: string;
  subject: string;
  tags: string | null;
  reviewStatus: number;
  createdAt: string;
  book: { id: number; title: string; grade: string; subject: string } | null;
}

export async function adminListPdfMistakes(params: Record<string, any> = {}) {
  const { data } = await apiClient.get('/pdf/admin/mistakes', { params });
  return data as { data: PdfAdminMistake[]; total: number; page: number; pageSize: number };
}

export async function adminUpdatePdfMistake(
  id: number,
  body: { reviewStatus?: number; subject?: string; tags?: string },
) {
  const { data } = await apiClient.patch(`/pdf/admin/mistakes/${id}`, body);
  return data.data as PdfAdminMistake;
}

export async function adminDeletePdfMistake(id: number) {
  const { data } = await apiClient.delete(`/pdf/admin/mistakes/${id}`);
  return data as { success: boolean };
}

// ── 管理端：作业 ─────────────────────────────────────────────

export interface PdfAdminAssignment {
  id: number;
  bookId: number;
  userId: number | null;
  title: string;
  subject: string;
  status: string;
  gradedBy: number | null;
  createdAt: string;
  updatedAt: string;
  submittedAt?: string | null;
  gradedAt: string | null;
  estimatedMinutes?: number;
  gradeResult: string | null;
  gradeIssues: unknown;
  gradeComment: string | null;
  _count: { strokes: number };
  pages: number[];
  book: { id: number; title: string } | null;
}

export async function adminListPdfAssignments(params: Record<string, any> = {}) {
  const { data } = await apiClient.get('/pdf/admin/assignments', { params });
  return data as {
    data: PdfAdminAssignment[];
    total: number;
    page: number;
    pageSize: number;
    books: { id: number; title: string }[];
  };
}

export async function adminDeletePdfAssignment(id: number) {
  const { data } = await apiClient.delete(`/pdf/admin/assignments/${id}`);
  return data as { success: boolean };
}

export async function adminDeletePdfAssignmentsBatch(ids: number[]) {
  const { data } = await apiClient.post('/pdf/admin/assignments/batch-delete', { ids });
  return data as { success: boolean; count: number };
}

// ─────────────────────────────────────────────────────────────
// 教辅资料（teaching_materials 表，管理端只读展示 + 筛选）
// ─────────────────────────────────────────────────────────────

export interface TeachingMaterial {
  id: number;
  name: string;
  /** 难度 1~10（越小越基础） */
  difficulty: number | null;
  /** 科目，多值时用「、」连接，如「英语、物理」 */
  subject: string;
  /** 热度 1~10 */
  popularity: number | null;
  /** 地区 / 版本，如「全国通用(人教版)」 */
  region: string;
  /** 资料来源（网盘卖家） */
  source: string;
  url: string;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface TeachingMaterialFacets {
  subjects: { value: string; count: number }[];
  regions: { value: string; count: number }[];
  sources: { value: string; count: number }[];
  difficulties: { value: number; count: number }[];
  popularities: { value: number; count: number }[];
  total: number;
}

export interface TeachingMaterialQuery {
  q?: string;
  subject?: string;
  region?: string;
  source?: string;
  difficulty?: number | '';
  popularity?: number | '';
  /** '1' 仅有链接 / '0' 无链接 / '' 不限 */
  hasUrl?: '1' | '0' | '';
  sort?: string;
  order?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export async function listTeachingMaterials(params: TeachingMaterialQuery = {}) {
  // 空串 / undefined 不传，避免后端把 '' 当成有效筛选值
  const query: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v !== '' && v !== undefined && v !== null) query[k] = v;
  }
  const { data } = await apiClient.get('/pdf/admin/materials', { params: query });
  return data.data as { rows: TeachingMaterial[]; total: number; page: number; pageSize: number };
}

export async function teachingMaterialFacets() {
  const { data } = await apiClient.get('/pdf/admin/materials/facets');
  return data.data as TeachingMaterialFacets;
}

/** PDF 文件的直链（供 pdf.js 自己发 Range 请求） */
export function pdfFileUrl(id: number) {
  return `/api/pdf/books/${id}/file`;
}

export function coverUrl(id: number, w = 300) {
  return `/api/pdf/books/${id}/cover?w=${w}`;
}

export function thumbUrl(id: number, page: number, w = 160) {
  return `/api/pdf/books/${id}/thumb/${page}?w=${w}`;
}
