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
  gradedAt: string | null;
  _count?: { strokes: number };
  pages: number[];
  book?: { id: number; title: string; totalPages: number; pageSizes: { w: number; h: number }[] | null };
}

export async function listAssignments(bookId: number, params: { page?: number; pageSize?: number } = {}) {
  const { data } = await apiClient.get('/pdf/assignments', { params: { bookId, ...params } });
  return data as { data: PdfAssignment[]; total: number; page: number; pageSize: number };
}

export async function getAssignment(id: number) {
  const { data } = await apiClient.get(`/pdf/assignments/${id}`);
  return data.data as PdfAssignment;
}

export async function createAssignment(bookId: number, title?: string, subject?: string) {
  const { data } = await apiClient.post('/pdf/assignments', { bookId, title, subject });
  return data.data as PdfAssignment;
}

export async function updateAssignment(
  id: number,
  patch: { title?: string; subject?: string; status?: string },
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
